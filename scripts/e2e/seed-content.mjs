#!/usr/bin/env node
/**
 * Seed real CONTENT into the LOCAL Supabase stack so authed surfaces render
 * something instead of empty states. Companion to seed-test-users.mjs (run it
 * AFTER users exist — this attaches content to the seeded e2e user).
 *
 * What it seeds (idempotent — fixed PKs + upsert, safe to re-run):
 *   · 3 dorms          (master_housing)      → housing explore / rankings / detail
 *   · 6 checklist items (checklist_items)    → the e2e user's checklist
 *   · 1 marketplace listing (marketplace_listings)
 *   · 1 roommate post  (roommate_search_posts)
 *
 * Seeds via the service-role key, which BYPASSES RLS — so every owner column
 * (user_id) is set explicitly to the seeded user rather than relying on auth.uid().
 *
 * Refuses to run against anything that isn't a local Supabase URL.
 *
 * AUDIT_LONG_CONTENT=1 (set by run-audit.sh for AUDIT_LAYOUT=1) adds real-length
 * text so the layout crawl can see cut-offs: a 40-char building name (and the
 * e2e user's current_dorm pointing at it), a 120-char listing title from a seller
 * with a long display name (the admin persona), and a long checklist item. All of
 * it is from e2e/fixtures/long-content.json and labelled as a fixture: no
 * real-looking students, listings or reviews.
 *
 * Usage: node scripts/e2e/seed-content.mjs   (loads .env.e2e)
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env.e2e') });

const URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e+user@pitt.edu';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e+admin@pitt.edu';

if (!URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.e2e');
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`Refusing to seed: ${URL} is not a local Supabase stack. This script is local-only.`);
  process.exit(1);
}

const PITT_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000001';

const db = createClient(URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function userIdByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  throw new Error(`Seeded user ${email} not found — run \`npm run audit:app:seed\` first.`);
}

/** Prefer a real universities row; fall back to the known Pitt id. */
async function resolveUniversityId() {
  const { data } = await db.from('universities').select('id').eq('id', PITT_UNIVERSITY_ID).maybeSingle();
  if (data?.id) return data.id;
  const { data: any } = await db.from('universities').select('id').limit(1).maybeSingle();
  if (any?.id) return any.id;
  console.warn(`⚠ no universities row found; using Pitt id ${PITT_UNIVERSITY_ID} — inserts may FK-fail.`);
  return PITT_UNIVERSITY_ID;
}

