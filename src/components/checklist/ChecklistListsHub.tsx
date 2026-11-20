import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ListChecks, Pencil, Plus, Users2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { computeChecklistReadiness } from "./checklistHelpers";
import type { ChecklistGroup } from "./checklistTypes";
import type { ChecklistItem, ChecklistItemStatus } from "@/types";
import { usePersonalListName } from "@/hooks/usePersonalListName";
import { PageContainer } from "@/components/ui/page-container";

/** PostgREST error when `checklist_items.image_url` is in types but not the DB (schema drift). */
function isImageUrlSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("image_url") &&
    m.includes("checklist_items") &&
    (m.includes("schema cache") || m.includes("does not exist") || m.includes("could not find"))
  );
}

/** Minimal row shape for the hub overview - just enough for readiness + thumbnails. */
interface HubItemRow {
  id: string;
  group_id: string | null;
  user_id: string;
  item: string | null;
  status: ChecklistItemStatus | null;
  is_checked: boolean | null;
  estimated_price: number | null;
  is_night_one: boolean | null;
  assigned_to: string | null;
  image_url?: string | null;
  link_image?: string | null;
}

const HUB_COLS =
  "id, group_id, user_id, item, status, is_checked, estimated_price, is_night_one, assigned_to, image_url, link_image";
const HUB_COLS_NO_IMAGE =
  "id, group_id, user_id, item, status, is_checked, estimated_price, is_night_one, assigned_to, link_image";

async function fetchHubItems(): Promise<HubItemRow[]> {
  // RLS returns own personal rows + every member's rows in groups I belong to,
  // so grouping by group_id gives whole-group progress for each shared list.
  let res = await supabase.from("checklist_items").select(HUB_COLS);
  if (res.error && isImageUrlSchemaError(res.error.message)) {
    res = await supabase.from("checklist_items").select(HUB_COLS_NO_IMAGE);
  }
  if (res.error) throw res.error;
  return (res.data ?? []) as HubItemRow[];
}

interface ListStats {
  readinessPercent: number;
  total: number;
  packed: number;
  thumbs: string[];
  extraThumbs: number;
}

function statsFor(rows: HubItemRow[], currentUserId: string | null): ListStats {
  const readiness = computeChecklistReadiness(rows as unknown as ChecklistItem[], currentUserId);
  const urls: string[] = [];
  for (const r of rows) {
    const url = (r.image_url ?? r.link_image ?? "").trim();
    if (url && !urls.includes(url)) urls.push(url);
  }
  return {
    readinessPercent: readiness.readiness,
    total: readiness.total,
    packed: readiness.packedCount,
    thumbs: urls.slice(0, 4),
    extraThumbs: Math.max(0, urls.length - 4),
  };
}

function groupLabel(g: ChecklistGroup): string {
  return (
    g.group_name?.trim() ||
    (g.is_owner
      ? "My Group"
      : `${g.owner_name ?? "Unknown"} & ${g.collaborator_name ?? "Collaborator"}`)
  );
}

export interface ChecklistListsHubProps {
  userId: string;
  groups: ChecklistGroup[];
  onOpenPersonal: () => void;
  onOpenGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  onManageGroup: (groupId: string) => void;
  /** Persist a group rename (reuses the page's `ranking_collaborations` update). */
  onRenameGroup: (groupId: string, name: string) => void;
  /** The group-lists read failed; say so instead of showing no groups. */
  groupsError?: boolean;
  onRetryGroups?: () => void;
}

