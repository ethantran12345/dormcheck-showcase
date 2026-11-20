/**
 * Live smoke for the campus source adapters. Hits the real upstreams and prints
 * what each parser produced. Not a gate — a way to see that a shape change
 * upstream has broken parsing before students do.
 *
 *   npx tsx scripts/smoke-campus-sources.mts
 */
import {
  currentTermCode,
  fetchCalendar,
  fetchCourseSections,
  fetchDiningLocations,
  fetchDiningMenus,
  fetchDiningWeeklyHours,
  fetchLaundryMachines,
  fetchLaundryRooms,
  fetchSectionBuilding,
  fetchSubjectCourses,
  fetchSubjects,
  matchResidenceHall,
  normalizeRoomName,
} from '../api/_lib/pittSources.js';

const HALLS = [
  'Litchfield Towers', 'Sutherland East', 'Sutherland West', 'Lothrop Hall',
  'Holland Hall', 'Brackenridge Hall', 'McCormick Hall', 'Forbes Craig Apartments',
  'Nordenberg Hall',
];

function dateCode(d = new Date()) {
  return `${String(d.getFullYear() % 100).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let failures = 0;
async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`  ok   ${name}: ${await fn()}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('[laundry]');
await step('rooms + hall mapping', async () => {
  const rooms = await fetchLaundryRooms('197');
  const mapped = rooms.map((r) => `${r.name} -> ${matchResidenceHall(normalizeRoomName(r.name), HALLS) ?? 'UNMATCHED'}`);
  console.log(mapped.map((m) => `         ${m}`).join('\n'));
  const unmatched = mapped.filter((m) => m.endsWith('UNMATCHED')).length;
  return `${rooms.length} rooms, ${unmatched} unmatched`;
});
await step('machines', async () => {
  const rooms = await fetchLaundryRooms('197');
  const machines = await fetchLaundryMachines('197', rooms[0].externalId);
  const unknown = machines.filter((m) => m.status === 'unknown').length;
  return `${rooms[0].name}: ${machines.length} machines, ${unknown} unknown status`;
});

console.log('[dining]');
const code = dateCode();
await step('locations', async () => {
  const locations = await fetchDiningLocations('5e6fcc641ca48e0cacd93b04');
  const withAddress = locations.filter((l) => l.address).length;
  return `${locations.length} locations, ${withAddress} with a parsed address (e.g. ${locations.find((l) => l.address)?.address})`;
});
await step('weekly hours', async () => {
  const hours = await fetchDiningWeeklyHours('5e6fcc641ca48e0cacd93b04', code);
  const today = hours.filter((h) => h.date === new Date().toISOString().slice(0, 10));
  return `${hours.length} rows across ${new Set(hours.map((h) => h.locationName)).size} locations; ${today.length} for today`;
});
await step('menus (retail location)', async () => {
  const locations = await fetchDiningLocations('5e6fcc641ca48e0cacd93b04');
  const target = locations.find((l) => l.name === 'Chick-fil-A') ?? locations[0];
  const outcome = await fetchDiningMenus(target.externalId, code);
  if (outcome.kind !== 'ok') return `${target.name}: ${outcome.kind}`;
  const items = outcome.menus.reduce((n, m) => n + m.itemCount, 0);
  return `${target.name}: ${outcome.menus.length} period(s), ${items} items`;
});

console.log('[calendar]');
await step('academic feed', async () => {
  const events = await fetchCalendar('pitt', 'academic');
  return `${events.length} events, first ${events[0]?.date} "${events[0]?.title}"`;
});

console.log('[catalog]');
const term = currentTermCode();
await step('subjects', async () => `${(await fetchSubjects('UPITT')).length} subjects (term ${term})`);
await step('subject courses', async () => {
  const courses = await fetchSubjectCourses('UPITT', 'CS');
  const open = courses.filter((c) => c.hasOpenTerms).length;
  return `CS: ${courses.length} courses, ${open} with an open term`;
});
await step('sections + building', async () => {
  const courses = await fetchSubjectCourses('UPITT', 'CS');
  const withOpen = courses.find((c) => c.hasOpenTerms) ?? courses[0];
  const sections = await fetchCourseSections('UPITT', withOpen.courseId, term);
  const withTimes = sections.filter((s) => s.startTime).length;
  const building = sections[0] ? await fetchSectionBuilding(term, sections[0].classNumber) : null;
  return `${withOpen.subject} ${withOpen.courseNumber}: ${sections.length} sections, ${withTimes} with times, first building ${building ?? 'none'} days=${JSON.stringify(sections[0]?.days)} ${sections[0]?.startTime}-${sections[0]?.endTime}`;
});

console.log(failures === 0 ? '\nall adapters parsed live data' : `\n${failures} adapter(s) failed`);
process.exit(failures === 0 ? 0 : 1);
