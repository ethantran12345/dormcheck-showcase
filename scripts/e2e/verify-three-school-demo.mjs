#!/usr/bin/env node
/** Authenticated, local-only proof for the three-school demo seed. */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEMO_SCHOOLS, assertLocalUrl, demoEmail, fixtureIds } from './seed-three-school-demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env.e2e') });

const URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const PASSWORD = process.env.E2E_THREE_SCHOOL_PASSWORD || process.env.E2E_USER_PASSWORD || 'E2eUser!Passw0rd';

const fail = (message) => { throw new Error(message); };
const expectCount = (label, rows, expected) => {
  if ((rows?.length ?? 0) !== expected) fail(`${label}: expected ${expected}, got ${rows?.length ?? 0}`);
};

async function query(client, table, columns, ids, idColumn = 'id') {
  const result = await client.from(table).select(columns).in(idColumn, ids);
  if (result.error) fail(`${table} read: ${result.error.message}`);
  return result.data ?? [];
}

async function writeProbe(client, school, viewerId, hallName, index) {
  const suffix = `${index + 1}`.padStart(3, '0');
  const probes = [
    {
      table: 'marketplace_listings',
      id: `d3300000-0000-4000-8000-000000000${suffix}`,
      row: {
        user_id: viewerId, university_id: school.id, post_type: 'item',
        title: `[LOCAL PROBE · ${school.shortName}] item`, description: 'Temporary local RLS probe.',
        price: 1, category: 'Supplies', status: 'available', payment_methods: ['cash'], show_phone: false,
      },
    },
    {
      table: 'marketplace_listings',
      id: `d3400000-0000-4000-8000-000000000${suffix}`,
      row: {
        user_id: viewerId, university_id: school.id, post_type: 'sublease',
        title: school.address, description: 'Temporary local sublease RLS probe.', price: 1,
        category: 'Housing', status: 'available', building_name: school.address,
        sublease_start: '2027-05-15', sublease_end: '2027-08-15', payment_methods: [],
        show_phone: false,
      },
    },
    {
      table: 'roommate_search_posts',
      id: `d3500000-0000-4000-8000-000000000${suffix}`,
      row: {
        user_id: viewerId, university_id: school.id, post_type: 'looking-for-roommates',
        content: `Temporary ${school.shortName} local roommate write probe.`, spots_total: 1,
        spots_filled: 0, is_active: true, utilities_included: [], photos: [],
        show_phone: false, show_instagram: false, show_snapchat: false,
      },
    },
  ];

  for (const probe of probes) {
    const inserted = await client.from(probe.table).insert({ id: probe.id, ...probe.row }).select('id').single();
    if (inserted.error) fail(`${school.shortName} ${probe.table} write: ${inserted.error.message}`);
    const removed = await client.from(probe.table).delete().eq('id', probe.id);
    if (removed.error) fail(`${school.shortName} ${probe.table} cleanup: ${removed.error.message}`);
  }

  const setup = await client.from('student_setups').insert({
    user_id: viewerId,
    university_id: school.id,
    dorm_name: hallName,
    image_url: `https://placehold.co/900x1100/575047/ffffff?text=LOCAL+WRITE+PROBE+${school.shortName}`,
    caption: `Temporary ${school.shortName} local setup write probe.`,
    tags: [],
  }).select('id').single();
  if (setup.error) fail(`${school.shortName} student_setups write: ${setup.error.message}`);
  const setupRemoved = await client.from('student_setups').delete().eq('id', setup.data.id);
  if (setupRemoved.error) fail(`${school.shortName} student_setups cleanup: ${setupRemoved.error.message}`);
}

async function main() {
  assertLocalUrl(URL);
  if (!ANON_KEY) fail('Missing VITE_SUPABASE_ANON_KEY in .env.e2e.');

  for (const [index, school] of DEMO_SCHOOLS.entries()) {
    const client = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email: demoEmail(school, 'viewer'), password: PASSWORD });
    if (signedIn.error || !signedIn.data.user) fail(`${school.shortName} sign-in: ${signedIn.error?.message || 'no user'}`);

    const marketplace = await query(client, 'marketplace_listings', 'id, university_id, post_type, title', [...fixtureIds.item, ...fixtureIds.sublease]);
    expectCount(`${school.shortName} shared marketplace`, marketplace, 6);
    expectCount(`${school.shortName} shared items`, marketplace.filter((r) => r.post_type === 'item'), 3);
    expectCount(`${school.shortName} shared subleases`, marketplace.filter((r) => r.post_type === 'sublease'), 3);

    const setups = await query(client, 'student_setups', 'id, university_id, dorm_name', fixtureIds.setup);
    expectCount(`${school.shortName} tenant setups`, setups, 1);
    if (setups[0].university_id !== school.id) fail(`${school.shortName} saw another school's setup.`);

    const hostNames = DEMO_SCHOOLS.map((other) => `${other.shortName} Demo Student B`);
    const roommates = await query(client, 'roommate_profiles', 'id, university_id, full_name', hostNames, 'full_name');
    expectCount(`${school.shortName} tenant roommates`, roommates, 1);
    if (roommates[0].university_id !== school.id) fail(`${school.shortName} saw another school's roommate profile.`);

    await writeProbe(client, school, signedIn.data.user.id, setups[0].dorm_name, index);
    await client.auth.signOut();
    console.log(`✓ ${school.shortName}: 3 items + 3 subleases shared; 1 setup + 1 roommate scoped; four write paths passed`);
  }

  console.log('\nThree-school demo verification passed.');
}

main().catch((error) => {
  console.error(`Three-school demo verification failed: ${error?.message || error}`);
  process.exit(1);
});
