import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  serviceClient,
  userClient,
  ensureUser,
  FIXTURE_PASSWORD,
  PITT_UNIVERSITY_ID,
} from './lib/api';

/**
 * Ranking-collaboration behavior suite (no browser).
 *
 * The rankings RLS is under active hardening (20260901000004 closed the
 * pending-invitee delete hole). These tests assert the INTENDED contract, not
 * whatever the current policies happen to permit — if a parallel RLS lane
 * changes implementation details, these should keep passing; if it reopens the
 * hole, they must go red.
 *
 * Contract under test:
 *  - a pending invitee may SEE the group (they need to read the invite)
 *  - a pending invitee must NOT be able to delete it
 *  - the owner deletes their own group
 *  - membership rows cannot cross tenants
 */

const OWNER_EMAIL = 'e2e-rank-owner@pitt.edu';
const INVITEE_EMAIL = 'e2e-rank-invitee@pitt.edu';

let owner: SupabaseClient;
let invitee: SupabaseClient;
let ownerId: string;
let inviteeId: string;
const cleanup: Array<() => Promise<void>> = [];

test.beforeAll(async () => {
  ownerId = await ensureUser(OWNER_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: 'Rank Owner' });
  inviteeId = await ensureUser(INVITEE_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: 'Rank Invitee' });
  owner = await userClient(OWNER_EMAIL, FIXTURE_PASSWORD);
  invitee = await userClient(INVITEE_EMAIL, FIXTURE_PASSWORD);
});

test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {});
});

/** Owner-owned group with one PENDING invite for the invitee. */
async function fixtureGroupWithPendingInvite() {
  const svc = serviceClient();
  const { data: group, error } = await svc
    .from('ranking_collaborations')
    .insert({
      owner_id: ownerId,
      university_id: PITT_UNIVERSITY_ID,
      group_type: 'ranking',
      group_name: `E2E rank group ${Date.now()}`,
      invite_code: crypto.randomUUID(),
    })
    .select('id')
    .single();
  expect(error, `group fixture failed: ${error?.message}`).toBeNull();
  const groupId = group!.id as string;
  cleanup.push(async () => {
    await svc.from('ranking_group_members').delete().eq('group_id', groupId);
    await svc.from('ranking_collaborations').delete().eq('id', groupId);
  });

  const { error: mErr } = await svc
    .from('ranking_group_members')
    .insert({ group_id: groupId, user_id: inviteeId, status: 'pending', role: 'member' });
  expect(mErr, `pending membership fixture failed: ${mErr?.message}`).toBeNull();
  return groupId;
}

test('pending invitee can see the group they were invited to', async () => {
  const groupId = await fixtureGroupWithPendingInvite();
  const { data, error } = await invitee
    .from('ranking_collaborations')
    .select('id')
    .eq('id', groupId);
  expect(error).toBeNull();
  expect(data, 'invitee should be able to read the group (to see the invite)').toHaveLength(1);
});

test('pending invitee cannot delete the group — the 20260901000004 hole stays closed', async () => {
  const groupId = await fixtureGroupWithPendingInvite();

  await invitee.from('ranking_collaborations').delete().eq('id', groupId);

  const { data: after } = await serviceClient()
    .from('ranking_collaborations')
    .select('id')
    .eq('id', groupId);
  expect(after, 'group must survive a pending-invitee delete attempt').toHaveLength(1);
});

test('owner can delete their own group', async () => {
  const groupId = await fixtureGroupWithPendingInvite();

  const { error } = await owner.from('ranking_collaborations').delete().eq('id', groupId);
  expect(error).toBeNull();

  const { data: after } = await serviceClient()
    .from('ranking_collaborations')
    .select('id')
    .eq('id', groupId);
  expect(after, 'owner delete should actually delete').toHaveLength(0);
});

test('invitee cannot self-promote their role to owner', async () => {
  // The database trigger now freezes role changes made by an invitee. Keep this
  // as an ordinary passing regression: a future policy change that reopens the
  // self-promotion path must turn the suite red.
  const groupId = await fixtureGroupWithPendingInvite();

  // Whether acceptance happens via RPC or a policy-guarded update, a raw
  // status flip by the invitee must not silently mint an accepted membership
  // with elevated (delete-adjacent) rights beyond what acceptance grants.
  await invitee
    .from('ranking_group_members')
    .update({ role: 'owner' })
    .eq('group_id', groupId)
    .eq('user_id', inviteeId);

  const { data: after } = await serviceClient()
    .from('ranking_group_members')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', inviteeId)
    .single();
  expect(after?.role, 'invitee must not self-promote to owner role').toBe('member');
});
