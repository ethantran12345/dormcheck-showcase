import { describe, expect, it } from "vitest";
import { MOVE_OUT_TIERS, type MoveOutOption, type PriceBand } from "@/data/moveOut";

const BAND_ORDER: PriceBand[] = ["earn", "free", "$", "$$", "$$$"];
const bandRank = (band: PriceBand) => BAND_ORDER.indexOf(band);

const allOptions: MoveOutOption[] = MOVE_OUT_TIERS.flatMap((t) => t.options);

describe("move-out ladder data", () => {
  it("has tiers and options", () => {
    expect(MOVE_OUT_TIERS.length).toBeGreaterThanOrEqual(3);
    expect(allOptions.length).toBeGreaterThanOrEqual(8);
  });

  it("is sorted cheapest to priciest across and within tiers", () => {
    const ranks = allOptions.map((o) => bandRank(o.priceBand));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it("gives every paid option a price note", () => {
    for (const o of allOptions) {
      if (o.priceBand === "$" || o.priceBand === "$$" || o.priceBand === "$$$") {
        expect(o.priceNote, `${o.id} missing priceNote`).toBeTruthy();
      }
    }
  });

  it("uses absolute https URLs for external CTAs and relative paths for internal", () => {
    for (const o of allOptions) {
      if (!o.cta) continue;
      if (o.cta.internal) {
        expect(o.cta.href, `${o.id} internal href`).toMatch(/^\//);
      } else {
        expect(o.cta.href, `${o.id} external href`).toMatch(/^https:\/\//);
      }
    }
  });

  it("provides either steps or a wizard detail slot for every option", () => {
    for (const o of allOptions) {
      if (o.detail) {
        expect(o.steps, `${o.id} wizard rung should not duplicate steps`).toHaveLength(0);
      } else {
        expect(o.steps.length, `${o.id} needs steps`).toBeGreaterThan(0);
        expect(o.cta, `${o.id} needs a CTA`).toBeTruthy();
      }
    }
  });

  it("flags the known affiliate candidates", () => {
    const affiliates = allOptions.filter((o) => o.affiliate).map((o) => o.id);
    expect(affiliates).toEqual(["storage-squad", "storage-scholars"]);
  });

  it("contains no em dashes in user-facing copy", () => {
    const strings = JSON.stringify(MOVE_OUT_TIERS);
    expect(strings.includes(" - ")).toBe(false);
  });

  it("has unique option and tier ids", () => {
    const tierIds = MOVE_OUT_TIERS.map((t) => t.id);
    const optionIds = allOptions.map((o) => o.id);
    expect(new Set(tierIds).size).toBe(tierIds.length);
    expect(new Set(optionIds).size).toBe(optionIds.length);
  });
});
