/**
 * migration-gate step 3 object extraction — the add-validate-drop-rename swap.
 *
 * THE DEFECT (2026-08-07): step 3 failed the release on
 * 20260916000000_moderation_actions_automated_image_screen.sql, reporting prod wrong in
 * both directions at once — `moderation_actions_action_check_new` MISSING IN PROD and
 * `moderation_actions_action_check` STILL PRESENT IN PROD. Prod was correct: both CHECKs
 * were live and convalidated with the right value sets.
 *
 * The cause was that extractObjects understood ADD CONSTRAINT and DROP CONSTRAINT but not
 * RENAME CONSTRAINT. Widening a CHECK is REQUIRED to use the swap
 *
 *     ADD x_new NOT VALID → VALIDATE x_new → DROP x → RENAME x_new TO x
 *
 * because a bare DROP-then-ADD leaves the table with no CHECK at all if the ADD fails.
 * So the probe was structurally guaranteed to fail every migration that followed the
 * standing rule — the worst kind of gate bug, because the pressure it creates is to stop
 * trusting the gate rather than to fix it.
 *
 * These tests lock the resolution rule: later statements win, and a RENAME is both a
 * disappearance of the old name and an appearance of the new one.
 */
import { describe, it, expect } from "vitest";
import { extractObjects } from "../../scripts/migration-gate.mjs";

type Obj = { kind: string; schema: string; name: string; table?: string; present: boolean };

/** Same last-wins collapse step 3 applies before probing prod. */
function resolve(sql: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const o of extractObjects(sql) as Obj[]) {
    out.set(`${o.kind}:${o.schema}.${o.table ? `${o.table}.` : ""}${o.name}`, o.present);
  }
  return out;
}

describe("extractObjects — RENAME CONSTRAINT", () => {
  const swap = `
    ALTER TABLE public.moderation_actions
      DROP CONSTRAINT IF EXISTS moderation_actions_action_check_new;
    ALTER TABLE public.moderation_actions
      ADD CONSTRAINT moderation_actions_action_check_new
      CHECK (action = ANY (ARRAY['dismiss_report'::text, 'auto_reject_image'::text])) NOT VALID;
    ALTER TABLE public.moderation_actions
      VALIDATE CONSTRAINT moderation_actions_action_check_new;
    ALTER TABLE public.moderation_actions
      DROP CONSTRAINT IF EXISTS moderation_actions_action_check;
    ALTER TABLE public.moderation_actions
      RENAME CONSTRAINT moderation_actions_action_check_new
        TO moderation_actions_action_check;
  `;

  it("resolves the scratch name to absent — it was renamed away, not left behind", () => {
    expect(resolve(swap).get("constraint:public.moderation_actions.moderation_actions_action_check_new")).toBe(false);
  });

  it("resolves the final name to present — the RENAME outranks the earlier DROP", () => {
    expect(resolve(swap).get("constraint:public.moderation_actions.moderation_actions_action_check")).toBe(true);
  });

  it("reports no object the swap does not actually leave behind", () => {
    const names = [...resolve(swap).keys()].sort();
    expect(names).toEqual([
      "constraint:public.moderation_actions.moderation_actions_action_check",
      "constraint:public.moderation_actions.moderation_actions_action_check_new",
    ]);
  });

  it("still treats a plain DROP CONSTRAINT with no rename as absent", () => {
    const r = resolve(`ALTER TABLE public.t DROP CONSTRAINT IF EXISTS c_old;`);
    expect(r.get("constraint:public.t.c_old")).toBe(false);
  });

  it("still treats a plain ADD CONSTRAINT as present", () => {
    const r = resolve(`ALTER TABLE public.t ADD CONSTRAINT c_new CHECK (x > 0);`);
    expect(r.get("constraint:public.t.c_new")).toBe(true);
  });

  it("handles the two-constraint swap in one file without crosstalk", () => {
    const r = resolve(`
      ALTER TABLE public.t ADD CONSTRAINT a_new CHECK (x > 0) NOT VALID;
      ALTER TABLE public.t DROP CONSTRAINT IF EXISTS a;
      ALTER TABLE public.t RENAME CONSTRAINT a_new TO a;
      ALTER TABLE public.t ADD CONSTRAINT b_new CHECK (y > 0) NOT VALID;
      ALTER TABLE public.t DROP CONSTRAINT IF EXISTS b;
      ALTER TABLE public.t RENAME CONSTRAINT b_new TO b;
    `);
    expect(r.get("constraint:public.t.a")).toBe(true);
    expect(r.get("constraint:public.t.b")).toBe(true);
    expect(r.get("constraint:public.t.a_new")).toBe(false);
    expect(r.get("constraint:public.t.b_new")).toBe(false);
  });
});

describe("extractObjects — CREATE INDEX", () => {
  it("uses the index schema, not the indexed table name, for the live-catalog probe", () => {
    const r = resolve(`CREATE INDEX idx_dm_poll_votes_conversation ON public.dm_poll_votes (conversation_id);`);
    expect(r.get("index:public.idx_dm_poll_votes_conversation")).toBe(true);
    expect(r.has("index:dm_poll_votes.idx_dm_poll_votes_conversation")).toBe(false);
  });
});
