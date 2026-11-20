import { describe, it, expect } from "vitest";
import {
  resolveChecklistStatus,
  isSharedAway,
  computeChecklistReadiness,
  groupChecklistByReadiness,
  findAttachableNeedRow,
  splitBulkItemNames,
  matchMarketplaceListings,
  checklistCategoriesPresent,
  visibleChecklistCategory,
} from "./checklistHelpers";
import type { ChecklistItem } from "@/types";

const ME = "user-me";

function item(partial: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    user_id: ME,
    category: partial.category ?? "Tech",
    item: partial.item ?? "Thing",
    is_checked: partial.is_checked ?? false,
    is_custom: false,
    ...partial,
  };
}

describe("resolveChecklistStatus", () => {
  it("returns an explicit status verbatim", () => {
    expect(resolveChecklistStatus(item({ status: "bought" }))).toBe("bought");
    expect(resolveChecklistStatus(item({ status: "skip" }))).toBe("skip");
  });
  it("falls back to is_checked for the legacy null shape", () => {
    expect(resolveChecklistStatus(item({ status: null, is_checked: true }))).toBe("packed");
    expect(resolveChecklistStatus(item({ status: null, is_checked: false }))).toBe("need");
  });
});

describe("visibleChecklistCategory", () => {
  it("removes the retired Night One category and infers a useful replacement", () => {
    expect(visibleChecklistCategory(item({ item: "Shower caddy", category: "Night One" }))).toBe("Bath / Laundry");
  });

  it("repairs legacy Bedding fallback rows without changing genuine bedding", () => {
    expect(visibleChecklistCategory(item({ item: "Body scale", category: "Bedding" }))).toBe("Electronics / Misc");
    expect(visibleChecklistCategory(item({ item: "Water", category: "Bedding" }))).toBe("Unsorted");
    expect(visibleChecklistCategory(item({ item: "Twin XL sheets", category: "Bedding" }))).toBe("Bedding");
  });
});

describe("isSharedAway", () => {
  it("is true only when assigned to someone other than me", () => {
    expect(isSharedAway(item({ assigned_to: "roommate" }), ME)).toBe(true);
    expect(isSharedAway(item({ assigned_to: ME }), ME)).toBe(false);
    expect(isSharedAway(item({ assigned_to: null }), ME)).toBe(false);
  });
});

describe("computeChecklistReadiness", () => {
  it("is 0 for an empty list", () => {
    expect(computeChecklistReadiness([], ME).readiness).toBe(0);
  });

  it("is 100 when everything on my plate is packed", () => {
    const r = computeChecklistReadiness(
      [item({ status: "packed" }), item({ status: "packed", is_night_one: true })],
      ME,
    );
    expect(r.readiness).toBe(100);
    expect(r.got).toBe(2);
    expect(r.packedCount).toBe(2);
  });

  it("excludes skipped and shared-away items from the denominator", () => {
    const r = computeChecklistReadiness(
      [
        item({ status: "packed" }),
        item({ status: "skip" }),
        item({ status: "need", assigned_to: "roommate" }),
      ],
      ME,
    );
    expect(r.total).toBe(1);
    expect(r.skipCount).toBe(1);
    expect(r.sharedCount).toBe(1);
    expect(r.readiness).toBe(100);
  });

  it("scores legacy night-one items like every other item", () => {
    const zero = computeChecklistReadiness(
      [item({ status: "need", is_night_one: true }), item({ status: "need" })],
      ME,
    );
    expect(zero.readiness).toBe(0);

    const r = computeChecklistReadiness(
      [item({ status: "packed", is_night_one: true }), item({ status: "need" })],
      ME,
    );
    expect(r.readiness).toBe(50);
    expect(r.nightOneTotal).toBe(0);
    expect(r.nightOneReady).toBe(0);
  });
});

describe("computeChecklistReadiness with no night-one items", () => {
  // Regression: the first-night ratio used to default to a perfect 1 when there
  // was nothing to measure, which paid out its full 0.5 weight for free. A
  // student who owned nothing read 50%. The weight is now redistributed into
  // acquired (0.3 -> 0.6) and packed (0.2 -> 0.4).

  it("is 0, not 50, when nothing is owned or packed", () => {
    const r = computeChecklistReadiness([item({ status: "need" }), item({ status: "need" })], ME);
    expect(r.nightOneTotal).toBe(0);
    expect(r.readiness).toBe(0);
  });

  it("scores acquired-but-unpacked on the redistributed acquired weight", () => {
    // 2 items, both bought, neither packed. acquired 1 * 0.6, packed 0 * 0.4.
    const r = computeChecklistReadiness([item({ status: "bought" }), item({ status: "bought" })], ME);
    expect(r.readiness).toBe(60);
  });

  it("scores a half-acquired list at 30, where it used to read 65", () => {
    const r = computeChecklistReadiness([item({ status: "bought" }), item({ status: "need" })], ME);
    expect(r.readiness).toBe(30);
  });

  it("still reaches exactly 100 when everything is packed", () => {
    const r = computeChecklistReadiness([item({ status: "packed" }), item({ status: "packed" })], ME);
    expect(r.readiness).toBe(100);
  });

  it("legacy night-one metadata does not change the score", () => {
    const r = computeChecklistReadiness(
      [item({ status: "bought" }), item({ status: "bought" }), item({ status: "packed", is_night_one: true })],
      ME,
    );
    expect(r.nightOneTotal).toBe(0);
    expect(r.readiness).toBe(73);
  });
});

