import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, Check, ChevronDown, ChevronRight, MoreHorizontal, Package, Plus, ShoppingBag, SlidersHorizontal, Star, Trash2, Users2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayTitle,
} from "@/components/ui/adaptive-overlay";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExploreProductDetailModal } from "@/components/checklist/ExploreProductDetailModal";
import { cn } from "@/lib/utils";
import { checklistExploreNameKey } from "@/lib/checklistExploreNameKey";
import { findBannedAdvisory } from "@/lib/bannedMatch";
import type { ChecklistItem } from "@/types";
import { resolveChecklistSection } from "@/lib/checklistSection";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModalOverlay } from "@/contexts/ModalOverlayContext";
import { useHousingSaved } from "@/contexts/HousingSavedContext";
import { motion } from "framer-motion";
import { listItemVariants } from "@/lib/motion";
import { supabase } from "@/integrations/supabase/client";
import type { ExploreProduct } from "@/types/exploreProduct";
import { AMAZON_PRODUCTS_QUERY_KEY, useAmazonProducts } from "@/hooks/useAmazonProducts";
import {
  EXPLORE_PICK_VARIANTS_QUERY_KEY,
  useExplorePickVariants,
  type PickVariant,
} from "@/hooks/useExplorePickVariants";
import { EXPLORE_PICK_CREATED_AT_QUERY_KEY, useExplorePickCreatedAt } from "@/hooks/useExplorePickCreatedAt";
import { buildAffiliateUrl } from "@/lib/products/provider";
import { PAGE_SEARCH_ATTR } from "@/lib/pageSearch";
import { groupLabel, type ChecklistTopBarGroup } from "@/components/checklist/ChecklistTopBar";

type SortMode = "trending" | "price-asc" | "price-desc" | "rating-desc" | "hearts-desc";

const EXPLORE_SORT_OPTIONS: { value: SortMode; labelKey: string }[] = [
  { value: "trending", labelKey: "checklist:explore.sortOptions.trending" },
  { value: "price-asc", labelKey: "checklist:explore.sortOptions.priceLowToHigh" },
  { value: "price-desc", labelKey: "checklist:explore.sortOptions.priceHighToLow" },
  { value: "rating-desc", labelKey: "checklist:explore.sortOptions.highestRated" },
  { value: "hearts-desc", labelKey: "checklist:explore.sortOptions.mostPopular" },
];

const EXPLORE_FILTER_CATEGORIES_KEYS: { value: string; labelKey: string }[] = [
  { value: "All", labelKey: "checklist:explore.categories.all" },
  { value: "Bedding", labelKey: "checklist:explore.categories.bedding" },
  { value: "Bath", labelKey: "checklist:explore.categories.bath" },
  { value: "Storage", labelKey: "checklist:explore.categories.storage" },
  { value: "Tech", labelKey: "checklist:explore.categories.tech" },
  { value: "Health", labelKey: "checklist:explore.categories.health" },
  { value: "Decor", labelKey: "checklist:explore.categories.decor" },
  { value: "Kitchen", labelKey: "checklist:explore.categories.kitchen" },
  { value: "Cleaning", labelKey: "checklist:explore.categories.cleaning" },
  { value: "School Supplies", labelKey: "checklist:explore.categories.schoolSupplies" },
];

/** Upper bound for the max-price slider (nearest $50 below $200 else $100). */
function roundExplorePriceSliderMax(raw: number): number {
  if (raw <= 0) return 100;
  const step = raw >= 200 ? 100 : 50;
  return Math.ceil(raw / step) * step;
}

function exploreProductCardId(productName: string): string {
  return `product-${productName.replace(/\s+/g, "-")}`;
}

function formatReviewCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Order section names for display / summaries: sections already present in the
 * checklist first (in the checklist's own order), then any auto-categorizer
 * defaults not yet on the checklist, alphabetically.
 */
function orderSections(sections: string[], existingSections: string[]): string[] {
  const inExisting = existingSections.filter((s) => sections.includes(s));
  const leftovers = sections
    .filter((s) => !existingSections.includes(s))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [...inExisting, ...leftovers];
}

interface SectionPickMenuProps {
  sections: string[];
  highlightSection: string;
  creatingNew: boolean;
  newDraft: string;
  onSetCreatingNew: (v: boolean) => void;
  onNewDraftChange: (v: string) => void;
  onPickExisting: (name: string) => void;
  onConfirmNewName: (name: string) => void;
}

function SectionPickMenu({
  sections,
  highlightSection,
  creatingNew,
  newDraft,
  onSetCreatingNew,
  onNewDraftChange,
  onPickExisting,
  onConfirmNewName,
}: SectionPickMenuProps) {
  const trimmed = newDraft.trim();
  const newSectionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingNew) {
      newSectionInputRef.current?.focus();
    }
  }, [creatingNew]);

  return (
    <div className="flex flex-col py-1">
      <div className="max-h-56 min-h-0 overflow-y-auto overscroll-contain">
        {sections.map((name) => (
          <Button
            key={name}
            type="button"
            onClick={() => onPickExisting(name)}
            className={cn(
              "flex w-full items-center border border-transparent px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent",
              highlightSection === name && "border-border bg-muted text-foreground"
            )}
            variant="ghost"
          >
            {name}
          </Button>
        ))}
      </div>
      <div className="my-1 shrink-0 border-t border-border" role="separator" />
      {!creatingNew ? (
        <Button
          type="button"
          onClick={() => {
            onSetCreatingNew(true);
            onNewDraftChange("");
          }}
          className="w-full shrink-0 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-accent"
          variant="ghost"
        >
          ＋ Create new section
        </Button>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
          <Input
            ref={newSectionInputRef}
            placeholder="Section name"
            value={newDraft}
            onChange={(e) => onNewDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed) {
                e.preventDefault();
                onConfirmNewName(trimmed);
              }
            }}
            className="h-8 flex-1 rounded-lg border-border text-xs"
          />
          <Button
            type="button"
            disabled={!trimmed}
            onClick={() => trimmed && onConfirmNewName(trimmed)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            aria-label="Confirm new section"
            variant="ghost"
          >
            <Check className="h-4 w-4" strokeWidth={2.5} />
          </Button>
        </div>
      )}
    </div>
  );
}

const MY_PICKS_SORTABLE_TRANSITION = { duration: 200, easing: "ease" } as const;