export function ChecklistListsHub({
  userId,
  groups,
  onOpenPersonal,
  onOpenGroup,
  onCreateGroup,
  onManageGroup,
  onRenameGroup,
  groupsError = false,
  onRetryGroups,
}: ChecklistListsHubProps) {
  const { t } = useTranslation("checklist");
  const { name: personalName, setName: setPersonalName } = usePersonalListName(userId);

  const {
    data: rows = [],
    isLoading,
    isError: hubError,
    refetch: refetchHub,
  } = useQuery({
    queryKey: ["checklist_hub_overview", userId],
    queryFn: fetchHubItems,
    enabled: !!userId,
  });

  const byGroup = useMemo(() => {
    const m = new Map<string | null, HubItemRow[]>();
    for (const r of rows) {
      const key = r.group_id ?? null;
      const list = m.get(key);
      if (list) list.push(r);
      else m.set(key, [r]);
    }
    return m;
  }, [rows]);

  const personalStats = useMemo(
    () => statsFor(byGroup.get(null) ?? [], userId),
    [byGroup, userId],
  );

  // { kind, id } of the card whose name is being edited inline (null = none).
  const [editing, setEditing] = useState<{ kind: "personal" | "group"; id?: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEditPersonal = () => {
    setEditValue(personalName);
    setEditing({ kind: "personal" });
  };
  const startEditGroup = (g: ChecklistGroup) => {
    setEditValue(groupLabel(g));
    setEditing({ kind: "group", id: g.id });
  };
  const cancelEdit = () => {
    setEditing(null);
    setEditValue("");
  };
  const commitEdit = () => {
    if (!editing) return;
    if (editing.kind === "personal") setPersonalName(editValue);
    else if (editing.id) onRenameGroup(editing.id, editValue);
    cancelEdit();
  };

  return (
    <PageContainer width="wide" className="pb-4 pt-4 md:pt-6">
      <div className="mb-4 md:mb-6">
        <h2 className="font-display text-xl font-semibold text-foreground md:text-2xl">
          {t("checklist:v2.hub.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("checklist:v2.hub.subtitle")}</p>
      </div>

      {/* A failed read used to look like empty lists (or a stat skeleton that
          never resolved). Name it and offer the one useful action. */}
      {(hubError || groupsError) && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
        >
          <p className="text-sm text-foreground">
            {t(hubError ? "common:loadFailed.checklistHub" : "common:loadFailed.checklistGroups")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (hubError) void refetchHub();
              if (groupsError) onRetryGroups?.();
            }}
          >
            {t("common:loadFailed.retry")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {/* Personal list card */}
        <ListCard
          icon={<ListChecks className="h-4 w-4" aria-hidden />}
          title={personalName}
          badge={t("checklist:v2.hub.personalBadge")}
          stats={personalStats}
          loading={isLoading || hubError}
          isEditing={editing?.kind === "personal"}
          editValue={editValue}
          onEditChange={setEditValue}
          onEditCommit={commitEdit}
          onEditCancel={cancelEdit}
          onOpen={onOpenPersonal}
          onRename={startEditPersonal}
          renameLabel={t("checklist:v2.hub.rename")}
          nameInputLabel={t("checklist:v2.hub.renameLabel")}
          openLabel={t("checklist:v2.hub.openList", { name: personalName })}
          saveLabel={t("checklist:v2.hub.save")}
          cancelLabel={t("checklist:v2.hub.cancel")}
          readyLabel={(p) => t("checklist:v2.hub.ready", { percent: p })}
          packedLabel={(packed, total) => t("checklist:v2.hub.packedOf", { packed, total })}
          noItemsLabel={t("checklist:v2.hub.noItems")}
          addHintLabel={t("checklist:v2.hub.addItemsHint")}
          moreThumbsLabel={(n) => t("checklist:v2.hub.moreThumbs", { count: n })}
        />

        {/* One card per group list */}
        {groups.map((g) => {
          const label = groupLabel(g);
          const avatars = [
            { url: g.owner_avatar_url, name: g.owner_name },
            { url: g.collaborator_avatar_url, name: g.collaborator_name },
          ].filter((a) => a.name || a.url);
          return (
            <ListCard
              key={g.id}
              icon={<Users2 className="h-4 w-4" aria-hidden />}
              title={label}
              avatars={avatars}
              stats={statsFor(byGroup.get(g.id) ?? [], null)}
              loading={isLoading || hubError}
              isEditing={editing?.kind === "group" && editing.id === g.id}
              editValue={editValue}
              onEditChange={setEditValue}
              onEditCommit={commitEdit}
              onEditCancel={cancelEdit}
              onOpen={() => onOpenGroup(g.id)}
              onRename={() => startEditGroup(g)}
              onManage={() => onManageGroup(g.id)}
              manageLabel={t("checklist:v2.hub.manage")}
              moreActionsLabel={t("checklist:v2.hub.moreActions", { name: label })}
              renameLabel={t("checklist:v2.hub.rename")}
              nameInputLabel={t("checklist:v2.hub.renameLabel")}
              openLabel={t("checklist:v2.hub.openList", { name: label })}
              saveLabel={t("checklist:v2.hub.save")}
              cancelLabel={t("checklist:v2.hub.cancel")}
              readyLabel={(p) => t("checklist:v2.hub.ready", { percent: p })}
              packedLabel={(packed, total) => t("checklist:v2.hub.packedOf", { packed, total })}
              noItemsLabel={t("checklist:v2.hub.noItems")}
              addHintLabel={t("checklist:v2.hub.addItemsHint")}
              moreThumbsLabel={(n) => t("checklist:v2.hub.moreThumbs", { count: n })}
            />
          );
        })}

        {/* Make a new group list */}
        <Button
          type="button"
          variant="ghost"
          onClick={onCreateGroup}
          // [&_svg]:size-5 keeps the 20px plus off Button's base [&_svg]:size-4.
          // Mobile: a compact row so the dashed CTA doesn't leave a tall empty box
          // under the last card. Desktop: the original centred tile that fills a grid cell.
          className="flex h-auto w-full flex-row items-center justify-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-4 text-left font-normal transition-colors md:min-h-[9.5rem] md:flex-col md:items-center md:justify-center md:gap-2 md:text-center hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2 [&_svg]:size-5" // KEEP: focus ring (interaction-only)
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal md:items-center">
            <span className="text-sm font-semibold text-foreground">
              {t("checklist:v2.hub.newGroupTitle")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("checklist:v2.hub.newGroupHint")}
            </span>
          </span>
        </Button>
      </div>
    </PageContainer>
  );
}

interface ListCardProps {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  avatars?: { url: string | null; name: string | null }[];
  stats: ListStats;
  loading: boolean;
  isEditing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onOpen: () => void;
  onRename: () => void;
  onManage?: () => void;
  manageLabel?: string;
  moreActionsLabel?: string;
  renameLabel: string;
  nameInputLabel: string;
  openLabel: string;
  saveLabel: string;
  cancelLabel: string;
  readyLabel: (percent: number) => string;
  packedLabel: (packed: number, total: number) => string;
  noItemsLabel: string;
  addHintLabel: string;
  moreThumbsLabel: (count: number) => string;
}

function ListCard(props: ListCardProps) {
  const { stats, loading } = props;
  const isEmpty = stats.total === 0;
  const inputRef = useRef<HTMLInputElement>(null);

  // Move focus to the rename field when the user opens the inline editor.
  useEffect(() => {
    if (props.isEditing) inputRef.current?.focus();
  }, [props.isEditing]);

  return (
    <div className="group relative rounded-xl border border-border bg-card shadow-raised transition-shadow md:hover:shadow-overlay">
      {/* Whole card opens the list (kept a sibling of the action buttons - never nested). */}
      <Button
        type="button"
        variant="ghost"
        onClick={props.onOpen}
        aria-label={props.openLabel}
        // items-stretch/justify-start/whitespace-normal override Button's base
        // `items-center justify-center whitespace-nowrap`, which was centring and
        // shrink-wrapping every row inside this flex-col card.
        className="flex h-auto w-full flex-col items-stretch justify-start gap-2.5 whitespace-normal rounded-xl p-4 text-left font-normal hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2" // KEEP: focus ring (interaction-only)
      >
        <div className="flex w-full items-start gap-2 pr-14">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {props.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate font-semibold text-foreground">{props.title}</span>
              {props.badge ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {props.badge}
                </span>
              ) : null}
            </div>
            {props.avatars && props.avatars.length > 0 ? (
              <div className="mt-1 flex items-center -space-x-1.5">
                {props.avatars.map((a, i) =>
                  a.url ? (
                    <img
                      key={i}
                      src={a.url}
                      alt=""
                      className="h-5 w-5 rounded-full border border-card object-cover"
                    />
                  ) : (
                    <span
                      key={i}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-white bg-muted text-[0.6rem] font-semibold text-muted-foreground"
                    >
                      {(a.name ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Progress line */}
        {loading ? (
          <Skeleton className="h-8 w-full rounded-md bg-muted" />
        ) : isEmpty ? (
          <div className="w-full text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{props.noItemsLabel}</span>
            <span className="block text-xs">{props.addHintLabel}</span>
          </div>
        ) : (
          <div className="w-full">
            <div className="mb-1.5 flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-foreground">
                {props.readyLabel(stats.readinessPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                {props.packedLabel(stats.packed, stats.total)}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={stats.readinessPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={props.readyLabel(stats.readinessPercent)}
            >
              <div
                className="h-full rounded-full bg-malachite-600 transition-all" // KEEP: progress bar fill (readiness indicator)
                style={{ width: `${stats.readinessPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Thumbnail strip */}
        {!loading && stats.thumbs.length > 0 ? (
          <div className="flex w-full items-center gap-1.5">
            {stats.thumbs.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="h-8 w-8 rounded-md border border-border object-cover"
              />
            ))}
            {stats.extraThumbs > 0 ? (
              <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                {props.moreThumbsLabel(stats.extraThumbs)}
              </span>
            ) : null}
          </div>
        ) : null}
      </Button>

      {/* Secondary actions - absolute so they never nest inside the open button */}
      <div className="absolute right-2 top-2 flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          onClick={props.onRename}
          aria-label={props.renameLabel}
          className="flex h-8 w-8 items-center justify-center rounded-md p-0 text-muted-foreground opacity-100 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 md:opacity-0 md:group-hover:opacity-100" // KEEP: interaction-only focus ring
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
        {props.onManage ? (
          <Button
            type="button"
            variant="ghost"
            onClick={props.onManage}
            aria-label={props.manageLabel ?? props.moreActionsLabel}
            className="flex h-8 w-8 items-center justify-center rounded-md p-0 text-muted-foreground opacity-100 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 md:opacity-0 md:group-hover:opacity-100" // KEEP: interaction-only focus ring
          >
            <Users2 className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      {/* Inline rename overlay */}
      {props.isEditing ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-center gap-2 rounded-xl bg-card p-4">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="hub-rename-input">
            {props.nameInputLabel}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="hub-rename-input"
              ref={inputRef}
              value={props.editValue}
              onChange={(e) => props.onEditChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  props.onEditCommit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  props.onEditCancel();
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus-visible:border-border focus-visible:outline-none focus-visible:ring-0"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={props.onEditCommit}
              aria-label={props.saveLabel}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-malachite-800 p-0 text-white hover:bg-malachite-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1" // KEEP: primary CTA save button with focus ring
            >
              <Check className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={props.onEditCancel}
              aria-label={props.cancelLabel}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border p-0 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600" // KEEP: interaction-only focus ring
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