describe("groupChecklistByReadiness", () => {
  it("routes a legacy night-one item into still-need", () => {
    const g = groupChecklistByReadiness(
      [item({ status: "need", is_night_one: true }), item({ status: "need" })],
      ME,
    );
    expect(g.nightOne).toHaveLength(0);
    expect(g.stillNeed).toHaveLength(2);
  });

  it("collapses a packed night-one item into Packed", () => {
    const g = groupChecklistByReadiness([item({ status: "packed", is_night_one: true })], ME);
    expect(g.nightOne).toHaveLength(0);
    expect(g.packed).toHaveLength(1);
  });

  it("separates have, skipped, and shared", () => {
    const g = groupChecklistByReadiness(
      [
        item({ status: "bought" }),
        item({ status: "skip" }),
        item({ status: "need", assigned_to: "roommate" }),
      ],
      ME,
    );
    expect(g.have).toHaveLength(1);
    expect(g.skipped).toHaveLength(1);
    expect(g.shared).toHaveLength(1);
  });
});

describe("computeChecklistReadiness needPricedCount", () => {
  it("counts only still-need items that carry a price", () => {
    const r = computeChecklistReadiness(
      [
        item({ status: "need", estimated_price: 20 }),
        item({ status: "need", estimated_price: 0 }),
        item({ status: "need" }),
        item({ status: "bought", estimated_price: 50 }), // acquired, not counted as need-priced
      ],
      ME,
    );
    expect(r.needCount).toBe(3);
    expect(r.needPricedCount).toBe(1);
  });
});

describe("findAttachableNeedRow", () => {
  const rows = [
    item({ id: "a", item: "Shower Caddy", status: "need" }),
    item({ id: "b", item: "Mattress Topper", status: "packed" }),
    item({ id: "c", item: "temp thing", status: "need" }),
  ];

  it("matches a need row by normalized name", () => {
    expect(findAttachableNeedRow(rows, "  shower caddy ", null)?.id).toBe("a");
  });

  it("does not attach to a packed row (only need)", () => {
    expect(findAttachableNeedRow(rows, "Mattress Topper", null)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findAttachableNeedRow(rows, "Desk Lamp", null)).toBeNull();
  });

  it("ignores optimistic temp rows", () => {
    const withTemp = [item({ id: "temp-123", item: "Rug", status: "need" })];
    expect(findAttachableNeedRow(withTemp, "Rug", null)).toBeNull();
  });

  it("respects the group scope", () => {
    const grouped = [item({ id: "g", item: "Fridge", status: "need", group_id: "grp1" })];
    expect(findAttachableNeedRow(grouped, "Fridge", "grp1")?.id).toBe("g");
    expect(findAttachableNeedRow(grouped, "Fridge", null)).toBeNull();
  });
});

describe("splitBulkItemNames", () => {
  it("splits, trims, and drops empty lines", () => {
    expect(splitBulkItemNames("Sheets\n  Towel \n\n\nLamp")).toEqual([
      "Sheets",
      "Towel",
      "Lamp",
    ]);
  });

  it("handles CRLF and lone CR", () => {
    expect(splitBulkItemNames("A\r\nB\rC")).toEqual(["A", "B", "C"]);
  });

  it("strips bullets and numbering", () => {
    expect(splitBulkItemNames("- Rug\n* Fan\n1. Desk\n2) Chair\n• Mirror")).toEqual([
      "Rug",
      "Fan",
      "Desk",
      "Chair",
      "Mirror",
    ]);
  });

  it("de-dupes within the paste, case-insensitively, first wins", () => {
    expect(splitBulkItemNames("Rug\nrug\nRUG\nFan")).toEqual(["Rug", "Fan"]);
  });

  it("returns [] for blank input", () => {
    expect(splitBulkItemNames("\n\n   \n")).toEqual([]);
  });
});

describe("matchMarketplaceListings", () => {
  const listings = [
    { title: "Mini fridge, barely used", price: 45, items: null },
    { title: "Desk lamp - white", price: 12, items: null },
    { title: "Dorm bundle", price: 60, items: [{ name: "Shower caddy" }, { name: "Fan" }] },
    { title: "Textbooks for CS", price: 30, items: null },
  ];

  it("matches by a shared word in the title", () => {
    expect(matchMarketplaceListings("Mini Fridge", listings)).toEqual({
      count: 1,
      minPrice: 45,
    });
  });

  it("matches via a tagged item name inside a listing", () => {
    expect(matchMarketplaceListings("Shower Caddy", listings)).toEqual({
      count: 1,
      minPrice: 60,
    });
  });

  it("returns null when nothing meaningful matches", () => {
    expect(matchMarketplaceListings("Umbrella", listings)).toBeNull();
  });

  it("ignores short / stopword-only names", () => {
    expect(matchMarketplaceListings("a set", listings)).toBeNull();
  });

  it("counts multiple matches and reports the min price", () => {
    const many = [
      { title: "Fan - quiet", price: 20, items: null },
      { title: "Tower fan", price: 8, items: null },
    ];
    expect(matchMarketplaceListings("Fan", many)).toEqual({ count: 2, minPrice: 8 });
  });
});

describe("checklistCategoriesPresent", () => {
  it("returns distinct categories in first-seen order", () => {
    expect(
      checklistCategoriesPresent([
        item({ category: "Tech" }),
        item({ category: "Sleep" }),
        item({ category: "Tech" }),
      ]),
    ).toEqual(["Tech", "Sleep"]);
  });
});
