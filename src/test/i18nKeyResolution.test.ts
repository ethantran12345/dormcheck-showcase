import { describe, it, expect } from "vitest";
// plain .mjs guard shared with CLI + CI (untyped import, resolves via allowJs)
import { verifyKeys, verifyOrphans } from "../../scripts/i18n-verify-keys.mjs";

// Guards against the parallel-session reconcile hazard: a phase commits code
// that references an i18n key, but the shared locale JSON carrying that key's
// copy never lands. With `returnEmptyString: false`, a missing OR empty English
// value renders the raw key (or leaks English into zh), so both must fail here.
// Same check runs standalone via `npm run i18n:verify` and in CI (ci-dev-push).
//
// The guard walks BOTH directions since 2026-08-17 — see the header of
// scripts/i18n-verify-keys.mjs for why each one exists and what neither covers.
describe("i18n key resolution", () => {
  it("every referenced key resolves to non-empty English copy", () => {
    const misses = verifyKeys() as Array<{ ns: string; key: string; reason: string; file: string }>;
    const report = misses.map((m) => `  ${m.ns}:${m.key} [${m.reason}] (${m.file})`).join("\n");
    expect(misses, `Unresolved i18n keys:\n${report}`).toHaveLength(0);
  });

  // Reverse direction: copy defined but rendered nowhere. Ratcheted against
  // scripts/i18n-orphan-baseline.json — a new orphan fails, and a baseline entry
  // that is referenced again fails too, so the waiver list can only shrink.
  it("no new orphaned keys, and no stale baseline entries", () => {
    const { orphans, stale } = verifyOrphans() as {
      orphans: Array<{ id: string }>;
      stale: string[];
    };
    expect(
      orphans.map((o) => o.id),
      "Orphaned i18n keys (defined, never referenced). Delete the copy from en/ and zh/, " +
        "or add it to scripts/i18n-orphan-baseline.json with a reason:"
    ).toEqual([]);
    expect(
      stale,
      "Stale scripts/i18n-orphan-baseline.json entries — these are referenced again, " +
        "so remove them from the baseline:"
    ).toEqual([]);
  });
});
