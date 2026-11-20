import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_NOTICE_VERSION } from '../src/lib/legalNotice';
import {
  serviceClient,
  userClient,
  ensureUser,
  FIXTURE_PASSWORD,
  PITT_UNIVERSITY_ID,
} from './lib/api';

/**
 * Messaging critical path: start a DM, send a message, and block enforcement.
 * The happy path runs through the real UI as the seeded student; the block
 * tests assert at the API layer because "the server refuses" is the claim —
 * blocks are enforced by RESTRICTIVE RLS (is_blocked_between /
 * 20260603062407_block_enforcement_dms.sql), not by client filtering.
 */

const PEER_EMAIL = 'e2e-dm-peer@pitt.edu';
const PEER_NAME = 'E2E DM Peer';

const USER_EMAIL = process.env.E2E_USER_EMAIL!;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETUP_DORM_ID = 990001;

async function clearSetupFixture() {
  const svc = serviceClient();
  const { data: setups } = await svc
    .from('student_setups')
    .select('id')
    .eq('user_id', userId)
    .eq('dorm_id', SETUP_DORM_ID);
  const setupIds = (setups ?? []).map((row) => row.id);
  if (setupIds.length > 0) await svc.from('setup_photos').delete().in('setup_id', setupIds);
  await svc.from('student_setups').delete().eq('user_id', userId).eq('dorm_id', SETUP_DORM_ID);

  const { data: objects } = await svc.storage.from('setup-photos').list(userId, { limit: 100 });
  const paths = (objects ?? []).map((object) => `${userId}/${object.name}`);
  if (paths.length > 0) await svc.storage.from('setup-photos').remove(paths);
}

let peerId: string;
let userId: string;
let peer: SupabaseClient;

test.beforeAll(async () => {
  peerId = await ensureUser(PEER_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: PEER_NAME });
  const { data, error } = await serviceClient()
    .from('profiles')
    .select('id')
    .ilike('email', USER_EMAIL)
    .single();
  if (error) throw error;
  userId = data.id;
  peer = await userClient(PEER_EMAIL, FIXTURE_PASSWORD);
  // A stale block from an aborted run would flip the happy-path outcome.
  await serviceClient().from('blocked_users').delete().eq('blocker_id', peerId);
});

test.afterAll(async () => {
  const svc = serviceClient();
  await svc.from('blocked_users').delete().eq('blocker_id', peerId);
  // Remove the fixture conversation so repeated runs start clean.
  const { data: convs } = await svc
    .from('conversations')
    .select('id')
    .or(`participant_1.eq.${peerId},participant_2.eq.${peerId}`);
  for (const c of convs ?? []) {
    await svc.from('messages').delete().eq('conversation_id', c.id);
    await svc.from('conversations').delete().eq('id', c.id);
  }
  await clearSetupFixture();
});

test('start a DM from search and send a message (UI)', async ({ page }) => {
  const text = `E2E hello ${Date.now()}`;

  await page.goto('/messages');
  await page.getByRole('button', { name: 'New message' }).click();
  await page.getByPlaceholder(/search by name/i).fill(PEER_NAME);
  await page.getByText(PEER_NAME).first().click();

  const composer = page.getByPlaceholder('Message...');
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();

  // The bubble renders and the row persisted (not just optimistic paint).
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
  // The bubble paints optimistically before the INSERT promise settles. Poll
  // the database instead of racing a single immediate read against that write.
  await expect.poll(async () => {
    const { data } = await serviceClient().from('messages').select('id').eq('content', text);
    return data?.length ?? 0;
  }, {
    message: 'message row must exist server-side',
    timeout: 10_000,
  }).toBeGreaterThan(0);
});

