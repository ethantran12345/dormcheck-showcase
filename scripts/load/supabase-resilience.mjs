#!/usr/bin/env node
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { validateTarget } from './policy.mjs';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const supabaseUrl = validateTarget(required('SUPABASE_URL')).origin;
const anonKey = required('SUPABASE_ANON_KEY');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const userEmail = process.env.E2E_USER_EMAIL ?? 'e2e+user@pitt.edu';
const userPassword = required('E2E_USER_PASSWORD');
const peerEmail = process.env.E2E_PEER_EMAIL ?? 'e2e+admin@pitt.edu';
const peerPassword = required('E2E_PEER_PASSWORD');
const messageCount = Math.min(1_000, Math.max(1, Number(process.env.REALTIME_MESSAGE_COUNT ?? 25)));
const runId = `load-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const user = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const peer = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
let conversationId = null;
let photoPath = null;
let userChannel = null;
let peerChannel = null;
let reconnectedUser = null;
let reconnectChannel = null;

const timed = async (label, action) => {
  const started = performance.now();
  const value = await action();
  return { label, ms: performance.now() - started, value };
};

const signIn = async (client, email, password) => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error(`No user returned for ${email}`);
  return data.user;
};

const subscribe = (client, name, conversation, onInsert) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${name} subscribe timeout`)), 10_000);
  const channel = client
    .channel(name)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation}`,
    }, onInsert)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        reject(new Error(`${name} subscription ${status}`));
      }
    });
});

const waitUntil = async (predicate, label, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timeout`);
};

