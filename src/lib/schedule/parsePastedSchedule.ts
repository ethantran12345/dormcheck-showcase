/**
 * Parse a schedule pasted from PeopleSoft (Pitt Student Center "My Class
 * Schedule") or Pitt Mobile into class rows ready for user_classes.
 *
 * The paste is messy by nature: list view is tab-separated cells, mobile is
 * line-per-field, and students may trim it by hand. So this is a lenient
 * line scanner, not a grammar: a course header line sets the current course,
 * and any line containing a "MoWeFr 9:00AM - 9:50AM"-shaped meeting pattern
 * becomes a class under it. Lines without either are ignored.
 */

export interface ParsedClass {
  /** e.g. "CHEM 0110 LEC" - matches the label style AddClassDialog produces. */
  label: string;
  /** Course title when the header carried one, for the preview list. */
  title: string | null;
  /** DAY_KEYS subset: Mo Tu We Th Fr Sa Su. */
  days: string[];
  /** 'HH:MM' 24h, or null when the meeting is TBA. */
  startTime: string | null;
  endTime: string | null;
  /** Raw location text after the time cell (e.g. "Chevron Science Center 150"). */
  location: string | null;
}

const DAY_TOKEN = /(?:Mo|Tu|We|Th|Fr|Sa|Su)/;
// "MoWeFr 9:00AM - 9:50AM" (also en dash / "to" separators, optional minutes space)
const MEETING_RE = new RegExp(
  `\\b(${DAY_TOKEN.source}{1,7})\\s+(\\d{1,2}:\\d{2}\\s*[AP]M)\\s*(?:-|–|to)\\s*(\\d{1,2}:\\d{2}\\s*[AP]M)`,
  'i',
);
// "CHEM 0110 - GENERAL CHEMISTRY 1" / "CHEM 0110: General Chemistry"
const HEADER_RE = /^([A-Z]{2,7})\s+(\d{3,5}[A-Z]?)\s*[-–:]\s*(.+)$/;
// Component in the meeting line ("1030-LEC", "Lecture", "Recitation"...)
const COMPONENT_WORDS: Record<string, string> = {
  lecture: 'LEC',
  recitation: 'REC',
  laboratory: 'LAB',
  lab: 'LAB',
  seminar: 'SEM',
  studio: 'STU',
  workshop: 'WKS',
  clinical: 'CLN',
  independent: 'IND',
};
const COMPONENT_ABBR_RE = /\b(LEC|REC|LAB|SEM|STU|WKS|CLN|IND)\b/;

function to24h(time: string): string | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function splitDays(run: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < run.length + 1 && i < run.length; i += 2) {
    out.push(run[0 + i].toUpperCase() + run[i + 1].toLowerCase());
  }
  // Keep canonical casing only (guards against odd captures).
  return out.filter((d) => ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].includes(d));
}

function componentOf(line: string): string | null {
  const abbr = line.toUpperCase().match(COMPONENT_ABBR_RE);
  if (abbr) return abbr[1];
  const lower = line.toLowerCase();
  for (const [word, code] of Object.entries(COMPONENT_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return code;
  }
  return null;
}

/**
 * The location is whatever follows the time in the same cell/line, up to the
 * next tab-separated cell that looks like an instructor or a date range.
 */
function locationAfter(line: string, matchEnd: number): string | null {
  const rest = line.slice(matchEnd);
  // Prefer the next tab cell; within a space-joined line take up to a date.
  const cells = rest.split('\t').map((c) => c.trim()).filter(Boolean);
  let loc = cells[0] ?? '';
  loc = loc.replace(/\d{2}\/\d{2}\/\d{4}.*$/, '').trim();
  if (!loc || /^(TBA|To Be Announced)$/i.test(loc)) return null;
  return loc;
}

export function parsePastedSchedule(text: string): ParsedClass[] {
  const classes: ParsedClass[] = [];
  let course: { code: string; title: string | null } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(HEADER_RE);
    if (header && !MEETING_RE.test(line)) {
      course = {
        code: `${header[1].toUpperCase()} ${header[2].toUpperCase()}`,
        title: header[3].trim() || null,
      };
      continue;
    }

    const meeting = line.match(MEETING_RE);
    if (!meeting) continue;

    const component = componentOf(line);
    // Inline course code on the same line beats the running header
    // ("CHEM 0110 MoWeFr 9:00AM - 9:50AM ..." one-liner pastes).
    const inline = line.match(/^([A-Z]{2,7})\s+(\d{3,5}[A-Z]?)\b/);
    const code = inline
      ? `${inline[1].toUpperCase()} ${inline[2].toUpperCase()}`
      : course?.code ?? null;
    if (!code) continue; // meeting with no course context - skip rather than guess

    const label = component ? `${code} ${component}` : code;
    const matchEnd = (meeting.index ?? 0) + meeting[0].length;
    const entry: ParsedClass = {
      label,
      title: inline ? null : course?.title ?? null,
      days: splitDays(meeting[1]),
      startTime: to24h(meeting[2]),
      endTime: to24h(meeting[3]),
      location: locationAfter(line, matchEnd),
    };
    // Dedupe exact repeats (list view repeats meeting rows per date range).
    const dup = classes.some(
      (c) =>
        c.label === entry.label &&
        c.startTime === entry.startTime &&
        c.days.join() === entry.days.join(),
    );
    if (!dup) classes.push(entry);
  }

  return classes;
}
