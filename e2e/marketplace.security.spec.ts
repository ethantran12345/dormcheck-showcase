import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  serviceClient,
  userClient,
  ensureUser,
  FIXTURE_PASSWORD,
  PITT_UNIVERSITY_ID,
  CMU_UNIVERSITY_ID,
} from './lib/api';

/**
 * Marketplace server-refusal suite (no browser).
 *
 * Every test here asserts what the SERVER enforces — RLS predicates and the
 * moderation guard triggers — via direct authenticated Supabase clients. The
 * client-side moderation flag was the bug that opened the 2026-08 security
 * audit; a UI test can only prove the button is hidden, so these prove the
 * refusal itself. Guard style is restore-not-raise (triggers put OLD values
 * back rather than erroring), so assertions check END STATE, never error text.
 */

const A_EMAIL = 'e2e-sec-pitt-a@pitt.edu';
const B_EMAIL = 'e2e-sec-pitt-b@pitt.edu';
// CMU tenant membership comes from profiles.university_id (same pattern as
// scripts/seed-tenant-isolation.mjs) — the signup domain gate is a separate
// layer with its own spec in auth.flows.
const CMU_EMAIL = 'e2e-sec-cmu@pitt.edu';

let pittA: SupabaseClient;
let pittB: SupabaseClient;
let cmu: SupabaseClient;
let pittAId: string;
const cleanup: Array<() => Promise<void>> = [];

test.beforeAll(async () => {
  pittAId = await ensureUser(A_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: 'Sec Pitt A' });
  await ensureUser(B_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: 'Sec Pitt B' });
  await ensureUser(CMU_EMAIL, { universityId: CMU_UNIVERSITY_ID, fullName: 'Sec CMU' });
  pittA = await userClient(A_EMAIL, FIXTURE_PASSWORD);
  pittB = await userClient(B_EMAIL, FIXTURE_PASSWORD);
  cmu = await userClient(CMU_EMAIL, FIXTURE_PASSWORD);
});

test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {});
});

/** Insert a business listing as the given client, return its id. */
async function insertBusiness(client: SupabaseClient, name: string, extra: object = {}) {
  const { data: me } = await client.auth.getUser();
  const { data, error } = await client
    .from('business_listings')
    .insert({
      user_id: me.user!.id, // INSERT policy's WITH CHECK asserts ownership
      business_name: name,
      description: 'e2e fixture',
      category: 'Tutoring',
      ...extra,
    })
    .select('id, is_approved')
    .single();
  expect(error, `business insert failed: ${error?.message}`).toBeNull();
  const svc = serviceClient();
  cleanup.push(async () => {
    await svc.from('business_listings').delete().eq('id', data!.id);
  });
  return data as { id: string; is_approved: boolean };
}

test.describe('business listing moderation gate (server-enforced)', () => {
  test('a listing cannot be born approved — INSERT forces is_approved=false', async () => {
    const row = await insertBusiness(pittA, 'E2E born-approved attempt', { is_approved: true });
    // The BEFORE INSERT trigger (protect_business_listing_moderation) must have
    // zeroed the smuggled flag server-side, whatever the client sent.
    expect(row.is_approved).toBe(false);
  });

  test('the owner cannot approve their own listing — UPDATE restores the flag', async () => {
    const row = await insertBusiness(pittA, 'E2E self-approve attempt');
    const { error } = await pittA
      .from('business_listings')
      .update({ is_approved: true })
      .eq('id', row.id);
    // Restore-not-raise: the update "succeeds" but the moderation column is put
    // back from OLD. Read the end state with service role (RLS-free truth).
    expect(error).toBeNull();
    const { data: after } = await serviceClient()
      .from('business_listings')
      .select('is_approved')
      .eq('id', row.id)
      .single();
    expect(after?.is_approved).toBe(false);
  });

  test('owner cannot reassign a listing to another user or tenant', async () => {
    const row = await insertBusiness(pittA, 'E2E retarget attempt');
    await pittA
      .from('business_listings')
      .update({ university_id: CMU_UNIVERSITY_ID, is_approved: true })
      .eq('id', row.id);
    const { data: after } = await serviceClient()
      .from('business_listings')
      .select('is_approved, university_id, user_id')
      .eq('id', row.id)
      .single();
    expect(after?.is_approved).toBe(false);
    expect(after?.university_id).toBe(PITT_UNIVERSITY_ID);
    expect(after?.user_id).toBe(pittAId);
  });

  test('approved listings are visible same-tenant only', async () => {
    const row = await insertBusiness(pittA, 'E2E tenant-scope check');
    // Legitimate approval path: service role (auth.uid() IS NULL) is the same
    // privilege class the moderation tooling uses; the trigger admits it.
    const { error: approveErr } = await serviceClient()
      .from('business_listings')
      .update({ is_approved: true })
      .eq('id', row.id);
    expect(approveErr).toBeNull();

    const { data: sameTenant } = await pittB
      .from('business_listings')
      .select('id')
      .eq('id', row.id);
    expect(sameTenant, 'same-university student should see the approved listing').toHaveLength(1);

    const { data: crossTenant } = await cmu.from('business_listings').select('id').eq('id', row.id);
    expect(crossTenant, 'cross-university student must not see it').toHaveLength(0);
  });
});