async function main() {
  const userRow = await signIn(user, userEmail, userPassword);
  const peerRow = await signIn(peer, peerEmail, peerPassword);

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      participant_1: userRow.id,
      participant_2: peerRow.id,
      status: 'accepted',
      initiated_by: userRow.id,
      last_message: runId,
    })
    .select('id')
    .single();
  if (conversationError) throw conversationError;
  conversationId = conversation.id;

  const userEvents = [];
  const peerEvents = [];
  userChannel = await subscribe(user, `${runId}-user`, conversationId, ({ new: row }) => userEvents.push(row.id));
  peerChannel = await subscribe(peer, `${runId}-peer`, conversationId, ({ new: row }) => peerEvents.push(row.id));

  const send = await timed('realtime-send', async () => {
    for (let index = 0; index < messageCount; index += 1) {
      const { error } = await user.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userRow.id,
        content: `${runId}:${index}`,
      });
      if (error) throw error;
    }
  });
  await waitUntil(() => userEvents.length >= messageCount && peerEvents.length >= messageCount, 'two-client delivery');

  const uniqueUserEvents = new Set(userEvents);
  const uniquePeerEvents = new Set(peerEvents);
  if (uniqueUserEvents.size !== messageCount || uniquePeerEvents.size !== messageCount) {
    throw new Error(`duplicate/missing delivery user=${userEvents.length}/${uniqueUserEvents.size} peer=${peerEvents.length}/${uniquePeerEvents.size}`);
  }
  const initialUserEvents = userEvents.length;
  const initialPeerEvents = peerEvents.length;

  await user.removeChannel(userChannel);
  userChannel = null;
  const disconnectedContent = `${runId}:disconnected`;
  const { error: disconnectedInsertError } = await peer.from('messages').insert({
    conversation_id: conversationId,
    sender_id: peerRow.id,
    content: disconnectedContent,
  });
  if (disconnectedInsertError) throw disconnectedInsertError;

  const { data: recovered, error: recoveryError } = await user
    .from('messages')
    .select('id, content')
    .eq('conversation_id', conversationId)
    .eq('content', disconnectedContent)
    .single();
  if (recoveryError || !recovered) throw recoveryError ?? new Error('stale-state recovery missed disconnected message');

  const reconnectEvents = [];
  let reconnectFailure = null;
  let reconnectRecoveredByQuery = false;
  const reconnectedContent = `${runId}:reconnected`;
  // A fresh client mirrors a resumed WKWebView/browser after its old socket was
  // torn down, rather than relying on internal channel reuse semantics.
  try {
    if (process.env.SKIP_RECONNECT === '1') throw new Error('skipped for throughput-only run');
    reconnectedUser = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await signIn(reconnectedUser, userEmail, userPassword);
    reconnectChannel = await subscribe(reconnectedUser, `${runId}-user-reconnect`, conversationId, ({ new: row }) => reconnectEvents.push(row.id));
    const { error: reconnectInsertError } = await peer.from('messages').insert({
      conversation_id: conversationId,
      sender_id: peerRow.id,
      content: reconnectedContent,
    });
    if (reconnectInsertError) throw reconnectInsertError;
    await waitUntil(() => reconnectEvents.length === 1, 'reconnect delivery');
  } catch (error) {
    reconnectFailure = error instanceof Error ? error.message : String(error);
    if (reconnectedUser) {
      const { data } = await reconnectedUser
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('content', reconnectedContent)
        .maybeSingle();
      reconnectRecoveredByQuery = Boolean(data);
    }
  }

  photoPath = `${userRow.id}/${runId}.png`;
  const onePixelPng = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  ));
  const upload = await timed('storage-upload', async () => {
    const { error } = await user.storage.from('dm-photos').upload(photoPath, onePixelPng, { contentType: 'image/png' });
    if (error) throw error;
  });

  // Cross-user deletion must not remove the object. Storage may report an empty
  // successful result under RLS, so verify persistence with the service client.
  await peer.storage.from('dm-photos').remove([photoPath]);
  const folder = photoPath.split('/')[0];
  const filename = photoPath.split('/')[1];
  const { data: stillThere, error: listError } = await admin.storage.from('dm-photos').list(folder, { search: filename });
  if (listError || !stillThere?.some((row) => row.name === filename)) {
    throw listError ?? new Error('cross-user storage delete bypassed ownership');
  }

  const cleanup = await timed('storage-owner-cleanup', async () => {
    const { error } = await user.storage.from('dm-photos').remove([photoPath]);
    if (error) throw error;
    photoPath = null;
  });

  const invalidSession = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer expired.invalid.token' } },
  });
  const { error: expiredError } = await invalidSession.from('messages').insert({
    conversation_id: conversationId,
    sender_id: userRow.id,
    content: `${runId}:must-not-write`,
  });
  if (!expiredError) throw new Error('expired/invalid session unexpectedly wrote a message');

  const reconnectSkipped = process.env.SKIP_RECONNECT === '1';
  const failures = reconnectFailure && !reconnectSkipped && !reconnectRecoveredByQuery
    ? [`reconnect: ${reconnectFailure}`]
    : [];
  process.stdout.write(`${JSON.stringify({
    target: supabaseUrl,
    runId,
    messages: messageCount,
    twoClient: { userEvents: initialUserEvents, peerEvents: initialPeerEvents, duplicates: 0 },
    reconnect: {
      tested: !reconnectSkipped,
      recoveredWhileDisconnected: true,
      deliveredAfterReconnect: reconnectEvents.length === 1,
      recoveredByJoinQuery: reconnectRecoveredByQuery,
      eventFailure: reconnectFailure,
    },
    auth: { expiredWriteRejected: true },
    storage: { crossUserDeleteRejected: true, ownerCleanup: true },
    timingsMs: { send: send.ms, upload: upload.ms, cleanup: cleanup.ms },
    failures,
  }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;

}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}).finally(async () => {
  const removals = [];
  if (userChannel) removals.push(user.removeChannel(userChannel));
  if (peerChannel) removals.push(peer.removeChannel(peerChannel));
  if (reconnectedUser && reconnectChannel) removals.push(reconnectedUser.removeChannel(reconnectChannel));
  await Promise.allSettled(removals);
  if (photoPath) await admin.storage.from('dm-photos').remove([photoPath]);
  if (conversationId) await admin.from('conversations').delete().eq('id', conversationId);
  await Promise.allSettled([user.auth.signOut(), peer.auth.signOut(), reconnectedUser?.auth.signOut()]);
  for (const client of [user, peer, reconnectedUser].filter(Boolean)) {
    await client.removeAllChannels();
    client.realtime.disconnect();
  }
});
