import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ClipboardEvent,
  type CSSProperties,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  ChevronDown,
  MoreVertical,
  Ban,
  CornerUpLeft,
  Tag,
  Trash2,
  Users,
  Plus,
  FolderInput,
  NotebookPen,
  Store,
  X,
  PackageOpen,
  Link2,
  ExternalLink,
  GripVertical,
  Loader2,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { isSafeHttpUrl, withAffiliateTag } from "@/lib/amazonAffiliateUrl";
import { EmptyState } from "@/components/ui/EmptyState";
import { FoldedBeddingIllustration } from "@/components/illustrations/DormIllustrations";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChecklistReadinessSummary } from "./ChecklistReadinessSummary";
import { QuickAddBrainDumpSheet } from "./QuickAddBrainDumpSheet";
import type { ChecklistItem, ChecklistItemStatus } from "@/types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  groupChecklistByReadiness,
  resolveChecklistStatus,
  isSharedAway,
  splitBulkItemNames,
  matchMarketplaceListings,
  visibleChecklistCategory,
  type ChecklistReadiness,
  type MarketplaceMatch,
  type MarketplaceMatchListing,
} from "./checklistHelpers";

/** Move-to / copy-to destinations (Personal + the user's group lists). */
export interface ChecklistListTarget {
  id: string | null;
  label: string;
}

const ALL = "__all__";

export interface ChecklistReadinessViewProps {
  items: ChecklistItem[];
  currentUserId: string | null;
  /** Weighted readiness for the whole list (computed once by the page). */
  readiness: ChecklistReadiness;
  /** Category names available for the filter chips + re-tag menu. */
  categories: string[];
  loading: boolean;
  /** Sum of still-need prices, for the desktop rail summary (Est. total + budget). */
  estimatedCost: number;
  /** Personal list id for the budget localStorage key; omit to hide budget. */
  listId?: string | null;
  onAdvance: (item: ChecklistItem) => void;
  onSetStatus: (id: string, status: ChecklistItemStatus) => void;
  onToggleNightOne: (id: string) => void;
  onRetag: (id: string, category: string) => void;
  onAddItem: (name: string) => void;
  /** Fast capture: create many need items at once (paste / brain-dump). */
  onAddBulk: (names: string[]) => void;
  onDelete: (id: string) => void;
  /** Attach / replace a link on an item (fetches title + thumbnail upstream). */
  onSaveLink: (id: string, url: string) => void;
  /** Clear an item's link. */
  onRemoveLink: (id: string) => void;
  /** Id of the item whose link preview is currently fetching (spinner). */
  linkFetchingId: string | null;
  /** Other lists this item can be moved to (Personal + the user's group lists). */
  moveTargets: ChecklistListTarget[];
  onMove: (item: ChecklistItem, targetId: string | null, targetLabel: string) => void;
  /** Live campus Student Market listings, for the "buy used" affordance on need rows. */
  marketplaceListings: MarketplaceMatchListing[];
  onShopUsed: (item: ChecklistItem) => void;
  /** Persist a DrawNames-style reorder within a readiness group (Night One /
   *  Still need). When omitted, item rows render static (no grips, no DnD). */
  onReorderGroup?: (orderedIds: string[]) => void;
  /** List-actions `⋯` menu, rendered on the desktop rail summary card. */
  actionsSlot?: ReactNode;
  /**
   * Bumped by the command palette's "Add a checklist item" action (`?add=1`):
   * each new value focuses the add field. A counter, not a boolean, so running
   * the action twice in a row focuses it twice.
   */
  focusAddRequest?: number;
}

/** Three-state status control: need (empty) -> have (ringed dot) -> packed (check). Tap advances. */
function StatusChip({
  item,
  onAdvance,
}: {
  item: ChecklistItem;
  onAdvance: () => void;
}) {
  const { t } = useTranslation();
  const s = resolveChecklistStatus(item);
  const label =
    s === "packed"
      ? t("checklist:v2.statusPacked")
      : s === "bought"
        ? t("checklist:v2.statusHave")
        : t("checklist:v2.statusNeed");
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(e) => {
        e.stopPropagation();
        onAdvance();
      }}
      // hover:bg-transparent: the raw button had no hover fill and ghost brings one.
      // [&_svg]:size-3.5: Button's base [&_svg]:size-4 would inflate the 14px check.
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 transition-transform active:scale-95 hover:bg-transparent [&_svg]:size-3.5"
      aria-label={t("checklist:v2.advanceAria", { item: item.item, status: label })}
    >
      {s === "packed" ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-malachite-600 bg-malachite-800 text-white shadow-raised"> {/* KEEP: done-checkbox filled state */}
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : s === "bought" ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-border bg-card">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" aria-hidden />
        </span>
      ) : (
        <span className="block h-6 w-6 rounded-full border-2 border-border bg-card" aria-hidden />
      )}
    </Button>
  );
}

