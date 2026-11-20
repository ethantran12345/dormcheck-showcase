import {
  BedDouble,
  Bath,
  Laptop,
  FileText,
  Package,
  UtensilsCrossed,
  Home,
  Shirt,
  Lamp,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { type GroupMemberLabelInput } from "./checklistTypes";
import type { ChecklistItem, ChecklistItemStatus } from "@/types";
import { categorizeProductName } from "@/lib/checklistSection";

const ADD_ITEM_PLACEHOLDER = "Add your specific item...";

/** Split-costs is disabled for now - flip to true to restore the per-item split UI. */
const SPLIT_COSTS_ENABLED: boolean = false;

/** Inline checklist fields: transparent, no boxed border/ring; subtle underline/tint on focus. */
const CHECKLIST_INLINE_INPUT_CLASS =
  "rounded-none border-0 border-b border-transparent bg-transparent px-0 py-0 text-foreground shadow-none ring-0 ring-offset-0 placeholder:text-muted-foreground focus-visible:border-border focus-visible:bg-accent/25 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0";

const MOBILE_SHEET_INPUT_SCROLL_DELAY_MS = 300;

function pickFirstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Member chip label: profile/settlement names, then neutral fallback. */
function resolveGroupMemberLabel(member: {
  display_name?: string | null;
  full_name?: string | null;
}): string {
  return (
    pickFirstNonEmpty(
      member.display_name,
      member.full_name,
    ) ?? "Student"
  );
}

function buildDisambiguatedMemberLabels(members: GroupMemberLabelInput[]): Map<string, string> {
  const entries = members.map((member) => ({
    user_id: member.user_id,
    base: resolveGroupMemberLabel(member),
  }));
  const collisionCounts = new Map<string, number>();
  for (const { base } of entries) {
    collisionCounts.set(base, (collisionCounts.get(base) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const { user_id, base } of entries) {
    if ((collisionCounts.get(base) ?? 0) <= 1) {
      labels.set(user_id, base);
      continue;
    }
    labels.set(user_id, `${base} (${user_id.slice(-4)})`);
  }
  return labels;
}

function getInitials(name: string | null | undefined): string {
  const resolved = name?.trim() || "Student";
  const parts = resolved.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name?.slice(0, 2).toUpperCase() || "ST";
}

function getFirstName(name: string | null | undefined): string {
  if (!name?.trim()) return "Unknown";
  return name.trim().split(/\s+/)[0] ?? "Unknown";
}

/** Match copy/dedupe behavior: trimmed, case-insensitive item text. */
function checklistCopyNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Composite lookup key for a (normalized item name, target list) pair.
 *
 * The separator is NUL because an item name can contain any printable
 * character a student types, so any printable delimiter is ambiguous: with "|",
 * ("a|b", "c") and ("a", "b|c") produce the same key and two different pairs
 * collide. Write it as the ESCAPE `\x00`, never as a literal NUL byte in this
 * file - a raw NUL makes grep classify the source as binary and skip it
 * silently, which is how this file went unsearchable until 2026-08-03. The
 * runtime string is identical either way.
 */
function copyTargetKey(itemName: string, targetGroupId: string | null): string {
  return `${checklistCopyNameKey(itemName)}\x00${targetGroupId ?? ""}`;
}

/**
 * O(1) membership test against a prebuilt Set of copyTargetKey()s. Replaces the
 * former O(K) per-call scan over the whole copy index, which ran once per copy
 * target per rendered item row (O(items x targets x indexSize) per render).
 */
function itemOnCopyTargetSet(
  indexSet: Set<string>,
  itemName: string,
  targetGroupId: string | null,
): boolean {
  const k = checklistCopyNameKey(itemName);
  if (!k) return false;
  return indexSet.has(copyTargetKey(itemName, targetGroupId));
}

function scrollMobileSheetInputIntoView(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  window.setTimeout(() => {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, MOBILE_SHEET_INPUT_SCROLL_DELAY_MS);
}

function checklistItemNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function getCategoryIcon(category: string): LucideIcon {
  if (category.includes("Sleep") || category.includes("Bedding")) return BedDouble;
  if (category.includes("Climate")) return Building2;
  if (category.includes("Bathroom")) return Bath;
  if (category.includes("Tech")) return Laptop;
  if (category.includes("Documents")) return FileText;
  if (category === "Kitchen" || category === "Full Kitchen") return UtensilsCrossed;
  if (category === "Living Room") return Home;
  if (category === "Laundry") return Shirt;
  if (category.includes("Wellness")) return Package;
  if (category === "Decor") return Lamp;
  if (category.includes("Organization")) return Package;
  return Package;
}

/* ------------------------------------------------------------------ *
 * Checklist v2 readiness model (pure, testable).
 *
 * The list is re-skeletoned around state + urgency rather than category:
 *   Still need      → status 'need'
 *   Have            → status 'bought' (own it, not yet packed)
 *   Packed          → status 'packed' (collapses to a summary)
 *   Shared          → assigned to a roommate (off my plate)
 *   Skipped         → status 'skip' (leave at home)
 * ------------------------------------------------------------------ */

/** Normalize an item's status, tolerating the legacy null shape (is_checked). */
function resolveChecklistStatus(
  item: Pick<ChecklistItem, "status" | "is_checked">,
): ChecklistItemStatus {
  const s = item.status;
  if (s === "need" || s === "bought" || s === "packed" || s === "skip") return s;
  return item.is_checked ? "packed" : "need";
}

/** True when a roommate other than the current user is bringing this item. */
function isSharedAway(
  item: Pick<ChecklistItem, "assigned_to">,
  currentUserId: string | null | undefined,
): boolean {
  return !!item.assigned_to && !!currentUserId && item.assigned_to !== currentUserId;
}

/**
 * Move-In Readiness weights. The UI is intentionally based on the two actions
 * every student understands: getting an item and packing it.
 */
const READINESS_WEIGHTS = {
  acquired: 0.6,
  packed: 0.4,
} as const;

interface ChecklistReadiness {
  /** 0-100 weighted "am I ready?" number. */
  readiness: number;
  /** Items on my plate (excludes skipped + shared-away). */
  total: number;
  /** Acquired = bought + packed. */
  got: number;
  needCount: number;
  /** Still-need items that carry a price (for the "X of N priced" budget hint). */
  needPricedCount: number;
  boughtCount: number;
  packedCount: number;
  skipCount: number;
  sharedCount: number;
  nightOneTotal: number;
  /** Night One items that are packed (ready for the first night). */
  nightOneReady: number;
}

/**
 * Readiness and the sub-counts used by the summary. Skipped and shared-away
 * items are excluded because they are no longer on this student's plate.
 * Legacy Night One metadata is intentionally ignored.
 */
function computeChecklistReadiness(
  items: ChecklistItem[],
  currentUserId: string | null | undefined,
): ChecklistReadiness {
  let needCount = 0;
  let needPricedCount = 0;
  let boughtCount = 0;
  let packedCount = 0;
  let skipCount = 0;
  let sharedCount = 0;

  for (const item of items) {
    if (isSharedAway(item, currentUserId)) {
      sharedCount += 1;
      continue;
    }
    const s = resolveChecklistStatus(item);
    if (s === "skip") {
      skipCount += 1;
      continue;
    }
    if (s === "need") {
      needCount += 1;
      if (Number(item.estimated_price) > 0) needPricedCount += 1;
    } else if (s === "bought") boughtCount += 1;
    else packedCount += 1;
  }

  const total = needCount + boughtCount + packedCount;
  const got = boughtCount + packedCount;
  const acquiredRatio = total === 0 ? 0 : got / total;
  const packedRatio = total === 0 ? 0 : packedCount / total;

  const readiness =
    total === 0
      ? 0
      : Math.round(
          (READINESS_WEIGHTS.acquired * acquiredRatio +
            READINESS_WEIGHTS.packed * packedRatio) *
            100,
        );

  return {
    readiness,
    total,
    got,
    needCount,
    needPricedCount,
    boughtCount,
    packedCount,
    skipCount,
    sharedCount,
    nightOneTotal: 0,
    nightOneReady: 0,
  };
}

interface ChecklistReadinessGroups {
  /** First-night essentials not yet packed (pinned band). */
  nightOne: ChecklistItem[];
  stillNeed: ChecklistItem[];
  have: ChecklistItem[];
  packed: ChecklistItem[];
  skipped: ChecklistItem[];
  shared: ChecklistItem[];
}

/** Bucket personal items by their current state. */
function groupChecklistByReadiness(
  items: ChecklistItem[],
  currentUserId: string | null | undefined,
): ChecklistReadinessGroups {
  const groups: ChecklistReadinessGroups = {
    nightOne: [],
    stillNeed: [],
    have: [],
    packed: [],
    skipped: [],
    shared: [],
  };
  for (const item of items) {
    if (isSharedAway(item, currentUserId)) {
      groups.shared.push(item);
      continue;
    }
    const s = resolveChecklistStatus(item);
    if (s === "skip") groups.skipped.push(item);
    else if (s === "need") groups.stillNeed.push(item);
    else if (s === "bought") groups.have.push(item);
    else groups.packed.push(item);
  }
  return groups;
}

interface ChecklistClaimGroups {
  /** First-night essentials not yet packed (pinned band). */
  nightOne: ChecklistItem[];
  /** Unclaimed items anyone can grab (assigned_to null, not yet packed). */
  upForGrabs: ChecklistItem[];
  /** Claimed by someone (assigned_to set) and not yet packed. */
  beingBrought: ChecklistItem[];
  /** Packed / done (collapses). */
  packed: ChecklistItem[];
  /** Leave at home. */
  skipped: ChecklistItem[];
}

/**
 * Group-checklist bucketing (claim-first). Unlike the personal readiness split,
 * the primary axis for a shared list is WHO is bringing an item, not the current
 * user's have/packed state: unclaimed items surface in "Up for grabs" so nobody
 * double-buys, and anything a roommate has claimed collects under "Being brought".
 * A not-yet-packed Night One essential shows ONLY in the pinned band; once packed
 * it collapses into Packed like any other done item. Pure + currentUser-agnostic.
 */
function groupChecklistByClaim(items: ChecklistItem[]): ChecklistClaimGroups {
  const groups: ChecklistClaimGroups = {
    nightOne: [],
    upForGrabs: [],
    beingBrought: [],
    packed: [],
    skipped: [],
  };
  for (const item of items) {
    const s = resolveChecklistStatus(item);
    if (s === "skip") groups.skipped.push(item);
    else if (item.is_night_one && s !== "packed") groups.nightOne.push(item);
    else if (s === "packed") groups.packed.push(item);
    else if (item.assigned_to) groups.beingBrought.push(item);
    else groups.upForGrabs.push(item);
  }
  return groups;
}

/**
 * Find an existing still-need row a newly-added product should ATTACH to (fill
 * its link/price/image) instead of spawning a duplicate. Matches on the same
 * list (group), 'need' status, and normalized item name. Ignores optimistic
 * temp rows (id starts with "temp-"). Returns null when there is nothing to
 * attach to (caller inserts a fresh row).
 */
function findAttachableNeedRow(
  items: ChecklistItem[],
  name: string,
  groupId: string | null,
): ChecklistItem | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return (
    items.find(
      (i) =>
        (i.group_id ?? null) === (groupId ?? null) &&
        resolveChecklistStatus(i) === "need" &&
        i.item.trim().toLowerCase() === key &&
        !!i.id &&
        !String(i.id).startsWith("temp-"),
    ) ?? null
  );
}

/**
 * Phase 4 "buy new / used": match a still-need item against live campus Student
 * Market listings so the row can offer a used option next to the new price.
 * Structural input so the matcher stays decoupled from the full listing type.
 */
interface MarketplaceMatchListing {
  title: string;
  price: number | null;
  items?: { name: string | null }[] | null;
}

interface MarketplaceMatch {
  count: number;
  minPrice: number;
}

// Tokens too generic to signal a real product match.
const MARKETPLACE_STOP_TOKENS = new Set([
  "the", "and", "for", "with", "set", "pack", "new", "used", "your", "you",
  "size", "twin", "xtra", "long", "pcs", "piece", "count",
]);

function marketplaceTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !MARKETPLACE_STOP_TOKENS.has(t));
}

/**
 * Returns { count, minPrice } of available listings that share a meaningful
 * word with the item name (title or a tagged item name), or null when nothing
 * matches - so the used affordance renders ONLY when there is a real match.
 */
function matchMarketplaceListings(
  itemName: string,
  listings: MarketplaceMatchListing[],
): MarketplaceMatch | null {
  const wanted = new Set(marketplaceTokens(itemName));
  if (wanted.size === 0) return null;
  let count = 0;
  let minPrice = Number.POSITIVE_INFINITY;
  for (const l of listings) {
    const hay = [l.title, ...(l.items ?? []).map((i) => i?.name ?? "")].join(" ");
    if (marketplaceTokens(hay).some((t) => wanted.has(t))) {
      count += 1;
      const p = Number(l.price);
      if (Number.isFinite(p) && p >= 0) minPrice = Math.min(minPrice, p);
    }
  }
  if (count === 0) return null;
  return { count, minPrice: Number.isFinite(minPrice) ? minPrice : 0 };
}

/**
 * Split a pasted / multi-line block into clean item names for bulk capture.
 * Splits on any newline, trims, strips common list bullets ("- ", "* ", "1. "),
 * drops empties, and de-dupes WITHIN the paste (case-insensitive, first wins).
 * De-duping against the existing list is the caller's job (findAttachableNeedRow).
 */
function splitBulkItemNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const cleaned = raw
      .trim()
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Distinct categories present in a set of items, in first-seen order. */
function checklistCategoriesPresent(items: ChecklistItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item.category && !seen.has(item.category)) {
      seen.add(item.category);
      out.push(item.category);
    }
  }
  return out;
}

