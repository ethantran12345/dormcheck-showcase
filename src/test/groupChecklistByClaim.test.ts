import { describe, it, expect } from "vitest";
import { groupChecklistByClaim } from "@/components/checklist/checklistHelpers";
import type { ChecklistItem } from "@/types";

function item(over: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: over.id ?? "x",
    user_id: "u0",
    category: over.category ?? "Bedding",
    item: over.item ?? "Thing",
    is_checked: false,
    is_custom: true,
    ...over,
  } as ChecklistItem;
}

describe("groupChecklistByClaim", () => {
  it("routes unclaimed needs to Up for grabs, claimed to Being brought", () => {
    const g = groupChecklistByClaim([
      item({ id: "a", status: "need", assigned_to: null }),
      item({ id: "b", status: "need", assigned_to: "u1" }),
      item({ id: "c", status: "bought", assigned_to: "u2" }),
    ]);
    expect(g.upForGrabs.map((i) => i.id)).toEqual(["a"]);
    expect(g.beingBrought.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("pins unpacked Night One items to the band, not their claim bucket", () => {
    const g = groupChecklistByClaim([
      item({ id: "n1", status: "need", is_night_one: true, assigned_to: "u1" }),
      item({ id: "n2", status: "packed", is_night_one: true, assigned_to: "u1" }),
    ]);
    expect(g.nightOne.map((i) => i.id)).toEqual(["n1"]);
    expect(g.beingBrought).toHaveLength(0);
    // A packed Night One collapses into Packed like any other done item.
    expect(g.packed.map((i) => i.id)).toEqual(["n2"]);
  });

  it("separates packed and skipped regardless of assignee", () => {
    const g = groupChecklistByClaim([
      item({ id: "p", status: "packed", assigned_to: "u1" }),
      item({ id: "s", status: "skip", assigned_to: null }),
    ]);
    expect(g.packed.map((i) => i.id)).toEqual(["p"]);
    expect(g.skipped.map((i) => i.id)).toEqual(["s"]);
  });

  it("treats a null status as need (legacy is_checked=false)", () => {
    const g = groupChecklistByClaim([item({ id: "leg", status: null, assigned_to: null })]);
    expect(g.upForGrabs.map((i) => i.id)).toEqual(["leg"]);
  });
});
