// Pure, dependency-free quiet-hours (push-only Do Not Disturb) evaluation.
//
// Shared by the send-push edge function (Deno runtime) and its unit test
// (vitest / Node). Uses only `Intl` and `Date`, which behave identically in both
// runtimes, so there is a single source of truth - no drift between the code that
// runs in production and the code the test exercises.
//
// Push-only: email is NEVER gated here. Every helper FAILS OPEN (treats the state
// as "not quiet -> send") on any missing/malformed value or invalid timezone, so a
// bad quiet-hours config can never silently swallow notifications.

export interface QuietHoursConfig {
  enabled?: boolean | null;
  /** Local wall-clock "HH:MM" (24h). */
  start?: string | null;
  /** Local wall-clock "HH:MM" (24h). May be < start (window wraps midnight). */
  end?: string | null;
  /** IANA timezone, e.g. "America/New_York". */
  timezone?: string | null;
}

/** Parse "HH:MM" -> minutes since local midnight, or null if malformed. */
export function parseHhMm(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Minutes since local midnight for `nowMs` observed in `timeZone`,
 * or null if the timezone is invalid.
 */
export function localMinutesInZone(
  nowMs: number,
  timeZone: string | null | undefined,
): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone && timeZone.trim() ? timeZone.trim() : "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(nowMs));
    let hour = NaN;
    let minute = NaN;
    for (const p of parts) {
      if (p.type === "hour") hour = Number(p.value);
      if (p.type === "minute") minute = Number(p.value);
    }
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour === 24) hour = 0; // some ICU builds emit "24" at midnight with hour12:false
    return hour * 60 + minute;
  } catch {
    return null; // invalid IANA timezone
  }
}

/**
 * True when PUSH should be SUPPRESSED for a user at `nowMs`.
 *
 * The window is half-open [start, end) in the user's local time:
 *   - start < end  -> same-day window (e.g. 09:00-17:00)
 *   - start > end  -> wraps midnight  (e.g. 22:00-08:00): quiet when now >= start OR now < end
 *   - start == end -> zero-width window, treated as "no quiet hours" (fail open)
 *
 * Fails open (returns false = send) when disabled, on malformed times, or on an
 * invalid timezone.
 */
export function isWithinQuietHours(
  cfg: QuietHoursConfig | null | undefined,
  nowMs: number,
): boolean {
  if (!cfg || !cfg.enabled) return false;
  const start = parseHhMm(cfg.start);
  const end = parseHhMm(cfg.end);
  if (start === null || end === null || start === end) return false;

  const nowMin = localMinutesInZone(nowMs, cfg.timezone);
  if (nowMin === null) return false;

  return start < end
    ? nowMin >= start && nowMin < end // same-day window
    : nowMin >= start || nowMin < end; // wraps midnight
}
