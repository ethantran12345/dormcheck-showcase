#!/usr/bin/env node
/**
 * Seed a clearly-labelled, LOCAL-ONLY three-school product demo.
 *
 * The fixtures exercise the intended visibility model:
 *   - Marketplace items + subleases: visible across Pitt, CMU, and Carlow.
 *   - Student setups + roommate discovery: visible only within their school.
 *
 * Every user-facing value says "Local demo" or "Demo Student". Nothing here is
 * student activity or production evidence, and the localhost guard makes it
 * impossible to point this script at the hosted project.
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env.e2e') });

export const DEMO_SCHOOLS = [
  {
    slug: 'pitt',
    id: '00000000-0000-4000-8000-000000000001',
    shortName: 'Pitt',
    domain: 'pitt.edu',
    demoResidence: 'LOCAL DEMO · Pitt residence',
    address: '3990 Fifth Avenue, Pittsburgh, PA 15213',
    center: { latitude: 40.4436, longitude: -79.9581 },
  },
  {
    slug: 'cmu',
    id: '00000000-0000-4000-8000-000000000002',
    shortName: 'CMU',
    domain: 'andrew.cmu.edu',
    demoResidence: 'LOCAL DEMO · CMU residence',
    address: '5115 Margaret Morrison Street, Pittsburgh, PA 15213',
    center: { latitude: 40.44193, longitude: -79.940258 },
  },
  {
    slug: 'carlow',
    id: '00000000-0000-4000-8000-000000000003',
    shortName: 'Carlow',
    domain: 'live.carlow.edu',
    demoResidence: 'LOCAL DEMO · Carlow residence',
    address: '3333 Fifth Avenue, Pittsburgh, PA 15213',
    center: { latitude: 40.43897, longitude: -79.9636 },
  },
];

export const fixtureIds = {
  item: DEMO_SCHOOLS.map((_, i) => `d3000000-0000-4000-8000-00000000000${i + 1}`),
  sublease: DEMO_SCHOOLS.map((_, i) => `d3100000-0000-4000-8000-00000000000${i + 1}`),
  roommatePost: DEMO_SCHOOLS.map((_, i) => `d3200000-0000-4000-8000-00000000000${i + 1}`),
  setup: DEMO_SCHOOLS.map((_, i) => 993001 + i),
};

export function assertLocalUrl(url) {
  if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/i.test(url)) {
    throw new Error(`Refusing three-school demo seed: ${url || 'empty URL'} is not localhost.`);
  }
}

export function demoEmail(school, role) {
  return `local-demo+${school.slug}-${role}@${school.domain}`;
}

const URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.E2E_THREE_SCHOOL_PASSWORD || process.env.E2E_USER_PASSWORD || 'E2eUser!Passw0rd';

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function ensureUser(admin, email) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (!created.error) return created.data.user.id;
  if (!['email_exists', 'user_already_exists'].includes(created.error.code) && created.error.status !== 422) {
    throw created.error;
  }

  const { data: rows, error: lookupError } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .limit(1);
  if (lookupError) throw lookupError;
  const id = rows?.[0]?.id;
  if (!id) throw new Error(`${email} exists in Auth but has no profiles row.`);
  const { error: updateError } = await admin.auth.admin.updateUserById(id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (updateError) throw updateError;
  return id;
}

async function main() {
  assertLocalUrl(URL);
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.e2e.');

  const admin = createClient(URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const people = [];
  for (const school of DEMO_SCHOOLS) {
    const { data: university, error: universityError } = await admin
      .from('universities')
      .select('id, feature_flags, marketplace_group')
      .eq('id', school.id)
      .maybeSingle();
    if (universityError) throw universityError;
    if (!university) throw new Error(`${school.shortName} tenant is missing; reset the local stack first.`);

    const flags = university.feature_flags && typeof university.feature_flags === 'object'
      ? university.feature_flags
      : {};
    const { error: flagError } = await admin
      .from('universities')
      .update({
        marketplace_group: 'pittsburgh',
        feature_flags: {
          ...flags,
          showHousing: true,
          showRoommates: true,
          showBrowseSublease: true,
          showPostSublease: true,
        },
      })
      .eq('id', school.id);
    if (flagError) throw flagError;

    for (const role of ['viewer', 'host']) {
      const email = demoEmail(school, role);
      const id = await ensureUser(admin, email);
      const fullName = `${school.shortName} Demo Student ${role === 'viewer' ? 'A' : 'B'}`;
      const { error: profileError } = await admin.from('profiles').update({
        university_id: school.id,
        full_name: fullName,
        role: 'user',
        is_admin: false,
        has_completed_onboarding: true,
        is_public: true,
        discoverable: true,
        is_roommate_searching: true,
        bio: `Local demo roommate profile for ${school.shortName}. Not a real student account.`,
        major: 'Demo Program',
        grade_level: role === 'viewer' ? 'Sophomore' : 'Junior',
        graduation_year: role === 'viewer' ? 2029 : 2028,
        housing_type: 'off-campus',
        current_dorm: school.demoResidence,
        cleanliness: role === 'viewer' ? 'Very tidy' : 'Average',
        social_level: role === 'viewer' ? 'Balanced' : 'Social',
        study_style: 'Library or common areas',
        sleep_habit: role === 'viewer' ? 'Early bird' : 'Night owl',
        sleep: role === 'viewer' ? 'Early bird' : 'Night owl',
        guest_preference: 'Occasionally',
        guests: 'Occasionally',
        temp_preference: 'Neutral',
        temp: 'Neutral',
        conflict_style: 'Talk it out right away',
        smoking: 'No',
        interests: ['Local demo', school.shortName, 'Housing'],
        tags: ['Demo fixture', school.shortName],
        preferred_areas: ['Oakland'],
      }).eq('id', id);
      if (profileError) throw profileError;
      people.push({ school, role, id, email, fullName });
    }
  }

  const hostBySchool = new Map(people.filter((p) => p.role === 'host').map((p) => [p.school.id, p]));
  await admin.from('marketplace_listings').delete().in('id', [...fixtureIds.item, ...fixtureIds.sublease]);
  await admin.from('roommate_search_posts').delete().in('id', fixtureIds.roommatePost);
  await admin.from('student_setups').delete().in('id', fixtureIds.setup);

  const itemRows = DEMO_SCHOOLS.map((school, i) => {
    const host = hostBySchool.get(school.id);
    return {
      id: fixtureIds.item[i],
      user_id: host.id,
      university_id: school.id,
      post_type: 'item',
      title: `[LOCAL DEMO · ${school.shortName}] Adjustable desk lamp`,
      description: `Local-only fixture proving ${school.shortName} marketplace cards render in the shared Pittsburgh feed.`,
      price: 18 + i,
      category: 'Electronics',
      condition: 'Good',
      status: 'available',
      meetup_location: `${school.shortName} campus`,
      payment_methods: ['cash'],
      image_urls: [`https://placehold.co/900x700/0B702B/ffffff?text=LOCAL+DEMO+${school.shortName}+ITEM`],
      show_phone: false,
    };
  });

  const subleaseRows = DEMO_SCHOOLS.map((school, i) => {
    const host = hostBySchool.get(school.id);
    return {
      id: fixtureIds.sublease[i],
      user_id: host.id,
      university_id: school.id,
      post_type: 'sublease',
      title: school.address,
      description: `Local-only fixture proving a ${school.shortName} sublease renders across the shared Pittsburgh marketplace.`,
      price: 700 + i * 25,
      category: 'Housing',
      status: 'available',
      payment_methods: [],
      building_name: school.address,
      sublease_start: '2027-05-15',
      sublease_end: '2027-08-15',
      included_utilities: ['Water', 'WiFi'],
      is_furnished: true,
      has_parking: false,
      latitude: school.center.latitude,
      longitude: school.center.longitude,
      image_urls: [`https://placehold.co/900x700/2B4E5F/ffffff?text=LOCAL+DEMO+${school.shortName}+SUBLEASE`],
      show_phone: false,
    };
  });

  const roommateRows = DEMO_SCHOOLS.map((school, i) => {
    const host = hostBySchool.get(school.id);
    return {
      id: fixtureIds.roommatePost[i],
      user_id: host.id,
      university_id: school.id,
      post_type: 'looking-for-roommates',
      content: `Local demo roommate post for ${school.shortName}. Not real student activity.`,
      budget_max: 900,
      preferred_areas: ['Oakland'],
      move_in_semester: 'Fall',
      spots_total: 2,
      spots_filled: 0,
      is_active: true,
      housing_type: 'off-campus',
      gender_preference: 'any',
      utilities_included: [],
      photos: [],
      show_phone: false,
      show_instagram: false,
      show_snapchat: false,
    };
  });

  const setupRows = DEMO_SCHOOLS.map((school, i) => {
    const host = hostBySchool.get(school.id);
    return {
      id: fixtureIds.setup[i],
      user_id: host.id,
      university_id: school.id,
      dorm_id: null,
      dorm_name: school.demoResidence,
      author_name: host.fullName,
      image_url: `https://placehold.co/900x1100/575047/ffffff?text=LOCAL+DEMO+${school.shortName}+SETUP`,
      caption: `Local demo fixture for the ${school.shortName} Student Setups journey. Not student-submitted.`,
      likes: 0,
      tags: [],
      is_hidden: false,
    };
  });

  for (const [table, rows] of [
    ['marketplace_listings', [...itemRows, ...subleaseRows]],
    ['roommate_search_posts', roommateRows],
    ['student_setups', setupRows],
  ]) {
    const { error } = await admin.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`✓ ${table}: ${rows.length} local demo row(s)`);
  }

  console.log('\nThree-school local demo seeded.');
  console.log('Sign-in accounts (password = E2E_THREE_SCHOOL_PASSWORD or E2E_USER_PASSWORD):');
  for (const school of DEMO_SCHOOLS) console.log(`  ${school.shortName}: ${demoEmail(school, 'viewer')}`);
  console.log('Run `npm run demo:three-schools:verify` for authenticated RLS and write probes.');
}

if (isMain()) {
  main().catch((error) => {
    console.error(`Three-school demo seed failed: ${error?.message || error}`);
    process.exit(1);
  });
}