function ItemRow({
  item,
  currentUserId,
  categories,
  moveTargets,
  marketplaceMatchByItem,
  onAdvance,
  onSetStatus,
  onRetag,
  onDelete,
  onMove,
  onShopUsed,
  onSaveLink,
  onRemoveLink,
  linkFetchingId,
  showStatusChip = true,
}: {
  item: ChecklistItem;
  currentUserId: string | null;
  categories: string[];
  moveTargets: ChecklistListTarget[];
  marketplaceMatchByItem: Map<string, MarketplaceMatch>;
  onAdvance: (item: ChecklistItem) => void;
  onSetStatus: (id: string, status: ChecklistItemStatus) => void;
  onRetag: (id: string, category: string) => void;
  onDelete: (id: string) => void;
  onMove: (item: ChecklistItem, targetId: string | null, targetLabel: string) => void;
  onShopUsed: (item: ChecklistItem) => void;
  onSaveLink: (id: string, url: string) => void;
  onRemoveLink: (id: string) => void;
  linkFetchingId: string | null;
  showStatusChip?: boolean;
}) {
  const { t } = useTranslation();
  const s = resolveChecklistStatus(item);
  const shared = isSharedAway(item, currentUserId);
  const price = Number(item.estimated_price) || 0;
  const usedMatch = marketplaceMatchByItem.get(item.id) ?? null;
  // Amazon (and other) links open through the affiliate tagger, gated as safe http(s).
  const safeHref = isSafeHttpUrl(item.link) ? withAffiliateTag(item.link) : null;
  const fetchingLink = linkFetchingId === item.id;

  const [linkEditing, setLinkEditing] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const openLinkEditor = () => {
    setLinkDraft(item.link ?? "");
    setLinkEditing(true);
  };
  const submitLink = () => {
    const v = linkDraft.trim();
    if (v) onSaveLink(item.id, v);
    setLinkEditing(false);
  };

  // Shop-sourced items carry a product image (+ chosen variant) - show it as a
  // small preview thumbnail so the checklist reads like the DrawNames picks, not
  // a bare text list.
  const productImage = item.image_url ?? item.link_image ?? null;
  const thumb = productImage ? (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-0.5">
      <img src={productImage} alt="" loading="lazy" className="h-full w-full object-contain" />
    </span>
  ) : null;
  return (
    <div className="group md:rounded-lg md:px-1 md:transition-colors md:hover:bg-accent/40">
      <div className="flex items-center gap-2.5 py-2 md:py-1.5">
        {showStatusChip && !shared ? (
          <StatusChip item={item} onAdvance={() => onAdvance(item)} />
        ) : shared ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-orange-400"
            aria-hidden
          >
            <Users className="h-4 w-4" strokeWidth={2} />
          </span>
        ) : null}

        {thumb ? (
          safeHref ? (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={t("checklist:v2.viewProduct", { item: item.item })}
              className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600" // KEEP: interaction-only focus ring
            >
              {thumb}
            </a>
          ) : (
            thumb
          )
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {safeHref ? (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1 truncate text-sm text-foreground hover:underline",
                  s === "packed" && "text-muted-foreground line-through",
                )}
              >
                <span className="truncate">{item.item}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2} aria-hidden />
              </a>
            ) : (
              // Wraps instead of truncating: a cut item name had no other place
              // to be read in full (the row itself is the item).
              <span
                className={cn(
                  "min-w-0 break-words text-sm text-foreground",
                  s === "packed" && "text-muted-foreground line-through",
                )}
              >
                {item.item}
              </span>
            )}
            {item.variant_label ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {item.variant_label}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{visibleChecklistCategory(item)}</span>
            {price > 0 ? (
              <span className="tabular-nums">${price.toFixed(2)}</span>
            ) : null}
          </div>
          {usedMatch ? (
            <Button
              type="button"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onShopUsed(item);
              }}
              // [&_svg]:size-3 keeps the 12px store glyph off Button's base [&_svg]:size-4.
              className="mt-1 inline-flex h-auto items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent [&_svg]:size-3"
            >
              <Store className="h-3 w-3" strokeWidth={2} aria-hidden />
              {t("checklist:v2.buyUsed", {
                price: usedMatch.minPrice,
                count: usedMatch.count,
              })}
            </Button>
          ) : null}
        </div>

        {fetchingLink ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 md:data-[state=open]:opacity-100"
              aria-label={t("checklist:v2.moreActions", { item: item.item })}
            >
              <MoreVertical className="h-4 w-4" strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {s === "skip" ? (
              <DropdownMenuItem onSelect={() => onSetStatus(item.id, "need")}>
                <CornerUpLeft className="mr-2 h-4 w-4" strokeWidth={2} />
                {t("checklist:v2.unskip")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onSetStatus(item.id, "skip")}>
                <Ban className="mr-2 h-4 w-4" strokeWidth={2} />
                {t("checklist:v2.skipItem")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setTimeout(openLinkEditor, 0)}>
              <Link2 className="mr-2 h-4 w-4" strokeWidth={2} />
              {item.link ? t("checklist:v2.editLink") : t("checklist:v2.addLink")}
            </DropdownMenuItem>
            {item.link ? (
              <DropdownMenuItem onSelect={() => onRemoveLink(item.id)}>
                <X className="mr-2 h-4 w-4" strokeWidth={2} />
                {t("checklist:v2.removeLink")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag className="mr-2 h-4 w-4" strokeWidth={2} />
                {t("checklist:v2.changeCategory")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {categories.map((cat) => (
                  <DropdownMenuItem
                    key={cat}
                    disabled={cat === item.category}
                    onSelect={() => onRetag(item.id, cat)}
                  >
                    {cat}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {moveTargets.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="mr-2 h-4 w-4" strokeWidth={2} />
                  {t("checklist:v2.moveTo")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                  {moveTargets.map((tgt) => (
                    <DropdownMenuItem
                      key={tgt.id ?? "personal"}
                      onSelect={() => onMove(item, tgt.id, tgt.label)}
                    >
                      {tgt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(item.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" strokeWidth={2} />
              {t("checklist:v2.deleteItem")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inline URL editor, revealed from the row menu. */}
      {linkEditing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitLink();
          }}
          className="flex items-center gap-2 pb-2 pl-11"
        >
          <input
            type="url"
            inputMode="url"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkEditing(false);
              }
            }}
            placeholder={t("checklist:v2.linkPlaceholder")}
            aria-label={t("checklist:v2.linkAria", { item: item.item })}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-border focus:ring-0"
          />
          <Button
            type="submit"
            variant="ghost"
            className="h-auto shrink-0 rounded-full bg-malachite-800 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-malachite-900 hover:text-white" // KEEP: primary CTA for saving link
          >
            {t("checklist:v2.saveLink")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLinkEditing(false)}
            className="h-auto shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("checklist:v2.cancelLink")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function GroupCard({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-raised md:p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          {typeof count === "number" ? (
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h3>
      </div>
      {hint ? <p className="mb-1 px-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

function CollapsibleGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-card shadow-raised">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        // The chevron's tint is expressed as [&_svg]:text-muted-foreground, NOT as a
        // colour on the svg and NOT as a plain text-* on the button. Button's base
        // carries [&_svg]:text-current, a descendant rule that outranks a utility on
        // the svg itself; putting the colour on the button and relying on currentColor
        // was measured live and did NOT hold. Matching the base's own [&_svg]:text-*
        // group is what makes tailwind-merge pick exactly one winner.
        className="flex h-auto w-full items-center justify-between gap-2 rounded-none px-4 py-3 text-left font-normal hover:bg-transparent [&_svg]:text-muted-foreground"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          strokeWidth={2}
          aria-hidden
        />
      </Button>
      {open ? <div className="divide-y divide-border/60 px-4 pb-2">{children}</div> : null}
    </section>
  );
}

/** Grip-draggable wrapper around ItemRow for the reorderable readiness groups. */
function SortableItemRow({
  item,
  rowProps,
}: {
  item: ChecklistItem;
  rowProps: Omit<ComponentProps<typeof ItemRow>, "item">;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    strategy: verticalListSortingStrategy,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : (transition ?? "transform 200ms ease"),
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-1", isDragging && "relative z-10 opacity-70")}
    >
      {/* Always-visible grip (DrawNames-style). Drag starts ONLY from the grip, so
          tapping the status chip / kebab / link never begins a drag. */}
      <Button
        type="button"
        variant="ghost"
        {...attributes}
        {...listeners}
        // The grip's tint already lives on the button (the glyph inherits it), which is
        // exactly what Button's [&_svg]:text-current needs — no colour move required here.
        className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded p-0 text-muted-foreground/40 transition-colors hover:bg-transparent hover:text-muted-foreground active:cursor-grabbing active:scale-100"
        aria-label={t("checklist:v2.dragReorder", { item: item.item })}
      >
        <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
      </Button>
      <div className="min-w-0 flex-1">
        <ItemRow item={item} {...rowProps} />
      </div>
    </div>
  );
}

function ChecklistDragPreview({
  item,
  rowProps,
}: {
  item: ChecklistItem;
  rowProps: Omit<ComponentProps<typeof ItemRow>, "item">;
}) {
  return (
    <div className="pointer-events-none flex w-full items-center gap-1 rounded-lg bg-card shadow-overlay">
      <div className="flex h-9 w-6 shrink-0 items-center justify-center text-muted-foreground">
        <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <ItemRow item={item} {...rowProps} />
      </div>
    </div>
  );
}

export function ChecklistReadinessView({
  items,
  currentUserId,
  readiness,
  categories,
  loading,
  estimatedCost,
  listId,
  onAdvance,
  onSetStatus,
  onRetag,
  onAddItem,
  onAddBulk,
  onDelete,
  onSaveLink,
  onRemoveLink,
  linkFetchingId,
  moveTargets,
  onMove,
  marketplaceListings,
  onShopUsed,
  onReorderGroup,
  actionsSlot,
  focusAddRequest = 0,
}: ChecklistReadinessViewProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [newItem, setNewItem] = useState("");
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [brainDumpText, setBrainDumpText] = useState("");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const brainDumpRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusAddRequest) return;
    const input = inputRef.current;
    if (!input) return;
    input.scrollIntoView({ block: "center" });
    input.focus({ preventScroll: true });
  }, [focusAddRequest]);

  // Focus the brain-dump editor when it opens (ref+effect instead of autoFocus,
  // which jsx-a11y flags).
  useEffect(() => {
    if (brainDumpOpen) brainDumpRef.current?.focus();
  }, [brainDumpOpen]);

  // Category chips reflect only categories that actually have items.
  const categoriesPresent = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const i of items) {
      const category = visibleChecklistCategory(i);
      if (!seen.has(category)) {
        seen.add(category);
        out.push(category);
      }
    }
    return out;
  }, [items]);

  // Per-category counts for the desktop vertical filter rail.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const category = visibleChecklistCategory(i);
      m.set(category, (m.get(category) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const visible = useMemo(
    () => (activeCategory === ALL ? items : items.filter((i) => visibleChecklistCategory(i) === activeCategory)),
    [items, activeCategory],
  );

  const groups = useMemo(
    () => groupChecklistByReadiness(visible, currentUserId),
    [visible, currentUserId],
  );
  const editableCategories = useMemo(
    () => categories.filter((category) => category.trim().toLowerCase() !== "night one"),
    [categories],
  );

  // "Buy used" match: only still-need rows, only when a live listing matches.
  const marketplaceMatchByItem = useMemo(() => {
    const map = new Map<string, MarketplaceMatch>();
    if (marketplaceListings.length === 0) return map;
    for (const it of items) {
      if (!it.id) continue;
      if (resolveChecklistStatus(it) !== "need") continue;
      if (isSharedAway(it, currentUserId)) continue;
      const m = matchMarketplaceListings(it.item, marketplaceListings);
      if (m) map.set(it.id, m);
    }
    return map;
  }, [items, marketplaceListings, currentUserId]);

  const rowProps = {
    currentUserId,
    categories: editableCategories,
    moveTargets,
    marketplaceMatchByItem,
    onAdvance,
    onSetStatus,
    onRetag,
    onDelete,
    onMove,
    onShopUsed,
    onSaveLink,
    onRemoveLink,
    linkFetchingId,
  };

  // DnD (personal readiness reorder): a grip-drag reorders within one group only.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleGroupDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    if (!onReorderGroup) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Reorder only within the group both rows belong to; ignore cross-group drags.
    for (const list of [groups.stillNeed]) {
      const ids = list.map((i) => i.id);
      const from = ids.indexOf(activeId);
      if (from === -1) continue;
      const to = ids.indexOf(overId);
      if (to === -1) return;
      onReorderGroup(arrayMove(ids, from, to));
      return;
    }
  };

  const handleGroupDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const activeDragItem = activeDragId ? items.find((item) => item.id === activeDragId) ?? null : null;

  // Enter-to-add that KEEPS FOCUS: type name -> Enter -> type next, no mouse.
  const handleAdd = () => {
    const name = newItem.trim();
    if (!name) return;
    onAddItem(name);
    setNewItem("");
    inputRef.current?.focus();
  };

  // Paste of a multi-line block -> one bulk add (deduped upstream), stay focused.
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return; // single line: let the normal paste happen
    e.preventDefault();
    const names = splitBulkItemNames(text);
    if (names.length === 0) return;
    onAddBulk(names);
    setNewItem("");
    inputRef.current?.focus();
  };

  const commitBrainDump = () => {
    const names = splitBulkItemNames(brainDumpText);
    if (names.length > 0) onAddBulk(names);
    setBrainDumpText("");
    setBrainDumpOpen(false);
  };

  const closeBrainDump = () => {
    setBrainDumpOpen(false);
    setBrainDumpText("");
  };

  const hasAny = items.length > 0;

  const filterList = [ALL, ...categoriesPresent];

  const addBar = (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-raised">
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={newItem}
        onChange={(e) => setNewItem(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder={t("checklist:v2.addPlaceholder")}
        aria-label={t("checklist:v2.addPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {newItem.trim() ? (
        <Button
          type="button"
          variant="ghost"
          onClick={handleAdd}
          className="h-auto shrink-0 rounded-full bg-malachite-800 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-malachite-900 hover:text-white" // KEEP: primary CTA for adding item
        >
          {t("checklist:v2.addButton")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setBrainDumpOpen(true)}
          // [&_svg]:size-3.5 keeps the 14px glyph off Button's base [&_svg]:size-4.
          className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
        >
          <NotebookPen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t("checklist:v2.pasteList")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-none lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      {/* Left column: desktop-only sticky rail (summary + vertical filter).
          Hidden on mobile, where the page-level banner + chips take over. */}
      <aside className="hidden lg:block lg:sticky lg:top-20 lg:space-y-4">
        <ChecklistReadinessSummary
          readiness={readiness}
          estimatedCost={estimatedCost}
          listId={listId}
          loading={loading}
          variant="rail"
          actionsSlot={actionsSlot}
        />

      </aside>

      {/* Right column: mobile chips + the item groups + add bar. */}
      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragStart={handleGroupDragStart}
        onDragCancel={() => setActiveDragId(null)}
        onDragEnd={handleGroupDragEnd}
      >
      <div className="space-y-3">
        {/* Keep capture in the first viewport: type one item or paste a whole list. */}
        {addBar}

        {/* One compact filter replaces the scrolling wall of category chips. */}
        {categoriesPresent.length > 0 ? (
          <Select value={activeCategory} onValueChange={setActiveCategory}>
            <SelectTrigger className="h-10 w-full bg-card md:w-64" aria-label={t("checklist:v2.filterByCategory")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterList.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat === ALL
                    ? t("checklist:v2.allCategories", { count: items.length })
                    : t("checklist:v2.categoryWithCount", { category: cat, count: categoryCounts.get(cat) ?? 0 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {/* Still need */}
        {groups.stillNeed.length > 0 ? (
          <GroupCard title={t("checklist:v2.stillNeed")} count={groups.stillNeed.length}>
            {onReorderGroup ? (
              <SortableContext
                items={groups.stillNeed.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                {groups.stillNeed.map((item) => (
                  <SortableItemRow key={item.id} item={item} rowProps={rowProps} />
                ))}
              </SortableContext>
            ) : (
              groups.stillNeed.map((item) => (
                <ItemRow key={item.id} item={item} {...rowProps} />
              ))
            )}
          </GroupCard>
        ) : null}

        {/* Have (own it, not packed) */}
        {groups.have.length > 0 ? (
          <GroupCard
            title={t("checklist:v2.have")}
            hint={t("checklist:v2.haveHint")}
            count={groups.have.length}
          >
            {groups.have.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </GroupCard>
        ) : null}

        {/* Shared (a roommate is bringing these) */}
        {groups.shared.length > 0 ? (
          <GroupCard
            title={t("checklist:v2.shared")}
            hint={t("checklist:v2.sharedHint")}
            count={groups.shared.length}
          >
            {groups.shared.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps} showStatusChip={false} />
            ))}
          </GroupCard>
        ) : null}

        {/* Packed (collapsed) */}
        {groups.packed.length > 0 ? (
          <CollapsibleGroup
            title={t("checklist:v2.packedDone")}
            count={groups.packed.length}
          >
            {groups.packed.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </CollapsibleGroup>
        ) : null}

        {/* Skipped (collapsed) */}
        {groups.skipped.length > 0 ? (
          <CollapsibleGroup
            title={t("checklist:v2.skipped")}
            count={groups.skipped.length}
          >
            {groups.skipped.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps} showStatusChip={false} />
            ))}
          </CollapsibleGroup>
        ) : null}

        {/* Loading placeholder, sized to the row it stands in for: an ItemRow is a
            36px status chip inside `py-2 md:py-1.5`, i.e. 52px on mobile and 48px on
            desktop. Repeating the row's own wrapper classes means the placeholder
            cannot drift from the row height when that padding changes. */}
        {loading && !hasAny ? (
          <div aria-hidden="true" data-testid="checklist-rows-skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-2.5 py-2 md:py-1.5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                {/* Item names are short ("Shower caddy"), so a full-width bar
                    reads as a different list. Vary like real names do. */}
                <Skeleton className={cn("h-4", ["w-2/5", "w-1/3", "w-1/2", "w-1/4"][i % 4])} />
              </div>
            ))}
          </div>
        ) : null}

        {/* Empty state. The description names exactly the two controls below it:
            this used to render title + body + illustration and NO action prop,
            so a first-run student was told to add items and handed nothing to
            press. Both CTAs drive controls that already exist in this view —
            the add input (focused, so the keyboard opens on iOS) and the
            brain-dump sheet — rather than routing anywhere. */}
        {!loading && !hasAny ? (
          <EmptyState
            className="rounded-card border border-dashed border-border bg-card py-10"
            icon={PackageOpen}
            illustration={<FoldedBeddingIllustration />}
            title={t("checklist:v2.emptyTitle")}
            description={t("checklist:v2.emptyBody")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  onClick={() => inputRef.current?.focus()}
                  className="rounded-full px-4"
                >
                  {t("checklist:v2.emptyAddCta")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBrainDumpOpen(true)}
                  className="rounded-full px-4 [&_svg]:size-3.5"
                >
                  <NotebookPen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {t("checklist:v2.emptyQuickAddCta")}
                </Button>
              </div>
            }
          />
        ) : null}

      </div>
      {/* PageTransition uses a transform while the route settles. A fixed-position
          overlay inside that transformed ancestor inherits its coordinate space and
          lands below the pointer. Portaling to body keeps viewport and pointer
          coordinates identical for mouse and touch. */}
      {typeof document !== "undefined"
        ? createPortal(
            <DragOverlay dropAnimation={{ duration: 240, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
              {activeDragItem ? <ChecklistDragPreview item={activeDragItem} rowProps={rowProps} /> : null}
            </DragOverlay>,
            document.body,
          )
        : null}
      </DndContext>

      {/* Quick-add brain-dump. Mobile: a full-screen keyboard-aware notepad.
          Desktop: a centered dialog. One item per line; Done commits every
          non-empty line (auto-categorized + deduped upstream). */}
      <QuickAddBrainDumpSheet
        open={brainDumpOpen}
        onOpenChange={(open) => {
          if (!open) closeBrainDump();
        }}
        onCommit={commitBrainDump}
        value={brainDumpText}
        onChange={setBrainDumpText}
        textareaRef={brainDumpRef}
      />
    </div>
  );
}