test('blocking cuts message delivery at the RLS layer', async () => {
  const student = await userClient(USER_EMAIL, process.env.E2E_USER_PASSWORD!);
  const { data: conv } = await student
    .from('conversations')
    .select('id')
    .or(
      `and(participant_1.eq.${userId},participant_2.eq.${peerId}),and(participant_1.eq.${peerId},participant_2.eq.${userId})`,
    )
    .limit(1);
  let convId = conv?.[0]?.id;
  if (!convId) {
    // Self-sufficient when run in isolation: create the conversation the same
    // way the client does (sorted participants, pending, initiated by sender).
    const [p1, p2] = [userId, peerId].sort();
    const { data: created, error: createErr } = await student
      .from('conversations')
      .insert({ participant_1: p1, participant_2: p2, initiated_by: userId, status: 'pending' })
      .select('id')
      .single();
    expect(createErr, `conversation fixture failed: ${createErr?.message}`).toBeNull();
    convId = created!.id;
  }

  // The UI test's DM is a REQUEST (status pending, one message max until
  // accepted — rls_messages_insert). Accept as the peer so the send gate in
  // play below is the BLOCK, not the request gate.
  const { error: acceptErr } = await peer
    .from('conversations')
    .update({ status: 'accepted' })
    .eq('id', convId!);
  expect(acceptErr, `accept failed: ${acceptErr?.message}`).toBeNull();

  // Now the peer blocks the student.
  const { error: blockErr } = await peer
    .from('blocked_users')
    .insert({ blocker_id: peerId, blocked_id: userId });
  expect(blockErr, `block insert failed: ${blockErr?.message}`).toBeNull();

  // Sending into the blocked conversation must be refused server-side.
  const { data: sent, error } = await student
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_id: userId,
      content: `E2E must-not-deliver ${Date.now()}`,
    })
    .select('id');
  const refused = Boolean(error) || (sent ?? []).length === 0;
  expect(refused, 'RLS must refuse a message into a blocked conversation').toBe(true);

  // And a NEW conversation between the blocked pair must be refused too.
  const { data: newConv, error: convErr } = await student
    .from('conversations')
    .insert({
      participant_1: userId < peerId ? userId : peerId,
      participant_2: userId < peerId ? peerId : userId,
      initiated_by: userId,
      status: 'pending',
    })
    .select('id');
  const convRefused = Boolean(convErr) || (newConv ?? []).length === 0;
  expect(convRefused, 'RLS must refuse a new conversation with a blocker').toBe(true);

  // Unblock → delivery works again (the block, not something else, was the gate).
  await peer.from('blocked_users').delete().eq('blocker_id', peerId).eq('blocked_id', userId);
  const { error: afterUnblock } = await student
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_id: userId,
      content: `E2E after-unblock ${Date.now()}`,
    })
    .select('id')
    .single();
  expect(afterUnblock, 'after unblock the send should succeed').toBeNull();
});

test('send a DM photo and poll, vote, and react through the browser', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
    class DeterministicMediaRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/mp4';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? this.mimeType;
      }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['dormcheck-e2e-audio'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: DeterministicMediaRecorder });
  });
  // Local E2E has no moderation-provider secret. Keep Storage + message writes
  // real while making only the external screening verdict deterministic.
  await page.route('**/functions/v1/moderate-image', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decision: 'approve' }) });
  });
  const svc = serviceClient();
  const { data: conversations, error: conversationError } = await svc
    .from('conversations')
    .select('id')
    .or(`and(participant_1.eq.${userId},participant_2.eq.${peerId}),and(participant_1.eq.${peerId},participant_2.eq.${userId})`)
    .limit(1);
  expect(conversationError).toBeNull();
  let conversationId = conversations?.[0]?.id;
  if (!conversationId) {
    const [participant1, participant2] = [userId, peerId].sort();
    const { data: created, error: createError } = await svc
      .from('conversations')
      .insert({
        participant_1: participant1,
        participant_2: participant2,
        initiated_by: userId,
        status: 'accepted',
      })
      .select('id')
      .single();
    expect(createError, `conversation fixture failed: ${createError?.message}`).toBeNull();
    conversationId = created!.id;
  } else {
    await svc.from('conversations').update({ status: 'accepted' }).eq('id', conversationId);
  }
  await svc.from('profiles').update({
    legal_notice_ack_version: LEGAL_NOTICE_VERSION,
    legal_notice_ack_at: new Date().toISOString(),
  }).eq('id', userId);

  await page.goto('/messages');
  await page.getByText(PEER_NAME).first().click();
  await expect(page.getByPlaceholder('Message...')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Share something' }).click();
  await page.getByRole('menuitem', { name: 'Photo library' }).click();
  // The shared picker appends a short-lived file input. Targeting it directly
  // is deterministic in headless Chromium, where a programmatic input.click()
  // does not consistently emit Playwright's filechooser event.
  const photoInput = page.locator('input[type="file"]').last();
  await expect(photoInput).toBeAttached();
  await photoInput.setInputFiles(path.join(HERE, 'fixtures', 'listing.png'));
  await expect.poll(async () => {
    const { data } = await svc
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId!)
      .eq('content', '📷 Photo');
    return data?.length ?? 0;
  }, { timeout: 20_000, message: 'photo message must persist after Storage upload' }).toBeGreaterThan(0);
  await expect(page.getByRole('img', { name: /photo/i }).last()).toBeVisible({ timeout: 20_000 });

  const question = `Move-in time ${Date.now()}?`;
  await page.getByRole('button', { name: 'Share something' }).click();
  await page.getByRole('menuitem', { name: 'Create a poll' }).click();
  await page.getByRole('textbox', { name: 'Poll question' }).fill(question);
  await page.getByRole('textbox', { name: 'Poll option 1' }).fill('Morning');
  await page.getByRole('textbox', { name: 'Poll option 2' }).fill('Evening');
  await page.getByRole('button', { name: 'Send poll' }).click();
  await expect(page.getByText(question)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Morning/ }).click();

  await page.getByText(question, { exact: true }).last().hover();
  const addReaction = page.getByRole('button', { name: 'Add reaction' }).last();
  await addReaction.click();
  await page.getByRole('button', { name: 'React with ❤️' }).click();

  await expect.poll(async () => {
    const { count } = await svc
      .from('message_reactions')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId!);
    return count ?? 0;
  }, { timeout: 10_000, message: 'reaction must persist' }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const { count } = await svc
      .from('dm_poll_votes')
      .select('message_id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId!);
    return count ?? 0;
  }, { timeout: 10_000, message: 'poll vote must persist' }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Record voice message' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording voice message' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording voice message' }).click();
  await expect.poll(async () => {
    const { data } = await svc
      .from('messages')
      .select('metadata')
      .eq('conversation_id', conversationId!)
      .eq('content', 'Voice message');
    return (data ?? []).some((row) => (row.metadata as { type?: string } | null)?.type === 'audio');
  }, { timeout: 15_000, message: 'voice message and private Storage metadata must persist' }).toBe(true);
});