/**
 * Repair legacy presentation-only categories without mutating user data.
 * Older unknown additions fell into the first section (usually Bedding), and
 * some rows still carry the retired Night One section name.
 */
function visibleChecklistCategory(
  item: Pick<ChecklistItem, "item" | "category">,
): string {
  const stored = item.category?.trim() || "Unsorted";
  const inferred = categorizeProductName(item.item);
  if (stored.toLowerCase() === "night one") {
    return inferred === "Uncategorized" ? "Unsorted" : inferred;
  }
  if (stored.toLowerCase() === "bedding" && inferred !== "Bedding") {
    return inferred === "Uncategorized" ? "Unsorted" : inferred;
  }
  return stored;
}

export {
  ADD_ITEM_PLACEHOLDER,
  SPLIT_COSTS_ENABLED,
  CHECKLIST_INLINE_INPUT_CLASS,
  MOBILE_SHEET_INPUT_SCROLL_DELAY_MS,
  pickFirstNonEmpty,
  resolveGroupMemberLabel,
  buildDisambiguatedMemberLabels,
  getInitials,
  getFirstName,
  checklistCopyNameKey,
  copyTargetKey,
  itemOnCopyTargetSet,
  scrollMobileSheetInputIntoView,
  checklistItemNameKey,
  getCategoryIcon,
  resolveChecklistStatus,
  isSharedAway,
  READINESS_WEIGHTS,
  computeChecklistReadiness,
  groupChecklistByReadiness,
  groupChecklistByClaim,
  findAttachableNeedRow,
  splitBulkItemNames,
  matchMarketplaceListings,
  checklistCategoriesPresent,
  visibleChecklistCategory,
  type MarketplaceMatchListing,
  type MarketplaceMatch,
  type ChecklistReadiness,
  type ChecklistReadinessGroups,
  type ChecklistClaimGroups,
};