function MyPicksDragOverlayCard({
  product,
  imageLoadErrors,
}: {
  product: ExploreProduct;
  imageLoadErrors: Set<string>;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none relative flex w-[296px] max-w-[calc(100vw-2rem)] cursor-grabbing items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-overlay scale-105 rotate-1 opacity-90 z-50"
      )}
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-1">
        {product.imageUrl && !imageLoadErrors.has(product.id) ? (
          <img src={product.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <Package className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 pr-8 text-left">
        <p className="line-clamp-2 text-sm font-semibold text-foreground">{product.name}</p>
        <p className="text-sm font-medium text-muted-foreground">{product.price}</p>
      </div>
      <span
        className="absolute right-2 top-2 rounded-full bg-muted p-1 text-muted-foreground"
        aria-hidden
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    </div>
  );
}

interface SortableMyPickRowProps {
  product: ExploreProduct;
  variant?: PickVariant | null;
  section: string;
  onChangeSection: (trigger: HTMLElement) => void;
  flash: boolean;
  inChecklist: boolean;
  imageLoadErrors: Set<string>;
  setImageLoadErrors: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenDetail: () => void;
  onRemove: () => void;
}

function SortableMyPickRow({
  product,
  variant,
  section,
  onChangeSection,
  flash,
  inChecklist,
  imageLoadErrors,
  setImageLoadErrors,
  onOpenDetail,
  onRemove,
}: SortableMyPickRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.name,
    transition: MY_PICKS_SORTABLE_TRANSITION,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <div
        className={cn(
          "group/card relative flex flex-col gap-2 rounded-xl border bg-muted p-3 transition-all duration-200 hover:bg-accent hover:shadow-raised",
          inChecklist ? "border-border opacity-60" : "border-border",
          flash && "bg-muted"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            {...attributes}
            {...listeners}
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetail()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenDetail();
              }
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 outline-none"
          >
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-1">
              {(variant?.imageUrl ?? product.imageUrl) && !imageLoadErrors.has(product.id) ? (
                <img
                  src={variant?.imageUrl ?? product.imageUrl ?? undefined}
                  alt={product.name}
                  loading="lazy"
                  className="h-full w-full object-contain"
                  onError={() =>
                    setImageLoadErrors((prev) => {
                      const next = new Set(prev);
                      next.add(product.id);
                      return next;
                    })
                  }
                />
              ) : (
                <Package className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
              )}
              {inChecklist ? (
                <span
                  className="absolute bottom-0.5 right-0.5 rounded-full bg-foreground p-0.5 text-background shadow-raised ring-2 ring-white"
                  aria-hidden
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="line-clamp-2 text-sm font-semibold text-foreground">{product.name}</p>
              {variant?.label ? (
                <span className="mt-0.5 inline-block max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {variant.label}
                </span>
              ) : null}
              <p className="text-sm font-medium text-muted-foreground">{product.price}</p>
            </div>
          </div>
          <Button
            type="button"
            aria-label={`Remove ${product.name} from picks`}
            className="absolute right-2 top-2 shrink-0 rounded-full bg-muted p-1 text-muted-foreground transition-colors hover:text-red-500"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            variant="ghost"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Button>
        </div>
        {/* One control per row: the destination section. Sending is the panel's single
            filled primary at the bottom, so the row carries no competing green button. */}
        <Button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onChangeSection(e.currentTarget);
          }}
          className="inline-flex min-w-0 max-w-fit items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-haspopup="listbox"
          aria-label={`Change checklist section for ${product.name}, currently ${section}`}
          variant="ghost"
        >
          <span className="truncate">{section}</span>
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** A pick already sent to the checklist - shown read-only in the "Added to checklist" archive
 *  with its saved date and a control to pull it back onto the live picks list. */
function ArchivedPickRow({
  product,
  variant,
  addedAt,
  imageLoadErrors,
  setImageLoadErrors,
  onOpenDetail,
  onRemoveFromChecklist,
}: {
  product: ExploreProduct;
  variant?: PickVariant | null;
  addedAt: string | null;
  imageLoadErrors: Set<string>;
  setImageLoadErrors: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpenDetail: () => void;
  onRemoveFromChecklist: () => void;
}) {
  const dateLabel = addedAt
    ? new Date(addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  return (
    <li className="list-none">
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 p-2.5">
        <Button
          type="button"
          onClick={onOpenDetail}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
          variant="ghost"
        >
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-1">
            {(variant?.imageUrl ?? product.imageUrl) && !imageLoadErrors.has(product.id) ? (
              <img
                src={variant?.imageUrl ?? product.imageUrl ?? undefined}
                alt={product.name}
                loading="lazy"
                className="h-full w-full object-contain"
                onError={() =>
                  setImageLoadErrors((prev) => {
                    const next = new Set(prev);
                    next.add(product.id);
                    return next;
                  })
                }
              />
            ) : (
              <Package className="h-5 w-5 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
            )}
            <span
              className="absolute bottom-0.5 right-0.5 rounded-full bg-foreground p-0.5 text-background shadow-raised ring-2 ring-white"
              aria-hidden
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-1 text-sm font-medium text-foreground">{product.name}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{product.price}</span>
              {dateLabel ? <span> {"·"} Added {dateLabel}</span> : null}
            </p>
          </div>
        </Button>
        <Button
          type="button"
          onClick={onRemoveFromChecklist}
          className="shrink-0 rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Remove ${product.name} from checklist`}
          variant="ghost"
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

/**
 * Wraps the My Picks panel. On desktop it is the sticky right-rail <aside>; on
 * mobile (native iOS/Android + responsive web <768px) it is a bottom-sheet Drawer
 * opened by the floating "My Picks" button, so picks are reachable without scrolling
 * past the whole product grid. The children render once (only inside the active
 * branch), so the panel's DnD context is never double-mounted.
 */
function MyPicksContainer({
  isMobile,
  open,
  onOpenChange,
  title,
  children,
}: {
  isMobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isMobile) {
    return (
      <aside className="w-full shrink-0 self-start xl:sticky xl:top-28 xl:w-[380px]">{children}</aside>
    );
  }
  return (
    // Desktop renders the persistent <aside> above; this overlay is mobile-only.
    // mobileVariant="drawer" keeps the exact vaul Drawer (swipe-dismiss, bg-scale).
    <AdaptiveOverlay open={open} onOpenChange={onOpenChange} mobileVariant="drawer">
      <AdaptiveOverlayContent
        priority
        hideDefaultHandle
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-auto max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl"
      >
        {/* The handle sits directly on the panel's own header background, so there is no
            white band between the sheet edge and the "My Picks" header. */}
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/40" />
        <AdaptiveOverlayTitle className="sr-only">{title}</AdaptiveOverlayTitle>
        {children}
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}

export interface ChecklistExploreTabProps {
  addItem: (
    category: string,
    itemName: string,
    link?: string | null,
    iconName?: string | null,
    isChecked?: boolean,
    extras?: {
      estimated_price?: number;
      needs_purchase?: boolean;
      image_url?: string | null;
      variant_label?: string | null;
      insertGroupId?: string | null;
    }
  ) => Promise<boolean>;
  /** Current checklist section names for the active list (personal or selected group). */
  existingSections: string[];
  /** Active list from the page switcher: `null` = personal, else group id. */
  activeListGroupId: string | null;
  /** Display name for the active list (e.g. "Personal List" / group name) - shown on the My Picks destination dropdown. */
  activeListDisplayName: string;
  /** All checklist groups the user can switch between (personal is implicit). Populates the My Picks destination-list dropdown. */
  allGroups: ChecklistTopBarGroup[];
  /** Switch the active/destination list the picks send into (`null` = personal). */
  onSelectList: (groupId: string | null) => void;
  /** Trimmed `item` values on the active checklist - add dedupe, counts, "All Items Added". */
  checklistItemNamesForAdd: ReadonlySet<string>;
  /** Normalized keys (trim + lower) across active + paired other list - "In Checklist" UI. */
  checklistItemNamesForDisplay: ReadonlySet<string>;
  /** Lifted from parent - synced with `explore_picks` for this user. */
  exploreSavedNames: Set<string>;
  setExploreSavedNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** True when the active checklist has rows from Shop (image + Amazon affiliate link). */
  hasShopEssentialsItems: boolean;
  /** Count of Shop rows on the checklist - shown in the clear-confirm dialog. */
  shopEssentialsCount: number;
  /** Removes all Shop rows and returns them for Undo (`skipConfirm` = caller confirmed). */
  clearShopEssentialsItems: (opts?: { skipConfirm?: boolean }) => Promise<ChecklistItem[] | null>;
  /** Re-inserts rows removed by `clearShopEssentialsItems` (Undo). */
  restoreChecklistItems: (rows: ChecklistItem[]) => Promise<void>;
  /** Checklist Est. total (sum of estimated_price) - the budget number My Picks reconciles against. */
  checklistEstimatedTotal: number;
  /** Active checklist rows - used to remove essentials by name on the active list. */
  activeChecklistItems: ReadonlyArray<{ id: string; item: string; category: string }>;
  deleteItem: (id: string) => void | Promise<void>;
  /** Opens the "Share with roommates" collaborate flow (rendered by the parent). */
  onShareWithRoommates?: () => void;
}

export function ChecklistExploreTab({
  addItem,
  onShareWithRoommates,
  existingSections,
  checklistItemNamesForAdd,
  checklistItemNamesForDisplay,
  exploreSavedNames: savedNames,
  setExploreSavedNames: setSavedNames,
  activeListGroupId,
  activeListDisplayName,
  allGroups,
  onSelectList,
  hasShopEssentialsItems,
  shopEssentialsCount,
  clearShopEssentialsItems,
  restoreChecklistItems,
  checklistEstimatedTotal,
  activeChecklistItems,
  deleteItem,
}: ChecklistExploreTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const modalOverlay = useModalOverlay();
  // The bottom-nav four-squares menu is open: the My Picks FAB ducks under it.
  const actionMenuOpen = modalOverlay?.actionMenuOpen ?? false;
  const queryClient = useQueryClient();
  // Variant a user chose (in the detail modal) for each saved pick, so My Picks and the
  // checklist show the exact SKU (e.g. the Pink hub) instead of the default photo.
  const { data: pickVariants } = useExplorePickVariants(user?.id);
  // Saved-on timestamps (explore_picks.created_at) power the "Added to checklist" archive dates.
  const { data: pickCreatedAt } = useExplorePickCreatedAt(user?.id);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [sort, setSort] = useState<SortMode>("trending");
  const [filtersPopoverOpen, setFiltersPopoverOpen] = useState(false);
  const [showLikedOnly, setShowLikedOnly] = useState(false);

  useEffect(() => {
    if (savedNames.size === 0) setShowLikedOnly(false);
  }, [savedNames.size]);

  const registerHeartClickOverride = useHousingSaved()?.registerHeartClickOverride;
  const setHeartOverrideActive = useHousingSaved()?.setHeartOverrideActive;
  const setSavedCount = useHousingSaved()?.setSavedCount;

  useEffect(() => {
    registerHeartClickOverride?.(() => setShowLikedOnly((v) => !v));
    return () => {
      registerHeartClickOverride?.(null);
      setHeartOverrideActive?.(false);
      setSavedCount?.(null);
    };
  }, [registerHeartClickOverride, setHeartOverrideActive, setSavedCount]);

  useEffect(() => {
    setHeartOverrideActive?.(showLikedOnly);
  }, [showLikedOnly, setHeartOverrideActive]);

  useEffect(() => {
    setSavedCount?.(savedNames.size);
  }, [savedNames.size, setSavedCount]);

  /** `null` = use full catalog max (no stricter cap). */
  const [userMinPrice, setUserMinPrice] = useState<number | null>(null);
  const [userMaxPrice, setUserMaxPrice] = useState<number | null>(null);
  const [minRating, setMinRating] = useState<number>(0);
  const [sidebarFlashNames, setSidebarFlashNames] = useState<Set<string>>(() => new Set());
  const [gridHighlightName] = useState<string | null>(null);

  // Per-product section overrides for the "Wrong section?" chip. Keyed by trimmed
  // product name; every add path resolves through `resolveSectionFor` (defined below).
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, string>>({});
  // Inline override menu, anchored to whichever destination chip was clicked (card or pick row).
  const [overrideMenuFor, setOverrideMenuFor] = useState<string | null>(null);
  const [overrideMenuRect, setOverrideMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [overrideCreating, setOverrideCreating] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState("");
  const overrideTriggerElRef = useRef<HTMLElement | null>(null);
  const overrideMenuPanelRef = useRef<HTMLDivElement>(null);

  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(() => new Set());
  const [selectedProduct, setSelectedProduct] = useState<ExploreProduct | null>(null);
  const [clearShopDialogOpen, setClearShopDialogOpen] = useState(false);
  // Product awaiting "may be banned at Pitt" confirmation before it's added.
  const [bannedConfirmProduct, setBannedConfirmProduct] = useState<ExploreProduct | null>(null);
  const [pickOrderNames, setPickOrderNames] = useState<string[]>([]);
  const [activePickDragId, setActivePickDragId] = useState<string | null>(null);
  // "Added to checklist" archive is collapsed by default; the live picks cart leads.
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Mobile only: open state for the My Picks bottom-sheet (opened by the FAB).
  const [picksSheetOpen, setPicksSheetOpen] = useState(false);

  const myPicksSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleMyPicksDragStart = useCallback((event: DragStartEvent) => {
    setActivePickDragId(String(event.active.id));
  }, []);

  const handleMyPicksDragCancel = useCallback(() => {
    setActivePickDragId(null);
  }, []);

  // `data ?? []` must be memoized: a bare `= []` default mints a fresh array on
  // every render while the query is loading, which busts every `[products]` memo
  // below (savedList, priceSliderMax, filteredSorted…) each render. Combined with
  // the picks-sync effect re-emitting a new array, that produced an infinite
  // render loop ("Maximum update depth exceeded"). Keep the reference stable.
  const { data: productsData, isLoading } = useAmazonProducts();
  const products = useMemo(() => productsData ?? [], [productsData]);

  const productByName = useMemo(
    () => new Map(products.map((p) => [p.name.trim(), p])),
    [products]
  );

  // Badge honesty: only the genuinely top-3 trending items (by saves, then
  // review count) get the "Trending" badge - not every row the DB flags.
  const trendingTopNames = useMemo(() => {
    const top = products
      .filter((p) => p.trending)
      .sort((a, b) => (b.hearts ?? 0) - (a.hearts ?? 0) || (b.reviews ?? 0) - (a.reviews ?? 0))
      .slice(0, 3);
    return new Set(top.map((p) => p.name));
  }, [products]);

  /** Product name -> matching Pitt banned-list advisory (null when clean). */
  const bannedAdvisoryByName = useMemo(
    () => new Map(products.map((p) => [p.name, findBannedAdvisory(p.name)])),
    [products]
  );

  /** Single source of truth for a product's checklist destination: manual override, else the auto-categorizer. */
  const resolveSectionFor = useCallback(
    (p: Pick<ExploreProduct, "name" | "category">) =>
      sectionOverrides[p.name.trim()] ?? resolveChecklistSection(p, existingSections),
    [sectionOverrides, existingSections]
  );

  const handleMyPicksDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActivePickDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      // My Picks is grouped by destination section; reorder is scoped WITHIN a section.
      // Ignore cross-section drops rather than build full cross-section DnD.
      const activeProduct = productByName.get(String(active.id).trim());
      const overProduct = productByName.get(String(over.id).trim());
      if (
        activeProduct &&
        overProduct &&
        resolveSectionFor(activeProduct) !== resolveSectionFor(overProduct)
      ) {
        return;
      }
      setPickOrderNames((items) => {
        const oldIndex = items.indexOf(String(active.id));
        const newIndex = items.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) return items;
        return arrayMove(items, oldIndex, newIndex);
      });
    },
    [productByName, resolveSectionFor]
  );

  const priceSliderMax = useMemo(() => {
    const raw = products.reduce((acc, p) => Math.max(acc, Number(p.priceValue) || 0), 0);
    return roundExplorePriceSliderMax(raw);
  }, [products]);

  useEffect(() => {
    setUserMaxPrice((prev) => {
      if (prev == null) return null;
      return prev > priceSliderMax ? priceSliderMax : prev;
    });
  }, [priceSliderMax]);

  const closeOverrideMenu = useCallback(() => {
    setOverrideMenuFor(null);
    setOverrideCreating(false);
    setOverrideDraft("");
    overrideTriggerElRef.current = null;
  }, []);

  const openOverrideMenu = useCallback(
    (productName: string, trigger: HTMLElement) => {
      const key = productName.trim();
      if (overrideMenuFor === key) {
        closeOverrideMenu();
        return;
      }
      overrideTriggerElRef.current = trigger;
      const r = trigger.getBoundingClientRect();
      setOverrideMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
      setOverrideCreating(false);
      setOverrideDraft("");
      setOverrideMenuFor(key);
    },
    [overrideMenuFor, closeOverrideMenu]
  );

  const applyOverride = useCallback(
    (productName: string, section: string) => {
      const key = productName.trim();
      const value = section.trim();
      if (!value) return;
      setSectionOverrides((prev) => ({ ...prev, [key]: value }));
      closeOverrideMenu();
    },
    [closeOverrideMenu]
  );

  useLayoutEffect(() => {
    if (!overrideMenuFor) return;
    const measure = () => {
      const el = overrideTriggerElRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOverrideMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [overrideMenuFor]);

  useEffect(() => {
    if (!overrideMenuFor) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (overrideTriggerElRef.current?.contains(t)) return;
      if (overrideMenuPanelRef.current?.contains(t)) return;
      closeOverrideMenu();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [overrideMenuFor, closeOverrideMenu]);

  const overrideMenuStyle = useMemo(() => {
    if (!overrideMenuRect) return null;
    const w = Math.max(overrideMenuRect.width, 200);
    const vw = typeof window !== "undefined" ? window.innerWidth : overrideMenuRect.left + w;
    const vh = typeof window !== "undefined" ? window.innerHeight : 400;
    const left = Math.min(overrideMenuRect.left, Math.max(8, vw - w - 8));
    const maxH = Math.max(120, Math.min(240, vh - overrideMenuRect.top - 8));
    return {
      top: overrideMenuRect.top,
      left,
      width: w,
      maxHeight: maxH,
    };
  }, [overrideMenuRect]);

  const prevSavedRef = useRef<Set<string>>(new Set());
  const gridHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevSavedRef.current;
    const added: string[] = [];
    for (const name of savedNames) {
      if (!prev.has(name)) added.push(name);
    }
    const changed = added.length > 0 || prev.size !== savedNames.size;
    prevSavedRef.current = new Set(savedNames);
    // A save/remove may have written variant_* to explore_picks; refresh the variant map.
    if (changed) {
      void queryClient.invalidateQueries({ queryKey: [EXPLORE_PICK_VARIANTS_QUERY_KEY] });
      void queryClient.invalidateQueries({ queryKey: [EXPLORE_PICK_CREATED_AT_QUERY_KEY] });
    }
    if (added.length === 0) return;
    setSidebarFlashNames((s) => {
      const next = new Set(s);
      added.forEach((n) => next.add(n));
      return next;
    });
    const t = window.setTimeout(() => {
      setSidebarFlashNames((s) => {
        const next = new Set(s);
        added.forEach((n) => next.delete(n));
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [savedNames, queryClient]);

  useEffect(() => {
    return () => {
      if (gridHighlightTimeoutRef.current) clearTimeout(gridHighlightTimeoutRef.current);
    };
  }, []);

  const filteredSorted = useMemo(() => {
    const effectivePriceMin = userMinPrice ?? 0;
    const effectivePriceMax = userMaxPrice ?? priceSliderMax;
    const list = products.filter((p) => {
      if (filterCategory !== "All" && p.category !== filterCategory) return false;
      if (showLikedOnly && !savedNames.has(p.name)) return false;
      if (Number(p.priceValue) > effectivePriceMax + 1e-6) return false;
      if (Number(p.priceValue) < effectivePriceMin - 1e-6) return false;
      if (minRating > 0 && (p.rating ?? 0) < minRating) return false;
      const q = search.trim().toLowerCase();
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const copy = [...list];
    if (sort === "trending") {
      copy.sort((a, b) => {
        if (a.trending !== b.trending) return a.trending ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === "price-asc") {
      copy.sort((a, b) => a.priceValue - b.priceValue);
    } else if (sort === "price-desc") {
      copy.sort((a, b) => b.priceValue - a.priceValue);
    } else if (sort === "hearts-desc") {
      copy.sort((a, b) => {
        const hb = b.hearts ?? 0;
        const ha = a.hearts ?? 0;
        if (hb !== ha) return hb - ha;
        return a.name.localeCompare(b.name);
      });
    } else {
      copy.sort((a, b) => b.rating - a.rating);
    }
    return copy;
  }, [
    filterCategory,
    priceSliderMax,
    products,
    savedNames,
    search,
    showLikedOnly,
    sort,
    userMaxPrice,
    userMinPrice,
    minRating,
  ]);

  const priceFilterActive =
    (userMaxPrice != null && userMaxPrice < priceSliderMax - 0.5) ||
    (userMinPrice != null && userMinPrice > 0.5);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (search.trim()) n += 1;
    if (filterCategory !== "All") n += 1;
    if (sort !== "trending") n += 1;
    if (showLikedOnly) n += 1;
    if (priceFilterActive) n += 1;
    if (minRating > 0) n += 1;
    return n;
  }, [
    filterCategory,
    priceFilterActive,
    search,
    showLikedOnly,
    sort,
    minRating,
  ]);

  const sortChipLabel = useMemo(() => {
    const o = EXPLORE_SORT_OPTIONS.find((x) => x.value === sort);
    return o ? t(o.labelKey) : sort;
  }, [sort, t]);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setFilterCategory("All");
    setSort("trending");
    setShowLikedOnly(false);
    setUserMinPrice(null);
    setUserMaxPrice(null);
    setMinRating(0);
  }, []);

  const filterChips = useMemo(() => {
    type Chip = { id: string; label: string; onRemove: () => void };
    const chips: Chip[] = [];
    const q = search.trim();
    if (q) {
      const display = q.length > 28 ? `${q.slice(0, 26)}…` : q;
      chips.push({
        id: "search",
        label: display,
        onRemove: () => setSearch(""),
      });
    }
    if (filterCategory !== "All") {
      chips.push({
        id: "category",
        label: filterCategory,
        onRemove: () => setFilterCategory("All"),
      });
    }
    if (sort !== "trending") {
      chips.push({
        id: "sort",
        label: sortChipLabel,
        onRemove: () => setSort("trending"),
      });
    }
    if (showLikedOnly) {
      chips.push({
        id: "liked",
        label: "Liked only",
        onRemove: () => setShowLikedOnly(false),
      });
    }
    if (priceFilterActive) {
      const lo = Math.round(userMinPrice ?? 0);
      const hi = userMaxPrice != null ? Math.round(userMaxPrice) : priceSliderMax;
      chips.push({
        id: "price",
        label:
          userMinPrice != null && userMinPrice > 0.5
            ? `$${lo.toLocaleString("en-US")}–$${hi.toLocaleString("en-US")}`
            : `Under $${hi.toLocaleString("en-US")}`,
        onRemove: () => {
          setUserMinPrice(null);
          setUserMaxPrice(null);
        },
      });
    }
    if (minRating > 0) {
      chips.push({
        id: "rating",
        label: `${minRating.toFixed(1)}★ & up`,
        onRemove: () => setMinRating(0),
      });
    }
    return chips;
  }, [
    filterCategory,
    minRating,
    priceFilterActive,
    priceSliderMax,
    search,
    showLikedOnly,
    sort,
    sortChipLabel,
    userMaxPrice,
    userMinPrice,
  ]);

  const sliderPriceValue = userMaxPrice ?? priceSliderMax;

  const savedList = useMemo(() => products.filter((p) => savedNames.has(p.name)), [products, savedNames]);

  useEffect(() => {
    setPickOrderNames((prev) => {
      const present = new Set(savedList.map((p) => p.name));
      const kept = prev.filter((name) => present.has(name));
      const additions = savedList.map((p) => p.name).filter((name) => !kept.includes(name));
      const next = [...kept, ...additions];
      // Preserve the previous reference when nothing actually changed - returning a
      // fresh array every run would re-trigger downstream effects and (with an
      // unstable `savedList`) loop. React bails out of the update on referential eq.
      if (next.length === prev.length && next.every((n, i) => n === prev[i])) return prev;
      return next;
    });
  }, [savedList]);

  const orderedSavedList = useMemo(() => {
    if (pickOrderNames.length === 0) return savedList;
    const byName = new Map(savedList.map((p) => [p.name, p]));
    return pickOrderNames.map((name) => byName.get(name)).filter(Boolean) as ExploreProduct[];
  }, [pickOrderNames, savedList]);

  // Picks split into the live cart (not yet on the checklist) and the "Added to checklist"
  // archive (already sent). The partition is derived, so sending / un-sending an item just
  // moves it between the two lists.
  const activePicks = useMemo(
    () => orderedSavedList.filter((p) => !checklistItemNamesForAdd.has(p.name.trim())),
    [orderedSavedList, checklistItemNamesForAdd]
  );
  const archivedPicks = useMemo(
    () => orderedSavedList.filter((p) => checklistItemNamesForAdd.has(p.name.trim())),
    [orderedSavedList, checklistItemNamesForAdd]
  );
  const activePicksTotal = useMemo(
    () => activePicks.reduce((sum, p) => sum + (Number(p.priceValue) || 0), 0),
    [activePicks]
  );

  const picksNotYetAddedCount = useMemo(
    () => orderedSavedList.filter((p) => !checklistItemNamesForAdd.has(p.name.trim())).length,
    [orderedSavedList, checklistItemNamesForAdd]
  );

  /** Active (not-yet-sent) picks bucketed by resolved destination section, ordered like the checklist. */
  const groupedPicks = useMemo(() => {
    const buckets = new Map<string, ExploreProduct[]>();
    for (const p of activePicks) {
      const section = resolveSectionFor(p);
      const arr = buckets.get(section);
      if (arr) arr.push(p);
      else buckets.set(section, [p]);
    }
    return orderSections(Array.from(buckets.keys()), existingSections).map((section) => ({
      section,
      items: buckets.get(section)!,
    }));
  }, [activePicks, resolveSectionFor, existingSections]);

  const hasPicksAlreadyInChecklist = useMemo(
    () => savedList.some((p) => checklistItemNamesForAdd.has(p.name.trim())),
    [savedList, checklistItemNamesForAdd]
  );

  const activePickDragProduct = useMemo(() => {
    if (!activePickDragId) return null;
    return orderedSavedList.find((p) => p.name === activePickDragId) ?? null;
  }, [activePickDragId, orderedSavedList]);

  const allPicksAddedToChecklist = savedList.length > 0 && picksNotYetAddedCount === 0;

  const updateProductHeartsInCache = useCallback((productId: string, delta: number) => {
    queryClient.setQueryData<ExploreProduct[]>(AMAZON_PRODUCTS_QUERY_KEY, (prev) =>
      (prev ?? []).map((p) =>
        p.id === productId
          ? {
              ...p,
              hearts: Math.max((p.hearts ?? 0) + delta, 0),
            }
          : p
      )
    );
  }, [queryClient]);

  const toggleSaved = async (product: ExploreProduct) => {
    const isSaved = savedNames.has(product.name);

    setSavedNames((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(product.name);
      else next.add(product.name);
      return next;
    });
    if (user?.id) {
      updateProductHeartsInCache(product.id, isSaved ? -1 : 1);
    }
    if (!user?.id) return;
    if (isSaved) {
      const { error } = await supabase
        .from("explore_picks")
        .delete()
        .eq("user_id", user.id)
        .eq("product_name", product.name);
      if (error) {
        setSavedNames((prev) => {
          const next = new Set(prev);
          next.add(product.name);
          return next;
        });
        updateProductHeartsInCache(product.id, 1);
        toast.error("Could not remove pick", { description: error.message });
        return;
      }
    } else {
      // upsert (ignore duplicates) so re-saving an already-saved pick is a no-op
      // instead of a unique-constraint (explore_picks_pkey) error.
      const { error } = await supabase.from("explore_picks").upsert(
        {
          user_id: user.id,
          product_name: product.name,
        },
        { onConflict: "user_id,product_name", ignoreDuplicates: true },
      );
      if (error) {
        setSavedNames((prev) => {
          const next = new Set(prev);
          next.delete(product.name);
          return next;
        });
        updateProductHeartsInCache(product.id, -1);
        toast.error("Could not save pick", { description: error.message });
        return;
      }
    }
  };

  const clearAddedFromPicks = useCallback(async () => {
    if (!user?.id) return;
    const productsToRemove = savedList.filter((p) => checklistItemNamesForAdd.has(p.name.trim()));
    const namesToRemove = productsToRemove.map((p) => p.name);
    if (namesToRemove.length === 0) return;
    let prevSaved: Set<string> | null = null;
    setSavedNames((prev) => {
      prevSaved = new Set(prev);
      const next = new Set(prev);
      namesToRemove.forEach((n) => next.delete(n));
      return next;
    });
    const { error } = await supabase
      .from("explore_picks")
      .delete()
      .eq("user_id", user.id)
      .in("product_name", namesToRemove);
    if (error) {
      if (prevSaved) setSavedNames(prevSaved);
      toast.error("Could not clear picks", { description: error.message });
      return;
    }
    for (const p of productsToRemove) {
      updateProductHeartsInCache(p.id, -1);
    }
    const n = namesToRemove.length;
    toast(t("checklist:explore.clearedFromMyPicks", { count: n }));
  }, [user?.id, savedList, checklistItemNamesForAdd, updateProductHeartsInCache]);

  const clearAllPicks = useCallback(async () => {
    if (!user?.id) return;
    if (!window.confirm("Remove all items from My Picks?")) return;
    const snapshot = orderedSavedList.slice();
    let prevSaved: Set<string> | null = null;
    setSavedNames((prev) => {
      prevSaved = new Set(prev);
      return new Set();
    });
    const { error } = await supabase.from("explore_picks").delete().eq("user_id", user.id);
    if (error) {
      if (prevSaved) setSavedNames(prevSaved);
      toast.error("Could not clear picks", { description: error.message });
      return;
    }
    for (const p of snapshot) {
      updateProductHeartsInCache(p.id, -1);
    }
    toast(t("checklist:explore.clearedAllItems"));
  }, [user?.id, orderedSavedList, updateProductHeartsInCache]);

  const performAddToChecklist = useCallback(
    async (
      product: ExploreProduct,
      sectionName: string,
      batchTracker?: Set<string>
    ): Promise<boolean> => {
      const section = sectionName.trim();
      if (!section) return false;
      const nameKey = product.name.trim();
      if (batchTracker) {
        if (batchTracker.has(nameKey)) return false;
      } else if (checklistItemNamesForAdd.has(nameKey)) {
        return false;
      }
      const priceNum = product.priceValue;
      // Carry the chosen variant (image + link + label) onto the checklist item so it
      // shows the exact SKU the user picked, not the default photo.
      const variant = pickVariants?.get(product.name);
      const rawLink = variant?.affiliateLink ?? product.affiliateLink ?? "";
      const ok = await addItem(section, product.name, buildAffiliateUrl(rawLink, product.provider), null, false, {
        estimated_price: priceNum > 0 ? priceNum : undefined,
        needs_purchase: true,
        image_url: variant?.imageUrl ?? product.imageUrl ?? undefined,
        variant_label: variant?.label ?? undefined,
        insertGroupId: activeListGroupId,
      });
      if (!ok) return false;
      batchTracker?.add(nameKey);
      return true;
    },
    [activeListGroupId, addItem, checklistItemNamesForAdd, pickVariants]
  );

  const fireAddAllToast = useCallback(
    (total: number, breakdown: string) => {
      if (total <= 0) return;
      toast.success(t("checklist:explore.addedItemsToChecklist", { count: total }), {
        description: breakdown || undefined,
        action: {
          label: t("checklist:explore.viewChecklist"),
          onClick: () => navigate("/checklist?tab=checklist"),
        },
      });
    },
    [navigate]
  );

  const removeEssentialFromActiveList = useCallback(
    async (productName: string, section?: string): Promise<boolean> => {
      const trimmed = productName.trim();
      if (!trimmed) return false;
      const match = activeChecklistItems.find((row) => {
        if (row.item.trim() !== trimmed) return false;
        if (section != null && row.category !== section) return false;
        return true;
      });
      if (!match) return false;
      await deleteItem(match.id);
      return true;
    },
    [activeChecklistItems, deleteItem]
  );

  /** Add + confirmation toast that names the destination (My Checklist · section). */
  const addEssentialConfirmed = useCallback(
    async (product: ExploreProduct) => {
      const section = resolveSectionFor(product);
      const ok = await performAddToChecklist(product, section);
      if (!ok) return;

      toast.success(t("checklist:explore.addedToMyChecklist", { section }), {
        description: t("checklist:explore.countedInTotal"),
        action: {
          label: t("checklist:actions.view"),
          onClick: () => navigate("/checklist?tab=checklist"),
        },
      });
    },
    [resolveSectionFor, performAddToChecklist, navigate]
  );

  /** Pull a pick back off the checklist (archive -> active My Picks). */
  const removePickFromChecklist = useCallback(
    async (product: ExploreProduct) => {
      const removed = await removeEssentialFromActiveList(product.name);
      if (removed) toast(t("checklist:explore.removedFromChecklist"));
    },
    [removeEssentialFromActiveList, t]
  );

  /** Confirmed bulk clear (dialog already accepted) with a 10s Undo toast. */
  const handleClearShopItems = useCallback(async () => {
    const removed = await clearShopEssentialsItems({ skipConfirm: true });
    if (!removed || removed.length === 0) return;
    toast(t("checklist:explore.removedShopItems", { count: removed.length }), {
      duration: 10000,
      action: {
        label: t("checklist:actions.undo"),
        onClick: () => void restoreChecklistItems(removed),
      },
    });
  }, [clearShopEssentialsItems, restoreChecklistItems, t]);

  // Each pick routes to its OWN auto-resolved section (or its manual override) - no single-section dump.
  const handleAddAllToChecklist = async () => {
    const batchTracker = new Set<string>();
    for (const p of orderedSavedList) {
      const nk = p.name.trim();
      if (checklistItemNamesForAdd.has(nk)) batchTracker.add(nk);
    }
    const toAdd = orderedSavedList.filter((p) => !batchTracker.has(p.name.trim()));
    if (toAdd.length === 0) return;
    const perSection = new Map<string, number>();
    let total = 0;
    for (const p of toAdd) {
      const section = resolveSectionFor(p);
      const ok = await performAddToChecklist(p, section, batchTracker);
      if (ok) {
        perSection.set(section, (perSection.get(section) ?? 0) + 1);
        total += 1;
      }
    }
    const breakdown = orderSections(Array.from(perSection.keys()), existingSections)
      .map((s) => `${s} (${perSection.get(s)})`)
      .join(", ");
    fireAddAllToast(total, breakdown);
  };

  return (
    <div className="mx-auto mt-4 w-full max-w-2xl max-md:mt-3 xl:max-w-[1600px]">
      {/* Layout: single centered mobile-width column up through lg, then a two-column
          desktop layout (product grid + a sticky My Picks rail) at xl and above.
          The gate is xl:, NOT lg:, on purpose: Tailwind breakpoints are viewport-based, but
          the app's ~220px desktop nav sidebar eats content width the query can't see. At lg
          (1024px) that left only ~800px of content, so two columns read as thin product strips
          next to a floating cart. xl (1280px) leaves ~1060px of real content width - enough for
          a 3-up product grid beside a 380px picks rail - and we lift the cap to max-w-[1600px]
          there (the page wrapper's own lg:px-12 keeps edge breathing room) so the columns fill the
          desktop width instead of staying pinned at max-w-2xl with big side gaps. */}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-8">
        <div className="min-w-0 flex-1 space-y-4 max-md:space-y-3">
          {/* Sticky search + share + filters. Uses bg-background (the page's own off-white) rather
              than true-white bg-card so the pinned band is invisible against the page - no seam line
              at its edges and no white strip flashing as off-white card gaps scroll under it. Still
              opaque, so product cards, chips, and the disclaimer are cleanly hidden as they pass
              beneath. The lg:before strip extends that same background straight up to the top of the
              viewport so nothing peeks above the pinned bar on desktop. Pins at lg:top-28 (112px),
              which sits at (>=) the offset where this row naturally lands below the page header
              (~108px), so it (and the My Picks aside, which shares the same lg:top-28) is held exactly
              at its landing spot with zero upward travel on scroll - instead of jumping up ~40px from
              where it lands to a shallower pin. The -mx-2.5/px-2.5
              overhang widens the opaque band ~10px past the product column on each side (content
              stays aligned) so the edge product cards' corner borders are fully covered as they
              scroll under it - otherwise a faint 1px hairline pokes up the left/right edges. */}
          <div className="sticky top-0 z-20 -mx-2.5 bg-background px-2.5 py-2 lg:top-28 lg:before:absolute lg:before:inset-x-0 lg:before:bottom-full lg:before:h-28 lg:before:bg-background lg:before:content-['']">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <Input
              type="search"
              // P8.3: "/" focuses this, the scoped search for Explore essentials.
              {...{ [PAGE_SEARCH_ATTR]: '' }}
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                "h-11 w-full rounded-full border-border bg-card text-sm shadow-raised",
                isMobile && "pr-12",
              )}
            />
            {/* Mobile: Filters live inside the search bar (one control surface);
                desktop keeps the labelled pill beside it. */}
            {isMobile && (
              <Button
                type="button"
                aria-label={
                  activeFilterCount > 0
                    ? t("checklist:explore.filters", { count: activeFilterCount })
                    : t("checklist:explore.filtersLabel")
                }
                onClick={() => setFiltersPopoverOpen((prev) => !prev)}
                className={cn(
                  "absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
                  activeFilterCount > 0
                    // Green tint, matching the Added/Saved state elsewhere in this file —
                    // the old bg-foreground/text-background inverted the hierarchy, reading
                    // as a heavier action than the primary green ones around it.
                    ? "border border-malachite-200 bg-malachite-50 text-malachite-800 dark:border-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                variant="ghost"
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              </Button>
            )}
          </div>
          {onShareWithRoommates ? (
            <Button
              type="button"
              onClick={onShareWithRoommates}
              aria-label={t("checklist:page.shareWithRoommates")}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              variant="ghost"
            >
              <Users2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <span className="hidden sm:inline">{t("checklist:explore.share")}</span>
            </Button>
          ) : null}
          {isMobile ? (
            // Desktop renders the anchored <Popover> below; this is mobile-only.
            <AdaptiveOverlay
              open={filtersPopoverOpen}
              onOpenChange={setFiltersPopoverOpen}
              mobileVariant="drawer"
              shouldScaleBackground={false}
            >
              <AdaptiveOverlayContent
                priority
                hideDefaultHandle
                // Don't pull focus into the sheet on open - on iOS that makes the
                // browser scroll the background up to reveal the focused element.
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="flex h-auto max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl pb-0"
              >
                <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/40" />
                <div className="shrink-0 p-4 pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold">{t("checklist:explore.filtersLabel")}</span>
                    <Button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      variant="ghost"
                    >
                      {t("checklist:explore.clearAll")}
                    </Button>
                  </div>
                </div>
                <div className="overflow-y-auto overscroll-contain p-4 pt-0 max-h-[calc(85vh-8.5rem)]">
                  <div className="space-y-4">
                    <div className="grid min-w-0 grid-cols-2 gap-3">
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.sortBy")}</p>
                        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue placeholder={t("checklist:explore.sortOptions.trending")} />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPLORE_SORT_OPTIONS.map(({ value, labelKey }) => (
                              <SelectItem key={value} value={value}>
                                {t(labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.category")}</p>
                        <Select value={filterCategory} onValueChange={setFilterCategory}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue placeholder={t("checklist:explore.categories.all")} />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPLORE_FILTER_CATEGORIES_KEYS.map(({ value, labelKey }) => (
                              <SelectItem key={value} value={value}>
                                {t(labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 items-end gap-3">
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.minimumRating")}</p>
                        <Select value={String(minRating)} onValueChange={(v) => setMinRating(Number(v))}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">{t("checklist:explore.ratingAny")}</SelectItem>
                            {[3, 4, 4.5].map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                <span className="flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                                  {r.toFixed(1)}+
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3">
                        <Label htmlFor="explore-liked-only-mobile" className="cursor-pointer truncate text-sm font-medium text-foreground">
                          {t("checklist:explore.showLikedOnly")}
                        </Label>
                        <Switch
                          id="explore-liked-only-mobile"
                          checked={showLikedOnly}
                          onCheckedChange={setShowLikedOnly}
                          className="data-[state=checked]:bg-malachite-600"
                        />
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.priceRange")}</p>
                        <span className="text-xs font-medium text-foreground">
                          ${Math.round(userMinPrice ?? 0).toLocaleString("en-US")} – ${Math.round(sliderPriceValue).toLocaleString("en-US")}
                        </span>
                      </div>
                      <div className="py-2 [&_.bg-primary]:!bg-malachite-600 [&_.border-primary]:!border-malachite-600">
                        <Slider
                          min={0}
                          max={priceSliderMax}
                          step={priceSliderMax > 200 ? 10 : 5}
                          value={[userMinPrice ?? 0, sliderPriceValue]}
                          minStepsBetweenThumbs={1}
                          onValueChange={(v) => {
                            const lo = v[0] ?? 0;
                            const hi = v[1] ?? priceSliderMax;
                            setUserMinPrice(lo > 0.01 ? lo : null);
                            setUserMaxPrice(hi >= priceSliderMax - 0.01 ? null : hi);
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>$0</span>
                        <span>${priceSliderMax.toLocaleString("en-US")}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 space-y-3 border-t border-border px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button
                    type="button"
                    className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
                    onClick={() => setFiltersPopoverOpen(false)}
                  >
                    {t("checklist:explore.showResults")}
                  </Button>
                  {hasShopEssentialsItems ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setFiltersPopoverOpen(false);
                        setClearShopDialogOpen(true);
                      }}
                      className="mx-auto flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-600"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t("checklist:explore.clearShopFromChecklist")}
                    </Button>
                  ) : null}
                </div>
              </AdaptiveOverlayContent>
            </AdaptiveOverlay>
          ) : (
            <Popover open={filtersPopoverOpen} onOpenChange={setFiltersPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className="relative inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  variant="ghost"
                >
                  <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  {activeFilterCount > 0 ? t("checklist:explore.filters", { count: activeFilterCount }) : t("checklist:explore.filtersLabel")}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="flex max-h-[min(70vh,640px)] w-[380px] flex-col gap-0 overflow-hidden rounded-xl p-0"
              >
                <div className="shrink-0 p-4 pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold">{t("checklist:explore.filtersLabel")}</span>
                    <Button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      variant="ghost"
                    >
                      {t("checklist:explore.clearAll")}
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-0 scrollbar-thin">
                  <div className="space-y-4">
                    <div className="grid min-w-0 grid-cols-2 gap-3">
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.sortBy")}</p>
                        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue placeholder={t("checklist:explore.sortOptions.trending")} />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPLORE_SORT_OPTIONS.map(({ value, labelKey }) => (
                              <SelectItem key={value} value={value}>
                                {t(labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.category")}</p>
                        <Select value={filterCategory} onValueChange={setFilterCategory}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue placeholder={t("checklist:explore.categories.all")} />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPLORE_FILTER_CATEGORIES_KEYS.map(({ value, labelKey }) => (
                              <SelectItem key={value} value={value}>
                                {t(labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 items-end gap-3">
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.minimumRating")}</p>
                        <Select value={String(minRating)} onValueChange={(v) => setMinRating(Number(v))}>
                          <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">{t("checklist:explore.ratingAny")}</SelectItem>
                            {[3, 4, 4.5].map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                <span className="flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                                  {r.toFixed(1)}+
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3">
                        <Label htmlFor="explore-liked-only-desktop" className="cursor-pointer truncate text-sm font-medium text-foreground">
                          {t("checklist:explore.showLikedOnly")}
                        </Label>
                        <Switch
                          id="explore-liked-only-desktop"
                          checked={showLikedOnly}
                          onCheckedChange={setShowLikedOnly}
                          className="data-[state=checked]:bg-malachite-600"
                        />
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{t("checklist:explore.priceRange")}</p>
                        <span className="text-xs font-medium text-foreground">
                          ${Math.round(userMinPrice ?? 0).toLocaleString("en-US")} – ${Math.round(sliderPriceValue).toLocaleString("en-US")}
                        </span>
                      </div>
                      <div className="py-2 [&_.bg-primary]:!bg-malachite-600 [&_.border-primary]:!border-malachite-600">
                        <Slider
                          min={0}
                          max={priceSliderMax}
                          step={priceSliderMax > 200 ? 10 : 5}
                          value={[userMinPrice ?? 0, sliderPriceValue]}
                          minStepsBetweenThumbs={1}
                          onValueChange={(v) => {
                            const lo = v[0] ?? 0;
                            const hi = v[1] ?? priceSliderMax;
                            setUserMinPrice(lo > 0.01 ? lo : null);
                            setUserMaxPrice(hi >= priceSliderMax - 0.01 ? null : hi);
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>$0</span>
                        <span>${priceSliderMax.toLocaleString("en-US")}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 space-y-3 border-t border-border px-4 py-4">
                  <Button
                    type="button"
                    className="w-full bg-malachite-800 hover:bg-malachite-900 text-white"
                    onClick={() => setFiltersPopoverOpen(false)}
                  >
                    {t("checklist:explore.showResults")}
                  </Button>
                  {hasShopEssentialsItems ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setFiltersPopoverOpen(false);
                        setClearShopDialogOpen(true);
                      }}
                      className="mx-auto flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-600"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t("checklist:explore.clearShopFromChecklist")}
                    </Button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        </div>

        {filterChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {filterChips.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <Button
                  type="button"
                  onClick={chip.onRemove}
                  className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${chip.label} filter`}
                  variant="ghost"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </Button>
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Prices from Amazon and may change. DormCheck may earn from qualifying purchases.
        </p>

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {isLoading &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <div key={`skeleton-${idx}`} className="rounded-xl">
                    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-raised">
                      <div className="h-36 animate-pulse bg-muted" />
                      <div className="space-y-2 p-3">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                        <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  </div>
                ))}
              {!isLoading &&
                filteredSorted.map((product, productIndex) => {
                const isSaved = savedNames.has(product.name);
                const fullStars = Math.round(product.rating);
                return (
                  <motion.div
                    id={exploreProductCardId(product.name)}
                    key={product.name}
                    onClick={() => setSelectedProduct(product)}
                    variants={listItemVariants}
                    initial="hidden"
                    animate="visible"
                    custom={productIndex}
                    className={cn(
                      "cursor-pointer rounded-xl transition-all duration-300",
                      gridHighlightName === product.name && "ring-2 ring-malachite-600 ring-offset-2"
                    )}
                  >
                    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-raised transition-shadow hover:border-border hover:shadow-overlay">
                      <div className="relative h-36 shrink-0 rounded-t-xl bg-card">
                        {bannedAdvisoryByName.get(product.name) ? (
                          <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Check dorm policy
                          </span>
                        ) : trendingTopNames.has(product.name) ? (
                          <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Trending
                          </span>
                        ) : null}
                        {(product.variants?.length ?? 0) > 0 ? (
                          <span className="absolute right-2 top-2 z-10 rounded-full border border-border bg-card/95 px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-raised">
                            {(product.variants?.length ?? 0) + 1} options
                          </span>
                        ) : null}
                        <div className="flex h-full w-full items-center justify-center">
                          {product.imageUrl && !imageLoadErrors.has(product.id) ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              loading="lazy"
                              className="h-full w-full object-contain p-1.5"
                              onError={() =>
                                setImageLoadErrors((prev) => {
                                  const next = new Set(prev);
                                  next.add(product.id);
                                  return next;
                                })
                              }
                            />
                          ) : (
                            <Package className="h-12 w-12 text-muted-foreground/40" strokeWidth={1.25} />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                        <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</h3>
                        <p className="text-sm font-semibold text-foreground">{product.price}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={cn(
                                  "h-2.5 w-2.5",
                                  i < fullStars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                                )}
                              />
                            ))}
                          </span>
                          <span>
                            {product.rating.toFixed(1)} ({formatReviewCount(product.reviews)})
                          </span>
                          {product.hearts >= 5 ? (
                            <span className="whitespace-nowrap">{"·"} {product.hearts} students saved</span>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleSaved(product);
                          }}
                          className={cn(
                            "mt-auto flex h-9 min-h-9 w-full items-center justify-center gap-1 rounded-lg text-xs font-semibold transition-colors",
                            isSaved
                              ? "border border-malachite-200 bg-malachite-50 text-malachite-800 hover:bg-malachite-100 dark:border-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300 dark:hover:bg-malachite-900/60"
                              : "bg-malachite-800 text-white hover:bg-malachite-900 dark:bg-malachite-800 dark:hover:bg-malachite-600"
                          )}
                          aria-label={
                            isSaved
                              ? `Remove ${product.name} from My Picks`
                              : `Add ${product.name} to My Picks`
                          }
                          variant="ghost"
                        >
                          {isSaved ? (
                            <>
                              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                              {t("checklist:explore.addedToPicks")}
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                              {t("checklist:explore.addPickShort")}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <MyPicksContainer
            isMobile={isMobile}
            open={picksSheetOpen}
            onOpenChange={setPicksSheetOpen}
            title={t("checklist:explore.myPicks")}
          >
            <div
              className={cn(
                "flex flex-col overflow-hidden",
                isMobile
                  ? "min-h-0 flex-1"
                  : "max-h-[min(80vh,720px)] rounded-xl border border-border bg-card shadow-overlay",
              )}
            >
              {/* Seamless header: same surface as the sheet (no inset grey band), with the
                  rarely-used destructive actions folded into a single overflow menu. */}
              <div className="shrink-0 rounded-t-xl bg-card px-4 pb-3 pt-2 text-foreground">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShoppingBag className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
                    <h3 className="truncate text-sm font-semibold leading-tight">{t("checklist:explore.myPicks")}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <p className="text-xs font-medium">
                      {t("checklist:explore.itemCount", { count: activePicks.length })} {"·"} $
                      {activePicksTotal.toFixed(2)}
                    </p>
                    {savedList.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={t("checklist:explore.picksMenu")}
                            className="-mr-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {hasPicksAlreadyInChecklist ? (
                            <DropdownMenuItem onClick={() => void clearAddedFromPicks()}>
                              <Trash2 className="mr-2 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                              {t("checklist:explore.clearAddedItems")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onClick={() => void clearAllPicks()}
                            className="text-red-600 focus:text-red-600"
                          >
                            {t("checklist:explore.clearAll")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      className="mt-2 inline-flex w-full items-center justify-between gap-2 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/10"
                      aria-label={t("checklist:explore.chooseDestinationList")}
                      variant="ghost"
                    >
                      <span className="min-w-0 truncate">
                        {t("checklist:explore.sendInto", { list: activeListDisplayName })}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[min(calc(100vw-2rem),260px)]">
                    <DropdownMenuItem
                      onClick={() => onSelectList(null)}
                      className={cn(activeListGroupId == null && "bg-accent text-foreground")}
                    >
                      {t("checklist:topbar.personalList")}
                    </DropdownMenuItem>
                    {allGroups.map((g) => (
                      <DropdownMenuItem
                        key={g.id}
                        onClick={() => onSelectList(g.id)}
                        className={cn(activeListGroupId === g.id && "bg-accent text-foreground")}
                      >
                        {groupLabel(g)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {savedList.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
                  <p className="text-xs text-muted-foreground">{t("checklist:explore.addItemsToBuildPicks")}</p>
                </div>
              ) : (
                <>
                  <DndContext
                    sensors={myPicksSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleMyPicksDragStart}
                    onDragEnd={handleMyPicksDragEnd}
                    onDragCancel={handleMyPicksDragCancel}
                  >
                    <div className="min-h-0 flex-1 overflow-y-auto py-2">
                      {groupedPicks.map((group) => (
                        <div key={group.section} className="pb-1">
                          <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.section} {"·"} {group.items.length}
                          </div>
                          <SortableContext
                            items={group.items.map((p) => p.name)}
                            strategy={verticalListSortingStrategy}
                          >
                            <ul className="space-y-3 px-3">
                              {group.items.map((p) => (
                                <SortableMyPickRow
                                  key={p.name}
                                  product={p}
                                  variant={pickVariants?.get(p.name) ?? null}
                                  section={resolveSectionFor(p)}
                                  onChangeSection={(trigger) => openOverrideMenu(p.name, trigger)}
                                  flash={sidebarFlashNames.has(p.name)}
                                  inChecklist={checklistItemNamesForDisplay.has(checklistExploreNameKey(p.name))}
                                  imageLoadErrors={imageLoadErrors}
                                  setImageLoadErrors={setImageLoadErrors}
                                  onOpenDetail={() => setSelectedProduct(p)}
                                  onRemove={() => void toggleSaved(p)}
                                />
                              ))}
                            </ul>
                          </SortableContext>
                        </div>
                      ))}
                      {groupedPicks.length === 0 && archivedPicks.length > 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                          {t("checklist:explore.allPicksSent")}
                        </p>
                      ) : null}
                      {archivedPicks.length > 0 ? (
                        <div className="mt-2 border-t border-border px-3 pt-2">
                          <Button
                            type="button"
                            onClick={() => setArchiveOpen((o) => !o)}
                            className="flex w-full items-center justify-between gap-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                            aria-expanded={archiveOpen}
                            variant="ghost"
                          >
                            <span className="inline-flex items-center gap-1">
                              {archiveOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                              )}
                              {t("checklist:explore.addedToChecklistSection")}
                            </span>
                            <span>{archivedPicks.length}</span>
                          </Button>
                          {archiveOpen ? (
                            <ul className="space-y-2 pb-2 pt-1">
                              {archivedPicks.map((p) => (
                                <ArchivedPickRow
                                  key={p.name}
                                  product={p}
                                  variant={pickVariants?.get(p.name) ?? null}
                                  addedAt={pickCreatedAt?.get(p.name) ?? null}
                                  imageLoadErrors={imageLoadErrors}
                                  setImageLoadErrors={setImageLoadErrors}
                                  onOpenDetail={() => setSelectedProduct(p)}
                                  onRemoveFromChecklist={() => void removePickFromChecklist(p)}
                                />
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <DragOverlay
                      dropAnimation={{
                        // ease-out-quart: a real object decelerating into its slot, no overshoot.
                        duration: 280,
                        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
                      }}
                    >
                      {activePickDragProduct ? (
                        <MyPicksDragOverlayCard
                          product={activePickDragProduct}
                          imageLoadErrors={imageLoadErrors}
                        />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                  <div className="mt-2 shrink-0 border-t border-border px-3 pb-3 pt-2">
                    <div className="mb-2 space-y-0.5 text-xs">
                      <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                        <span>{t("checklist:explore.picksTotal")}</span>
                        <span>${activePicksTotal.toFixed(2)}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {t("checklist:explore.checklistEstTotal")}: ${checklistEstimatedTotal.toFixed(2)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      disabled={allPicksAddedToChecklist}
                      onClick={() => void handleAddAllToChecklist()}
                      className={cn(
                        "flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-colors",
                        allPicksAddedToChecklist
                          ? "cursor-not-allowed bg-muted text-muted-foreground"
                          : "bg-malachite-800 text-white hover:bg-malachite-900 dark:bg-malachite-800 dark:hover:bg-malachite-600"
                      )}
                      variant="ghost"
                    >
                      {allPicksAddedToChecklist ? (
                        t("checklist:explore.allItemsAdded")
                      ) : (
                        <>
                          <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                          {t("checklist:explore.sendItemsToChecklist", { count: picksNotYetAddedCount })}
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </MyPicksContainer>
        </div>

        {/* Mobile-only floating button: opens the My Picks bottom-sheet so items can be
            sent to the checklist without scrolling past the whole product grid. Shown only
            once at least one pick exists. Sits above the BottomNav (safe-area aware). */}
        {isMobile && savedList.length > 0 ? (
          <Button
            type="button"
            onClick={() => setPicksSheetOpen(true)}
            aria-label={t("checklist:explore.openMyPicks", { count: activePicks.length })}
            className={cn(
              "fixed right-4 z-[10052] flex items-center gap-2 rounded-full bg-malachite-800 px-4 py-3.5 text-sm font-semibold text-white shadow-overlay transition-all duration-200 ease-ios active:scale-95",
              // The four-squares section menu owns the screen while it is open: the FAB
              // ducks out (down + faded) instead of floating on top of the tile grid.
              actionMenuOpen && "pointer-events-none translate-y-3 scale-95 opacity-0",
            )}
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}
            tabIndex={actionMenuOpen ? -1 : undefined}
            aria-hidden={actionMenuOpen || undefined}
            variant="ghost"
          >
            <ShoppingBag className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            <span>{t("checklist:explore.myPicks")}</span>
            {activePicks.length > 0 ? (
              <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-malachite-800">
                {activePicks.length}
              </span>
            ) : null}
          </Button>
        ) : null}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Product prices, delivery costs, and availability are subject to change. Any information displayed at the
          time of purchase will apply to the purchase of this product. DormCheck is free to use. We may be compensated
          for affiliate programs like Amazon Associates.
        </p>
      <ExploreProductDetailModal
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(open) => {
          if (!open) setSelectedProduct(null);
        }}
        savedNames={savedNames}
        setSavedNames={setSavedNames}
        showTrendingBadge={selectedProduct ? trendingTopNames.has(selectedProduct.name) : false}
      />
      <AlertDialog open={clearShopDialogOpen} onOpenChange={setClearShopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("checklist:explore.clearShopItemsTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("checklist:explore.clearShopItemsDescription", { count: shopEssentialsCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void handleClearShopItems()}
            >
              {t("checklist:explore.removeItems")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!bannedConfirmProduct}
        onOpenChange={(open) => {
          if (!open) setBannedConfirmProduct(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("checklist:explore.checkDormPolicyFirst")}</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const advisory = bannedConfirmProduct ? findBannedAdvisory(bannedConfirmProduct.name) : null;
                return advisory
                  ? t("checklist:explore.bannedItemWarning", { item: bannedConfirmProduct?.name, category: advisory.name, reason: advisory.reason })
                  : t("checklist:explore.bannedItemGeneric");
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = bannedConfirmProduct;
                setBannedConfirmProduct(null);
                if (p) void addEssentialConfirmed(p);
              }}
            >
              {t("checklist:explore.addAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {overrideMenuFor && overrideMenuStyle
        ? createPortal(
            <div
              ref={overrideMenuPanelRef}
              className="fixed z-[100] overflow-hidden rounded-xl border border-border bg-card shadow-overlay"
              style={{
                top: overrideMenuStyle.top,
                left: overrideMenuStyle.left,
                width: overrideMenuStyle.width,
                maxHeight: overrideMenuStyle.maxHeight,
              }}
              role="listbox"
            >
              <SectionPickMenu
                sections={existingSections}
                highlightSection={(() => {
                  const prod = productByName.get(overrideMenuFor);
                  return prod ? resolveSectionFor(prod) : sectionOverrides[overrideMenuFor] ?? "";
                })()}
                creatingNew={overrideCreating}
                newDraft={overrideDraft}
                onSetCreatingNew={setOverrideCreating}
                onNewDraftChange={setOverrideDraft}
                onPickExisting={(name) => applyOverride(overrideMenuFor, name)}
                onConfirmNewName={(name) => applyOverride(overrideMenuFor, name)}
              />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