test('upload and save a profile avatar through the browser', async ({ page }) => {
  await page.route('**/functions/v1/moderate-image', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decision: 'approve' }) });
  });
  const svc = serviceClient();
  await svc.from('profiles').update({
    legal_notice_ack_version: LEGAL_NOTICE_VERSION,
    legal_notice_ack_at: new Date().toISOString(),
    avatar_url: null,
    major: 'Computer Science',
  }).eq('id', userId);

  await page.goto('/profile');
  await page.getByRole('button', { name: 'Change avatar' }).click();
  const input = page.locator('input[type="file"]').last();
  await expect(input).toBeAttached();
  await input.setInputFiles(path.join(HERE, 'fixtures', 'listing.png'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();

  await expect.poll(async () => {
    const { data } = await svc.from('profiles').select('avatar_url').eq('id', userId).single();
    return data?.avatar_url ?? null;
  }, { timeout: 20_000, message: 'profile avatar URL must persist' }).not.toBeNull();
});

test('upload a room setup through the browser and persist its photo', async ({ page }) => {
  await clearSetupFixture();
  await serviceClient().from('profiles').update({
    legal_notice_ack_version: LEGAL_NOTICE_VERSION,
    legal_notice_ack_at: new Date().toISOString(),
  }).eq('id', userId);
  await page.route('**/functions/v1/moderate-image', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ decision: 'approve' }),
    });
  });

  await page.goto('/campus/litchfield-towers-a?tab=setups&share=1');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.getByText(/tap to upload/i).click();
  const input = page.locator('input[type="file"]').last();
  await expect(input).toBeAttached();
  await input.setInputFiles(path.resolve(HERE, '..', 'public', 'student-setup-1.png'));
  await page.locator('#setup-author-name').fill('E2E Setup Student');
  await page.locator('#setup-caption').fill(`E2E setup ${Date.now()}`);
  await page.getByRole('button', { name: 'Upload Setup' }).click();

  await expect.poll(async () => {
    const { data } = await serviceClient()
      .from('student_setups')
      .select('id, image_url, setup_photos(id)')
      .eq('user_id', userId)
      .eq('dorm_id', SETUP_DORM_ID)
      .maybeSingle();
    return Boolean(data?.image_url && data.setup_photos?.length);
  }, { timeout: 25_000, message: 'setup row and photo row must persist' }).toBe(true);

  // The cleanup-enabling SELECT policy must not restore cross-user object
  // enumeration. The peer is authenticated but cannot list this user's prefix.
  const { data: foreignObjects, error: foreignListError } = await peer.storage
    .from('setup-photos')
    .list(userId, { limit: 100 });
  expect(foreignListError).toBeNull();
  expect(foreignObjects ?? []).toHaveLength(0);
});

test('moderation refusal leaves no setup row or setup-photo orphan', async ({ page }) => {
  await clearSetupFixture();
  await page.route('**/functions/v1/moderate-image', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ decision: 'reject', reason: 'E2E refusal' }),
    });
  });

  await page.goto('/campus/litchfield-towers-a?tab=setups&share=1');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.getByText(/tap to upload/i).click();
  const input = page.locator('input[type="file"]').last();
  await expect(input).toBeAttached();
  await input.setInputFiles(path.resolve(HERE, '..', 'public', 'student-setup-1.png'));
  await page.locator('#setup-author-name').fill('E2E Setup Student');
  await page.getByRole('button', { name: 'Upload Setup' }).click();
  await expect(page.getByText(/flagged by the automatic safety check/i)).toBeVisible({ timeout: 20_000 });

  await expect.poll(async () => {
    const svc = serviceClient();
    const [{ count }, { data: objects }] = await Promise.all([
      svc.from('student_setups').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('dorm_id', SETUP_DORM_ID),
      svc.storage.from('setup-photos').list(userId, { limit: 100 }),
    ]);
    return {
      rows: count ?? 0,
      // Supabase may retain its synthetic folder marker after the last real
      // object is deleted; it is not an uploaded image or billable orphan.
      objects: (objects ?? [])
        .map((object) => object.name)
        .filter((name) => name !== '.emptyFolderPlaceholder'),
    };
  }, { timeout: 15_000, message: 'rejected setup upload must be fully cleaned up' })
    .toEqual({ rows: 0, objects: [] });
});
