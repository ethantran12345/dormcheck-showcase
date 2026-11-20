import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ClipboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  MoreVertical,
  Ban,
  CornerUpLeft,
  Tag,
  Trash2,
  Plus,
  NotebookPen,
  X,
  PackageOpen,
  Link2,
  ExternalLink,
  Loader2,
  HandHelping,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isSafeHttpUrl, withAffiliateTag } from "@/lib/amazonAffiliateUrl";
import { EmptyState } from "@/components/ui/EmptyState";
import { FoldedBeddingIllustration } from "@/components/illustrations/DormIllustrations";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computeChecklistReadiness,
  groupChecklistByClaim,
  resolveChecklistStatus,
  getInitials,
  getFirstName,
  splitBulkItemNames,
  visibleChecklistCategory,
} from "./checklistHelpers";

const ALL = "__all__";

/** Minimal member shape the board needs to render claimer avatars + labels. */
export interface ChecklistGroupMember {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface ChecklistGroupBoardProps {
  items: ChecklistItem[];
  currentUserId: string | null;
  /** Category names for the filter rail + re-tag menu. */
  categories: string[];
  loading: boolean;
  /** Sum of still-need prices, for the summary rail Est. total. */
  estimatedCost: number;
  /** Roommates on this list (for claimer avatars + disambiguated labels). */
  groupMembers: ChecklistGroupMember[];
  /** user_id -> display label (disambiguated), built by the page. */
  memberLabels: Map<string, string>;
  onAdvance: (item: ChecklistItem) => void;
  onSetStatus: (id: string, status: ChecklistItemStatus) => void;
  onToggleNightOne: (id: string) => void;
  onRetag: (id: string, category: string) => void;
  onAddItem: (name: string) => void;
  onAddBulk: (names: string[]) => void;
  onDelete: (id: string) => void;
  /** Claim / unclaim: pass the current user id to claim, null to release. */
  onClaim: (id: string, userId: string | null) => void;
  onSaveLink: (id: string, url: string) => void;
  onRemoveLink: (id: string) => void;
  linkFetchingId: string | null;
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

/**
 * Right-side claim affordance. Unclaimed -> a "Claim" button. Claimed by me ->
 * my avatar + "You" that releases on click. Claimed by a roommate -> a read-only
 * avatar chip (tooltip names them); tapping takes the item over onto my plate.
 */
function ClaimControl({
  item,
  currentUserId,
  memberById,
  memberLabels,
  onClaim,
}: {
  item: ChecklistItem;
  currentUserId: string | null;
  memberById: Map<string, ChecklistGroupMember>;
  memberLabels: Map<string, string>;
  onClaim: (id: string, userId: string | null) => void;
}) {
  const { t } = useTranslation();
  const assignee = item.assigned_to ?? null;

  if (!assignee) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          if (!currentUserId) return;
          onClaim(item.id, currentUserId);
        }}
        disabled={!currentUserId}
        // [&_svg]:size-3.5 keeps the 14px glyph off Button's base [&_svg]:size-4.
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5"
        aria-label={t("checklist:v2.group.claimAria", { item: item.item })}
      >
        <HandHelping className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {t("checklist:v2.group.claim")}
      </Button>
    );
  }

  const member = memberById.get(assignee) ?? null;
  const isMine = assignee === currentUserId;
  const label = isMine
    ? t("checklist:v2.group.you")
    : getFirstName(memberLabels.get(assignee) ?? member?.full_name ?? null);
  const fullLabel = memberLabels.get(assignee) ?? member?.full_name ?? label;
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2">
      <Avatar className="h-5 w-5">
        <AvatarImage src={member?.avatar_url ?? undefined} alt="" />
        <AvatarFallback className="text-[9px]">{getInitials(fullLabel)}</AvatarFallback>
      </Avatar>
      <span className="max-w-[6rem] truncate text-xs font-medium text-foreground">{label}</span>
    </span>
  );

  if (isMine) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onClaim(item.id, null);
        }}
        className="h-auto shrink-0 rounded-full p-0 transition-opacity hover:bg-transparent hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600" // KEEP: interaction-only focus ring
        aria-label={t("checklist:v2.group.unclaimAria", { item: item.item })}
      >
        {chip}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            if (!currentUserId) return;
            onClaim(item.id, currentUserId);
          }}
          disabled={!currentUserId}
          className="h-auto shrink-0 rounded-full p-0 transition-opacity hover:bg-transparent hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 disabled:opacity-50" // KEEP: interaction-only focus ring
          aria-label={t("checklist:v2.group.takeOverAria", { item: item.item, name: fullLabel })}
        >
          {chip}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t("checklist:v2.group.bringingBy", { name: fullLabel })}
      </TooltipContent>
    </Tooltip>
  );
}