async function upsert(table, rows, onConflict = 'id') {
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`✓ ${table}  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
}

async function main() {
  const userId = await userIdByEmail(USER_EMAIL);
  const universityId = await resolveUniversityId();

  // ── Dorms (bigint PK — use a high, collision-safe range) ──────────────────
  await upsert('master_housing', [
    {
      id: 990001,
      university_id: universityId,
      residence_hall: 'Litchfield Towers A',
      housing_type: 'Traditional',
      community_type: 'First-Year',
      who_lives_here: 'First-year students',
      capacity: '~1,900 across all three towers',
      details: 'Iconic round high-rise at the heart of campus, steps from Market To-Go.',
      building_amenities: 'Dining, laundry, study lounges, 24/7 front desk',
      inroom_amenities: 'Extra-long twin beds, wardrobes, desks',
      laundry: 'In-building, card-operated',
      wifi_and_cable: true,
      heat_and_air_conditioning: true,
      latitude: 40.4436,
      longitude: -79.9581,
      image_url: 'https://placehold.co/800x600/03C03C/ffffff?text=Towers+A',
    },
    {
      id: 990002,
      university_id: universityId,
      residence_hall: 'Sutherland Hall',
      housing_type: 'Suite',
      community_type: 'Upper-Class',
      who_lives_here: 'Sophomores and above',
      capacity: '~900',
      details: 'Suite-style living up on the hill with skyline views.',
      building_amenities: 'Fitness room, shuttle stop, market',
      inroom_amenities: 'Semi-private baths, shared common room',
      laundry: 'In-building',
      wifi_and_cable: true,
      heat_and_air_conditioning: true,
      latitude: 40.4472,
      longitude: -79.9536,
      image_url: 'https://placehold.co/800x600/2B6D4F/ffffff?text=Sutherland',
    },
    {
      id: 990003,
      university_id: universityId,
      residence_hall: 'Nordenberg Hall',
      housing_type: 'Suite',
      community_type: 'Mixed',
      who_lives_here: 'First-year and upper-class',
      capacity: '~500',
      details: 'Modern suite-style hall next to the Petersen Events Center.',
      building_amenities: 'Ground-floor dining, study spaces',
      inroom_amenities: 'Private baths, in-suite kitchenette',
      laundry: 'In-building',
      wifi_and_cable: true,
      heat_and_air_conditioning: true,
      latitude: 40.4443,
      longitude: -79.9627,
      image_url: 'https://placehold.co/800x600/1F4D39/ffffff?text=Nordenberg',
    },
  ]);

  // ── Checklist items for the e2e user ──────────────────────────────────────
  // Every row carries the SAME key set: supabase-js builds one multi-row insert
  // and sends explicit NULL for any column missing from a given row, which a
  // NOT NULL column (is_night_one) rejects even though it has a DEFAULT.
  const cid = (n) => `c0000000-0000-4000-8000-00000000000${n}`;
  await upsert('checklist_items', [
    { id: cid(1), user_id: userId, category: 'Bedding', item: 'Twin XL sheet set', status: 'need', is_night_one: true, position: 0 },
    { id: cid(2), user_id: userId, category: 'Bedding', item: 'Mattress topper', status: 'bought', is_night_one: false, position: 1 },
    { id: cid(3), user_id: userId, category: 'Bathroom', item: 'Shower caddy', status: 'need', is_night_one: false, position: 2 },
    { id: cid(4), user_id: userId, category: 'Bathroom', item: 'Quick-dry towels', status: 'packed', is_night_one: true, position: 3 },
    { id: cid(5), user_id: userId, category: 'Electronics', item: 'Surge protector', status: 'need', is_night_one: false, position: 4 },
    { id: cid(6), user_id: userId, category: 'Electronics', item: 'HDMI cable', status: 'skip', is_night_one: false, position: 5 },
  ]);

  // ── Marketplace listing (user_id → profiles.id, which = auth user id) ──────
  await upsert('marketplace_listings', [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      user_id: userId,
      university_id: universityId,
      title: 'Mini fridge — barely used, one semester',
      description: 'Compact 3.2 cu ft fridge, perfect for a dorm. Freezer works great.',
      price: 65,
      category: 'Appliances',
      condition: 'Like New',
      status: 'available',
      meetup_location: 'Litchfield Towers lobby',
      show_phone: false,
      payment_methods: ['venmo', 'cash'],
      image_url: 'https://placehold.co/800x600/03C03C/ffffff?text=Mini+Fridge',
    },
  ]);

  // ── Roommate post ─────────────────────────────────────────────────────────
  await upsert('roommate_search_posts', [
    {
      id: 'b0000000-0000-4000-8000-000000000001',
      user_id: userId,
      university_id: universityId,
      post_type: 'looking-for-roommates',
      content: 'CS major, clean and quiet, looking for 1–2 roommates for a South Oakland apartment next fall.',
      budget_max: 800,
      preferred_areas: ['South Oakland', 'Central Oakland'],
      move_in_semester: 'Fall',
      spots_total: 2,
      spots_filled: 0,
      is_active: true,
      interest_count: 0,
      housing_type: 'off-campus',
      gender_preference: 'any',
      utilities_included: [],
      photos: [],
      show_phone: false,
      show_instagram: false,
      show_snapchat: false,
    },
  ]);

  if (process.env.AUDIT_LONG_CONTENT === '1') await seedLongContent(userId, universityId);

  console.log('\nContent seed complete.');
}

async function seedLongContent(userId, universityId) {
  const long = JSON.parse(fs.readFileSync(path.join(root, 'e2e/fixtures/long-content.json'), 'utf8'));
  // The whole point is the length; refuse a fixture that drifted.
  const want = { buildingName: 40, listingTitle: 120 };
  for (const [k, n] of Object.entries(want)) {
    if (long[k].length !== n) throw new Error(`long-content.json ${k} is ${long[k].length} chars, expected ${n}`);
  }
  const adminId = await userIdByEmail(ADMIN_EMAIL);

  await upsert('master_housing', [
    {
      id: 990004,
      university_id: universityId,
      residence_hall: long.buildingName,
      housing_type: 'Suite',
      community_type: 'Mixed',
      who_lives_here: 'Layout fixture',
      capacity: '~100',
      details: 'Layout fixture building for the audit crawl.',
      building_amenities: 'Laundry',
      inroom_amenities: 'Desk',
      laundry: 'In-building',
      wifi_and_cable: true,
      heat_and_air_conditioning: true,
      latitude: 40.4450,
      longitude: -79.9600,
      image_url: null,
    },
  ]);
  const { error: dormErr } = await db.from('profiles').update({ current_dorm: long.buildingName }).eq('id', userId);
  if (dormErr) throw new Error(`profiles.current_dorm: ${dormErr.message}`);
  const { error: nameErr } = await db.from('profiles').update({ full_name: long.sellerName }).eq('id', adminId);
  if (nameErr) throw new Error(`profiles.full_name: ${nameErr.message}`);

  await upsert('checklist_items', [
    { id: 'c0000000-0000-4000-8000-000000000007', user_id: userId, category: 'Storage', item: long.checklistItem, status: 'need', is_night_one: false, position: 6 },
  ]);
  await upsert('marketplace_listings', [
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      user_id: adminId,
      university_id: universityId,
      title: long.listingTitle,
      description: 'Layout fixture listing for the audit crawl.',
      price: 20,
      category: 'Electronics',
      condition: 'Good',
      status: 'available',
      meetup_location: long.buildingName,
      show_phone: false,
      payment_methods: ['cash'],
      image_url: 'https://placehold.co/800x600/03C03C/ffffff?text=Fixture',
    },
  ]);
  console.log('✓ long-content fixture (AUDIT_LONG_CONTENT=1)');
}

main().catch((e) => {
  console.error('Content seed failed:', e.message ?? e);
  process.exit(1);
});
