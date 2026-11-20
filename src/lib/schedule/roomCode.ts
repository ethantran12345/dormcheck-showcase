/**
 * Parse a Pitt room code like "CL0306" into a building abbreviation + room.
 *
 * Codes are `{ABBR}{ROOM}` with no separator. Abbreviations are 2-7 chars and
 * can be alphanumeric (BST3), and rooms can start with a digit-then-letter
 * (CL0G16), so a naive letters/digits split fails. Instead we do a greedy
 * longest-prefix match against the known building abbreviation set.
 */
export interface ParsedRoomCode {
  buildingAbbr: string;
  room: string;
}

export function parseRoomCode(
  code: string,
  knownAbbrs: Iterable<string>,
): ParsedRoomCode | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const abbrSet =
    knownAbbrs instanceof Set
      ? (knownAbbrs as Set<string>)
      : new Set(Array.from(knownAbbrs, (a) => a.toUpperCase()));

  const maxLen = Math.min(normalized.length, 7);
  for (let len = maxLen; len >= 2; len--) {
    const prefix = normalized.slice(0, len);
    if (abbrSet.has(prefix)) {
      return { buildingAbbr: prefix, room: normalized.slice(len) };
    }
  }
  return null;
}

/** "Leave by" = class start minus walk duration minus a buffer (default 5 min). */
export function computeLeaveBy(
  startTime: string, // 'HH:MM' or 'HH:MM:SS'
  walkSeconds: number,
  bufferMinutes = 5,
): string {
  const [h, m] = startTime.split(":").map(Number);
  const startMinutes = h * 60 + m;
  const leave = startMinutes - Math.ceil(walkSeconds / 60) - bufferMinutes;
  const clamped = ((leave % 1440) + 1440) % 1440;
  const lh = Math.floor(clamped / 60);
  const lm = clamped % 60;
  return `${String(lh).padStart(2, "0")}:${String(lm).padStart(2, "0")}`;
}
