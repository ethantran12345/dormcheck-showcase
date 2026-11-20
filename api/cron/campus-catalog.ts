import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authorizeCron,
  Deadline,
  loadCursor,
  loadSources,
  recordRun,
  saveCursor,
  upsertChunked,
} from '../_lib/pittIngest.js';
import {
  currentTermCode,
  fetchCourseSections,
  fetchSectionBuilding,
  fetchSubjectCourses,
  fetchSubjects,
} from '../_lib/pittSources.js';

/**
 * Course catalog. Vercel Cron, hourly.
 *
 * This replaces a manual step, not a missing feature. `course_sections` is seeded
 * today by scripts/seed-course-sections.mjs from a 25Live export generated once
 * per term from one person's authenticated session — a single point of failure
 * for the schedule surface. Pitt's HighPoint CX catalog endpoints are public and
 * unauthenticated, so the same catalog can refresh itself.
 *
 * Three resumable stages, because a term is thousands of upstream requests:
 *   courses   — walk subjects, record the catalog (cheap, ~366 requests)
 *   sections  — per course with an open term, upsert sections into course_sections
 *   locations — backfill building_abbr, which only the per-section detail call has
 *
 * The sections stage deliberately omits room/lat/lng/building_abbr from its
 * upsert payload: on conflict PostgREST updates only the columns supplied, so a
 * 25Live-sourced row keeps its room geometry. The catalog owns times and titles;
 * 25Live still owns where a class physically meets.
 */
const SUBJECT_BATCH = 40;
const COURSE_BATCH = 60;
const LOCATION_BATCH = 80;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = authorizeCron(req, res);
  if (!db) return;

  const deadline = new Deadline(25_000);
  const term = currentTermCode();
  const sources = await loadSources(db, 'catalog');
  const summary: Record<string, unknown>[] = [];

  for (const source of sources) {
    const institution = String(source.config.institution ?? '');
    const result = await recordRun(db, source, async () => {
      if (!institution) throw new Error('catalog source config has no institution');
      const cursor = await loadCursor(db, source.universityId, 'catalog', term);
      if (cursor.stage === 'start') cursor.stage = 'courses';

      const observedAt = new Date().toISOString();
      let written = 0;
      const detail: Record<string, unknown> = { term, stage: cursor.stage };

      if (cursor.stage === 'courses') {
        const subjects = await fetchSubjects(institution);
        const startAt = cursor.lastKey ? subjects.indexOf(cursor.lastKey) + 1 : 0;
        let index = startAt;
        for (; index < subjects.length && index < startAt + SUBJECT_BATCH; index++) {
          if (deadline.expired) break;
          const subject = subjects[index];
          const courses = await fetchSubjectCourses(institution, subject);
          written += await upsertChunked(
            db,
            'campus_course_catalog',
            courses.map((course) => ({
              university_id: source.universityId,
              external_course_id: course.courseId,
              subject: course.subject,
              course_number: course.courseNumber,
              title: course.title,
              observed_at: observedAt,
            })),
            'university_id,external_course_id,subject,course_number',
          );
          cursor.lastKey = subject;
        }
        if (index >= subjects.length) {
          cursor.stage = 'sections';
          cursor.lastKey = null;
        }
        detail.subjectsDone = index;
        detail.subjectsTotal = subjects.length;
      } else if (cursor.stage === 'sections') {
        // Only courses the catalog marks as having an open term can yield
        // sections; checking that up front is what keeps this to thousands of
        // requests rather than one per catalog entry.
        let query = db
          .from('campus_course_catalog')
          .select('external_course_id, subject, course_number')
          .eq('university_id', source.universityId)
          .order('external_course_id', { ascending: true })
          .limit(COURSE_BATCH);
        if (cursor.lastKey) query = query.gt('external_course_id', cursor.lastKey);
        const { data: courses, error } = await query;
        if (error) throw error;
        const batch = (courses ?? []) as Array<{ external_course_id: string }>;

        const rows: Record<string, unknown>[] = [];
        for (const course of batch) {
          if (deadline.expired) break;
          const sections = await fetchCourseSections(institution, course.external_course_id, term);
          for (const section of sections) {
            rows.push({
              university_id: source.universityId,
              term,
              subject: section.subject,
              catalog_number: section.catalogNumber,
              section: section.section,
              class_number: section.classNumber,
              component: section.component,
              title: section.title,
              title_display: toDisplayTitle(section.title),
              days: section.days,
              start_time: section.startTime,
              end_time: section.endTime,
            });
          }
          cursor.lastKey = course.external_course_id;
        }
        if (rows.length) written += await upsertChunked(db, 'course_sections', rows, 'term,class_number');
        if (batch.length < COURSE_BATCH) {
          cursor.stage = 'locations';
          cursor.lastKey = null;
        }
        detail.coursesInBatch = batch.length;
        detail.sectionsWritten = rows.length;
      } else if (cursor.stage === 'locations') {
        let query = db
          .from('course_sections')
          .select('class_number')
          .eq('university_id', source.universityId)
          .eq('term', term)
          .is('building_abbr', null)
          .order('class_number', { ascending: true })
          .limit(LOCATION_BATCH);
        if (cursor.lastKey) query = query.gt('class_number', cursor.lastKey);
        const { data: pending, error } = await query;
        if (error) throw error;
        const batch = (pending ?? []) as Array<{ class_number: string }>;

        // building_abbr is an FK to buildings(abbr); an unknown code has to stay
        // null or the write fails, so resolve against the registry first.
        const { data: buildingRows } = await db
          .from('buildings')
          .select('abbr')
          .eq('university_id', source.universityId);
        const known = new Set((buildingRows ?? []).map((b) => String((b as { abbr: string }).abbr)));

        let located = 0;
        let unknownCode = 0;
        for (const section of batch) {
          if (deadline.expired) break;
          const code = await fetchSectionBuilding(term, section.class_number);
          const update = code && known.has(code)
            ? { building_abbr: code, location_status: 'located' }
            : { location_status: code ? 'private' : 'online_tba' };
          if (code && !known.has(code)) unknownCode += 1;
          if (code && known.has(code)) located += 1;
          const { error: updateError } = await db
            .from('course_sections')
            .update(update)
            .eq('term', term)
            .eq('class_number', section.class_number);
          if (updateError) throw new Error(`course_sections: ${updateError.message}`);
          written += 1;
          cursor.lastKey = section.class_number;
        }
        if (batch.length < LOCATION_BATCH) {
          cursor.stage = 'done';
          cursor.lastKey = null;
        }
        detail.locationsInBatch = batch.length;
        detail.located = located;
        detail.unknownBuildingCode = unknownCode;
      } else {
        detail.note = 'term already ingested; nothing to do';
      }

      detail.nextStage = cursor.stage;
      await saveCursor(db, source.universityId, 'catalog', cursor);
      return { rowsWritten: written, detail };
    });
    summary.push({ university: source.universitySlug, term, ...result });
  }

  return res.status(200).json({ ok: true, sources: summary });
}

/** "INTRO TO COMPUTER PROGRAMMING" -> "Intro to Computer Programming". */
export function toDisplayTitle(title: string | null): string | null {
  if (!title) return null;
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return title
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && minor.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