function GroupItemRow({
  item,
  currentUserId,
  categories,
  memberById,
  memberLabels,
  onAdvance,
  onSetStatus,
  onRetag,
  onDelete,
  onClaim,
  onSaveLink,
  onRemoveLink,
  linkFetchingId,
  showStatusChip = true,
}: {
  item: ChecklistItem;
  currentUserId: string | null;
  categories: string[];
  memberById: Map<string, ChecklistGroupMember>;
  memberLabels: Map<string, string>;
  onAdvance: (item: ChecklistItem) => void;
  onSetStatus: (id: string, status: ChecklistItemStatus) => void;
  onRetag: (id: string, category: string) => void;
  onDelete: (id: string) => void;
  onClaim: (id: string, userId: string | null) => void;
  onSaveLink: (id: string, url: string) => void;
  onRemoveLink: (id: string) => void;
  linkFetchingId: string | null;
  showStatusChip?: boolean;
}) {
  const { t } = useTranslation();
  const s = resolveChecklistStatus(item);
  const price = Number(item.estimated_price) || 0;
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

  const productImage = item.image_url ?? item.link_image ?? null;
  const thumb = productImage ? (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-0.5">
      <img src={productImage} alt="" loading="lazy" className="h-full w-full object-contain" />
    </span>
  ) : null;

  return (
    <div className="group md:rounded-lg md:px-1 md:transition-colors md:hover:bg-accent/40">
      <div className="flex items-center gap-2.5 py-2 md:py-1.5">
        {showStatusChip ? (
          <StatusChip item={item} onAdvance={() => onAdvance(item)} />
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
            {price > 0 ? <span className="tabular-nums">${price.toFixed(2)}</span> : null}
          </div>
        </div>

        {fetchingLink ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : null}

        {/* Claim / claimer avatar */}
        <ClaimControl
          item={item}
          currentUserId={currentUserId}
          memberById={memberById}
          memberLabels={memberLabels}
          onClaim={onClaim}
        />

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
  tone = "default",
}: {
  title: string;
  hint?: string;
  count?: number;
  children: ReactNode;
  tone?: "default" | "grabs";
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-3 shadow-raised md:p-4",
        tone === "grabs" ? "border-border" : "border-border",
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {title}
          {typeof count === "number" ? (
            <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
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
        // Tint via [&_svg]:text-*, matching the base's own group — see the same
        // comment in ChecklistReadinessView: relying on currentColor from a plain
        // text-* on the button was measured live and did NOT hold.
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

export function ChecklistGroupBoard({
  items,
  currentUserId,
  categories,
  loading,
  estimatedCost,
  groupMembers,
  memberLabels,
  onAdvance,
  onSetStatus,
  onRetag,
  onAddItem,
  onAddBulk,
  onDelete,
  onClaim,
  onSaveLink,
  onRemoveLink,
  linkFetchingId,
}: ChecklistGroupBoardProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [newItem, setNewItem] = useState("");
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [brainDumpText, setBrainDumpText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const brainDumpRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (brainDumpOpen) brainDumpRef.current?.focus();
  }, [brainDumpOpen]);

  const memberById = useMemo(() => {
    const m = new Map<string, ChecklistGroupMember>();
    for (const gm of groupMembers) m.set(gm.user_id, gm);
    return m;
  }, [groupMembers]);

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

  // Group-wide readiness (currentUser-agnostic: nothing is "shared away" on a shared list).
  const readiness = useMemo(() => computeChecklistReadiness(items, null), [items]);

  const groups = useMemo(() => groupChecklistByClaim(visible), [visible]);
  const editableCategories = useMemo(
    () => categories.filter((category) => category.trim().toLowerCase() !== "night one"),
    [categories],
  );
  const upForGrabs = useMemo(
    () => [...groups.nightOne.filter((item) => !item.assigned_to), ...groups.upForGrabs],
    [groups],
  );
  const beingBrought = useMemo(
    () => [...groups.nightOne.filter((item) => !!item.assigned_to), ...groups.beingBrought],
    [groups],
  );

  const rowProps = {
    currentUserId,
    categories: editableCategories,
    memberById,
    memberLabels,
    onAdvance,
    onSetStatus,
    onRetag,
    onDelete,
    onClaim,
    onSaveLink,
    onRemoveLink,
    linkFetchingId,
  };

  const handleAdd = () => {
    const name = newItem.trim();
    if (!name) return;
    onAddItem(name);
    setNewItem("");
    inputRef.current?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return;
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
      <aside className="hidden lg:block lg:sticky lg:top-20 lg:space-y-4">
        <ChecklistReadinessSummary
          readiness={readiness}
          estimatedCost={estimatedCost}
          listId={null}
          loading={loading}
          variant="rail"
        />

      </aside>

      <div className="space-y-3">
        {addBar}

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

        {/* Mobile-only summary (desktop shows it in the rail). */}
        <div className="lg:hidden">
          <ChecklistReadinessSummary
            readiness={readiness}
            estimatedCost={estimatedCost}
            listId={null}
            loading={loading}
            variant="banner"
          />
        </div>

        {/* Up for grabs (unclaimed) */}
        {upForGrabs.length > 0 ? (
          <GroupCard
            tone="grabs"
            title={t("checklist:v2.group.upForGrabs")}
            hint={t("checklist:v2.group.upForGrabsHint")}
            count={upForGrabs.length}
          >
            {upForGrabs.map((item) => (
              <GroupItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </GroupCard>
        ) : null}

        {/* Being brought (claimed) */}
        {beingBrought.length > 0 ? (
          <GroupCard
            title={t("checklist:v2.group.beingBrought")}
            hint={t("checklist:v2.group.beingBroughtHint")}
            count={beingBrought.length}
          >
            {beingBrought.map((item) => (
              <GroupItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </GroupCard>
        ) : null}

        {/* Packed (collapsed) */}
        {groups.packed.length > 0 ? (
          <CollapsibleGroup title={t("checklist:v2.packedDone")} count={groups.packed.length}>
            {groups.packed.map((item) => (
              <GroupItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </CollapsibleGroup>
        ) : null}

        {/* Skipped (collapsed) */}
        {groups.skipped.length > 0 ? (
          <CollapsibleGroup title={t("checklist:v2.skipped")} count={groups.skipped.length}>
            {groups.skipped.map((item) => (
              <GroupItemRow key={item.id} item={item} {...rowProps} showStatusChip={false} />
            ))}
          </CollapsibleGroup>
        ) : null}

        {/* Same wiring as ChecklistReadinessView's empty state: the description
            names the two controls rendered under it, both of which already exist
            in this view (the add input and the brain-dump sheet). Previously this
            passed no action prop at all. */}
        {!loading && !hasAny ? (
          <EmptyState
            className="rounded-card border border-dashed border-border bg-card py-10"
            icon={PackageOpen}
            illustration={<FoldedBeddingIllustration />}
            title={t("checklist:v2.emptyTitle")}
            description={t("checklist:v2.group.emptyBody")}
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