test.describe('student listing moderation + tenant isolation (server-enforced)', () => {
  /** Create a pitt-A student listing via the service role in a known status. */
  async function fixtureListing(status: string) {
    const { data, error } = await serviceClient()
      .from('marketplace_listings')
      .insert({
        user_id: pittAId,
        university_id: PITT_UNIVERSITY_ID,
        title: `E2E sec listing ${status} ${Date.now()}`,
        price: 10,
        category: 'Appliances',
        status,
      })
      .select('id')
      .single();
    expect(error, `fixture listing failed: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    cleanup.push(async () => {
      await serviceClient().from('marketplace_listings').delete().eq('id', id);
    });
    return id;
  }

  test('a new listing cannot skip pre-moderation — INSERT lands pending_review', async () => {
    const { data, error } = await pittA
      .from('marketplace_listings')
      .insert({
        user_id: pittAId,
        title: `E2E skip-moderation attempt ${Date.now()}`,
        price: 5,
        category: 'Appliances',
        status: 'available', // smuggled — the trigger must override it
      })
      .select('id, status')
      .single();
    expect(error, `insert failed: ${error?.message}`).toBeNull();
    cleanup.push(async () => {
      await serviceClient().from('marketplace_listings').delete().eq('id', data!.id);
    });
    expect(data!.status).toBe('pending_review');
  });

  test('owner cannot promote an under-review listing to available', async () => {
    const id = await fixtureListing('under_review');
    await pittA.from('marketplace_listings').update({ status: 'available' }).eq('id', id);
    const { data: after } = await serviceClient()
      .from('marketplace_listings')
      .select('status')
      .eq('id', id)
      .single();
    expect(after?.status).toBe('under_review');
  });

  // READ IS OPEN ACROSS THE GROUP, WRITE IS NOT. `20260918000000_shared_marketplace_group.sql`
  // puts Pitt and CMU in the `pittsburgh` marketplace group and states the invariant
  // in its header: you may SEE any listing from a school in your group, you may only
  // WRITE into your own. This spec used to assert that CMU could not read a Pitt
  // listing, which was true before that migration and has been a false alarm since —
  // it failed on the read line while the update/delete lines (the half that is
  // actually a security boundary) passed. Asserting the read is DENIED here would
  // now be asserting the shared marketplace is broken.
  //
  // GAP WORTH CLOSING: both fixtures are in-group, so nothing here covers a school
  // with a NULL or different `marketplace_group` (Carlow is deliberately left
  // isolated by that migration). That case needs a third fixture user and is the
  // test that would actually catch the group widening past its declared membership.
  test('same-group user may read a Pitt listing but can neither update nor delete it', async () => {
    const id = await fixtureListing('available');

    const { data: read } = await cmu.from('marketplace_listings').select('id').eq('id', id);
    expect(read, 'a same-group (pittsburgh) user must be able to SEE a Pitt listing').toHaveLength(1);

    await cmu.from('marketplace_listings').update({ title: 'hijacked' }).eq('id', id);
    await cmu.from('marketplace_listings').delete().eq('id', id);

    const { data: after } = await serviceClient()
      .from('marketplace_listings')
      .select('title, status')
      .eq('id', id)
      .single();
    expect(after, 'listing must survive cross-tenant delete').toBeTruthy();
    expect(after?.title).not.toBe('hijacked');
  });

  test('contact columns stay column-granted — select(*) is refused outright', async () => {
    // SEC-6 canary: if someone re-grants table-wide SELECT, this starts passing
    // silently in the app and leaking phone/instagram/snapchat. 42501 is the
    // contract.
    const { error } = await pittA.from('marketplace_listings').select('*').limit(1);
    expect(error?.code, 'expected 42501 permission denied for select(*)').toBe('42501');
  });
});

test.describe('guest (anon) marketplace projection', () => {
  test('marketplace_public exposes only live rows and no contact channels', async () => {
    // The view's WHERE is status IN (available,pending) AND NOT sublease AND
    // moderation_decision = 'approved' — an unmoderated (NULL) row stays hidden.
    const svcRows = [
      { title: `E2E anon visible ${Date.now()}`, status: 'available', moderation_decision: 'approved' },
      { title: `E2E anon hidden ${Date.now()}`, status: 'under_review' },
    ];
    const ids: string[] = [];
    for (const r of svcRows) {
      const { data, error } = await serviceClient()
        .from('marketplace_listings')
        .insert({
          user_id: pittAId,
          university_id: PITT_UNIVERSITY_ID,
          price: 12,
          category: 'Appliances',
          show_phone: true, // even when the owner opts in…
          ...r,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      ids.push(data!.id);
      cleanup.push(async () => {
        await serviceClient().from('marketplace_listings').delete().eq('id', data!.id);
      });
    }

    const anon = anonClient();
    const { data: rows, error } = await anon
      .from('marketplace_public')
      .select('id, title, show_phone, show_instagram, show_snapchat')
      .in('id', ids);
    expect(error, `anon read failed: ${error?.message}`).toBeNull();

    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(byId.has(ids[0]), 'available listing must be guest-visible').toBe(true);
    expect(byId.has(ids[1]), 'under_review listing must be hidden from guests').toBe(false);
    // …the guest projection pins every contact flag to false.
    expect(byId.get(ids[0])?.show_phone).toBe(false);
    expect(byId.get(ids[0])?.show_instagram).toBe(false);
    expect(byId.get(ids[0])?.show_snapchat).toBe(false);
  });

  test('anon cannot read the base marketplace_listings table at all', async () => {
    const { data, error } = await anonClient()
      .from('marketplace_listings')
      .select('id')
      .limit(1);
    // Either an explicit permission error or an empty RLS result is acceptable;
    // any row coming back is the leak.
    if (error) return; // refused outright — fine
    expect(data).toHaveLength(0);
  });
});

test.describe('seller rating integrity', () => {
  test('a rater cannot retarget an existing rating at another seller', async () => {
    const bId = await ensureUser(B_EMAIL); // seller
    const cmuId = await ensureUser(CMU_EMAIL);
    const svc = serviceClient();
    const { data: rating, error } = await svc
      .from('seller_ratings')
      .insert({ seller_id: bId, rater_id: pittAId, stars: 5 })
      .select('id')
      .single();
    expect(error, `rating fixture failed: ${error?.message}`).toBeNull();
    cleanup.push(async () => {
      await svc.from('seller_ratings').delete().eq('id', rating!.id);
    });

    await pittA
      .from('seller_ratings')
      .update({ seller_id: cmuId, stars: 1 })
      .eq('id', rating!.id);

    const { data: after } = await svc
      .from('seller_ratings')
      .select('seller_id, rater_id')
      .eq('id', rating!.id)
      .single();
    // protect_seller_rating_target restores both identity columns.
    expect(after?.seller_id).toBe(bId);
    expect(after?.rater_id).toBe(pittAId);
  });
});
