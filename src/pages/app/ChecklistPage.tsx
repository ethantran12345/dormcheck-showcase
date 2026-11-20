import { useState, useEffect, useMemo, useCallback } from "react";
import { TallSheet } from '@/components/ui/tall-sheet';
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChecklist, shouldOfferChecklistFirstRun } from "@/hooks/useChecklist";
import { ChecklistErrorBoundary } from "@/components/checklist/ChecklistErrorBoundary";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { ChevronLeft, Building2, Home, Sparkles, ChevronRight, WifiOff } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isAmazonAffiliateUrl } from "@/lib/amazonAffiliateUrl";
import type { ChecklistItem, ChecklistItemStatus } from "@/types";
import { useGroupSurface } from "@/hooks/useGroupSurface";
import { GroupSurfaceModals } from "@/components/collaborate/GroupSurfaceModals";
import { ImportNotesModal } from "@/components/checklist/ImportNotesModal";
import { ChecklistSummaryZone } from "@/components/checklist/ChecklistSummaryZone";
import { ChecklistTopBar } from "@/components/checklist/ChecklistTopBar";
import { ChecklistActionsMenu } from "@/components/checklist/ChecklistActionsMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { exportChecklistPdf } from "@/components/checklist/checklistExportPdf";
import { getInitials, computeChecklistReadiness } from "@/components/checklist/checklistHelpers";
import { ChecklistReadinessView } from "@/components/checklist/ChecklistReadinessView";
import { ChecklistGroupBoard } from "@/components/checklist/ChecklistGroupBoard";
import { ChecklistListsHub } from "@/components/checklist/ChecklistListsHub";
import { resolveChecklistSection } from "@/lib/checklistSection";
import { ChecklistLanding } from "@/components/checklist/ChecklistLanding";

/**
 * My Checklist - items, status, sections, assignee display.
 *
 * Reduced from 3,653 lines in the §5b split. What left, and where it went:
 *  - Shop / Explore  -> `src/pages/app/ShopEssentialsPage.tsx` (`/shop`)
 *  - Group surface   -> `src/hooks/useGroupSurface.ts` + `GroupSurfaceModals`
 *  - PDF export      -> `src/components/checklist/checklistExportPdf.ts`
 *  - The legacy group renderer behind `USE_GROUP_BOARD_V2 === false`, plus the
 *    ~590-line @dnd-kit block only that renderer used, were deleted: the flag
 *    was a hard-coded `true`, so none of it could render.
 *
 * Move In / Move Out already live on `/logistics`; this page only redirects to
 * them (see AppRoutes).
 */
function ChecklistPageContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { showConfirmedRoommates } = useFeatureFlags();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const group = useGroupSurface();
  const {
    selectedGroupId,
    setSelectedGroupId,
    allGroups,
    groupsLoading,
    groupsError,
    refetchGroups,
    hasGroups,
    isGroupContext,
    selectedGroupDisplayName,
    pairedGroupForCrossList,
    groupMembers,
    groupMemberProfiles,
    assigneeLabels,
    groupDropdownOpen,
    setGroupDropdownOpen,
    setCollaborateGroupType,
    setCollaborateOpenForCreate,
    setIsCollaborateOpen,
    setGroupManageSheetOpen,
    openManageGroup,
    openInvite,
    openCreateGroup,
    handleSaveGroupName,
  } = group;

  const [listOpen, setListOpen] = useState(false);
  const showListsHub = !listOpen && !!user;
  const [focusAddRequest, setFocusAddRequest] = useState(0);

  // Command palette "Add a checklist item": /checklist?add=1 opens the personal
  // list past the hub and focuses its add field, then drops the param so a
  // refresh does not re-trigger it.
  useEffect(() => {
    if (searchParams.get("add") !== "1") return;
    setSelectedGroupId(null);
    setListOpen(true);
    setFocusAddRequest((n) => n + 1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("add");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, setSelectedGroupId]);

  // Deep link from the My Home setup card: /checklist?confirmRoommates=1 opens
  // the roommate-confirm flow (same path as the top bar's "Confirm my roommates").
  useEffect(() => {
    if (searchParams.get("confirmRoommates") !== "1") return;
    setCollaborateGroupType("roommate");
    setCollaborateOpenForCreate(true);
    setIsCollaborateOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("confirmRoommates");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, setCollaborateGroupType, setCollaborateOpenForCreate, setIsCollaborateOpen]);

  const {
    items,
    categorizedItems,
    sectionOrder,
    reorderItemsWithinGroup,
    refetch: fetchItems,
    progress,
    remainingItems,
    totalEstimatedCost,
    packedItems,
    totalItems,
    loading,
    listState,
    linkFetchingId,
    forceStopLoading,
    cycleStatus,
    toggleNightOne,
    setItemsStatus,
    addItem,
    addItemsBulk,
    moveItemToList,
    updateItem,
    saveLinkWithPreview,
    removeLink,
    deleteItem,
    resetToDefault,
    addSection,
    clearChecked,
    clearShopEssentialsItems,
  } = useChecklist(isGroupContext ? selectedGroupId : null, {
    pairedGroupIdWhenPersonal: !isGroupContext ? pairedGroupForCrossList : null,
  });

  const sectionOrderSafe: string[] = sectionOrder ?? [];
  const categorizedItemsSafe: Record<string, ChecklistItem[]> = categorizedItems ?? {};

  const sectionsListSafe = useMemo(() => {
    const ordered = sectionOrderSafe.filter(
      (c) => (categorizedItemsSafe[c]?.length ?? 0) > 0,
    );
    const seen = new Set(ordered);
    const extra: string[] = [];
    for (const cat of Object.keys(categorizedItemsSafe)) {
      if (!seen.has(cat) && (categorizedItemsSafe[cat]?.length ?? 0) > 0) {
        extra.push(cat);
        seen.add(cat);
      }
    }
    return [...ordered, ...extra];
  }, [sectionOrderSafe, categorizedItemsSafe]);

  const statusSummary = useMemo(() => {
    let need = 0;
    let packed = 0;
    for (const i of items) {
      const s = i.status ?? (i.is_checked ? "packed" : "need");
      if (s === "packed") packed += 1;
      else need += 1;
    }
    return { need, packed };
  }, [items]);

  // Honest money number: only items still waiting to be bought (shop picks
  // included once added to the list). Bought/packed items no longer count.
  const needToBuyCost = useMemo(() => {
    return items.reduce((sum, i) => {
      const s = i.status ?? (i.is_checked ? "packed" : "need");
      if (s !== "need") return sum;
      return sum + (Number(i.estimated_price) || 0);
    }, 0);
  }, [items]);

  // Checklist v2 weighted readiness for the personal list (Move-In Readiness %).
  const checklistReadiness = useMemo(
    () => computeChecklistReadiness(items, user?.id ?? null),
    [items, user?.id],
  );

  // Phase 4 buy-used: light campus Student Market listings (non-contact columns
  // only, RLS-scoped to the user's university) for matching against need rows.
  const { data: marketplaceMatchListings = [] } = useQuery({
    queryKey: ["checklist-buy-used", user?.id],
    enabled: !!user?.id && !isGroupContext,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketplace_listings")
        .select("title, price, items:marketplace_listing_items(name)")
        .in("status", ["available", "pending"])
        .eq("is_sublease", false)
        .limit(200);
      if (error) {
        console.error("[Checklist] buy-used listings fetch failed", error);
        return [];
      }
      return (data ?? []) as {
        title: string;
        price: number | null;
        items?: { name: string | null }[] | null;
      }[];
    },
  });

  /** v2 quick-add: silently auto-categorize a typed item (no manual section picker). */
  const handleReadinessAdd = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const category =
      resolveChecklistSection({ name: trimmed, category: "" }, sectionsListSafe) || "Unsorted";
    await addItem(category, trimmed);
  };

  /** v2 fast capture: silently auto-categorize each pasted/brain-dumped line, one batch. */
  const handleReadinessAddBulk = async (names: string[]) => {
    const entries = names
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        category:
          resolveChecklistSection({ name, category: "" }, sectionsListSafe) || "Unsorted",
      }));
    if (entries.length === 0) return;
    await addItemsBulk(entries);
  };

  /** Destinations for "Copy to..." (personal → groups; group → personal + other groups). */
  const checklistCopyTargets = useMemo((): { id: string | null; label: string }[] => {
    const out: { id: string | null; label: string }[] = [];
    if (selectedGroupId) {
      out.push({ id: null, label: "Personal List" });
    }
    for (const g of allGroups) {
      if (g.id === selectedGroupId) continue;
      const label =
        g.group_name?.trim() ||
        (g.is_owner ? "My Group" : `${g.owner_name ?? "Unknown"} & ${g.collaborator_name ?? "Collaborator"}`);
      out.push({ id: g.id, label });
    }
    return out;
  }, [allGroups, selectedGroupId]);

  const myShare = useMemo(() => {
    if (!isGroupContext || groupMembers.length === 0 || !user?.id) return 0;
    return items.reduce((sum, item) => {
      const price = Number(item.estimated_price) || 0;
      if (price <= 0) return sum;
      const participantIds = (item.split_participant_ids ?? []).filter(Boolean);
      if (participantIds.length >= 2 && participantIds.includes(user.id)) {
        const pcts = item.split_percentages ?? {};
        const myPct = pcts[user.id] ?? 100 / participantIds.length;
        return sum + (price * myPct) / 100;
      }
      return sum + (item.assigned_to === user.id ? price : 0);
    }, 0);
  }, [isGroupContext, groupMembers.length, user?.id, items]);

  /** Infinite loop guard: force loading off after 3s if fetch hangs (prevents Supabase spam / Captcha failures) */
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => forceStopLoading(), 3000);
    return () => clearTimeout(timer);
  }, [loading, forceStopLoading]);

  // No scroll restoration: navigating to the checklist should always land at the
  // top (the global <ScrollToTop> handles that). Restoring a saved scroll meant
  // tapping in from elsewhere - e.g. the home "Checklist progress" tile - dropped
  // you into the middle of the list.

  /** Auto-populate empty group checklist by cloning personal items */
  useEffect(() => {
    // Only clone into a group the server has confirmed empty; a slow or failed
    // fetch also reads as 0 items.
    if (!isGroupContext || listState !== 'ready' || loading || totalItems > 0 || !selectedGroupId) return;
    (async () => {
      await supabase.rpc('clone_personal_to_group', { target_group_id: selectedGroupId });
      await fetchItems();
    })();
  }, [isGroupContext, listState, totalItems, loading, selectedGroupId, fetchItems]);

  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [importNotesOpen, setImportNotesOpen] = useState(false);

  useEffect(() => {
    let completed = false;
    try {
      completed = localStorage.getItem('checklist_onboarding_completed') === 'true';
    } catch { /* ignore */ }
    if (
      shouldOfferChecklistFirstRun({
        listState,
        loading,
        totalItems,
        isGroupContext,
        signedIn: !!user,
        onboardingCompleted: completed,
      })
    ) {
      setOnboardingModalOpen(true);
    }
  }, [listState, loading, totalItems, isGroupContext, user]);

  const [collapsedChecklistSections, setCollapsedChecklistSections] = useState<Set<string>>(() => new Set());
  const allSectionsCollapsed =
    sectionsListSafe.length > 0 && sectionsListSafe.every((c) => collapsedChecklistSections.has(c));
  const toggleAllSections = useCallback(() => {
    setCollapsedChecklistSections((prev) => {
      const allNow = sectionsListSafe.length > 0 && sectionsListSafe.every((c) => prev.has(c));
      return allNow ? new Set<string>() : new Set(sectionsListSafe);
    });
  }, [sectionsListSafe]);

  const handleOpenResetModal = () => setResetModalOpen(true);

  const handleResetByType = async (type: "dorm" | "apartment" | "custom") => {
    setResetModalOpen(false);
    await resetToDefault(type);
  };

  const handleOnboardingChoice = async (choice: "dorm" | "apartment" | "custom") => {
    setOnboardingModalOpen(false);
    try {
      localStorage.setItem('checklist_onboarding_completed', 'true');
    } catch { /* ignore */ }
    await resetToDefault(choice);
  };

  const handleExportPDF = () =>
    exportChecklistPdf({
      t,
      isMobile,
      categorizedItems: categorizedItemsSafe,
      groupMembers,
      currentUserId: user?.id,
      totalEstimatedCost,
      myShare,
      isGroupContext,
      selectedGroupDisplayName,
    });

  const hasCheckedItems = Object.values(categorizedItemsSafe).some((list) =>
    list.some((i) => (i.status ?? (i.is_checked ? "packed" : "need")) === "packed")
  );

  const hasShopEssentialsItems = items.some(
    (i) => !!i.image_url?.trim() && !!i.link?.trim() && isAmazonAffiliateUrl(i.link),
  );

  // List-level actions (Import/Export/Reset/Clear/Split, +Invite/Manage on groups),
  // relocated off the removed personal top bar onto the readiness summary card `⋯`.
  // Import from Notes lives here and nowhere else: it is a power-user feature on a
  // page most students use once, so it does not hold page real estate (PRD §5b.4).
  const checklistActionsMenu = (
    <ChecklistActionsMenu
      hasCheckedItems={hasCheckedItems}
      hasShopEssentialsItems={hasShopEssentialsItems}
      onImportNotes={() => setImportNotesOpen(true)}
      onExportPDF={handleExportPDF}
      onResetToDefault={handleOpenResetModal}
      onClearChecked={() => clearChecked()}
      onClearShopEssentials={() => void clearShopEssentialsItems()}
      isGroupContext={isGroupContext}
      onInvite={openInvite}
      onManageGroup={() => setGroupManageSheetOpen(true)}
      onSplitCosts={
        !isGroupContext && showConfirmedRoommates
          ? () => navigate('/roommates')
          : undefined
      }
    />
  );

  return (
    <ChecklistErrorBoundary>
      <div className={cn("min-h-screen max-w-full bg-background")}>
        <header className="w-full bg-background px-4 py-3 md:px-8 md:py-4 lg:px-12">
          {/* Native: title is scrolling page content (sits by the pill, scrolls away). */}
          {Capacitor.isNativePlatform() && (
            <h1 className="mb-3 truncate pr-28 text-2xl font-semibold leading-tight text-foreground">
              {t('checklist:page.checklist')}
            </h1>
          )}
          {user && listOpen && isGroupContext && (
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
              <div className="w-full shrink-0">
                <ChecklistTopBar
                  hasGroups={hasGroups}
                  groupsLoading={groupsLoading}
                  allGroups={allGroups}
                  isGroupContext={isGroupContext}
                  selectedGroupId={selectedGroupId}
                  selectedGroupDisplayName={selectedGroupDisplayName}
                  groupMembers={groupMembers}
                  groupDropdownOpen={groupDropdownOpen}
                  onGroupDropdownOpenChange={setGroupDropdownOpen}
                  onSelectPersonalList={() => {
                    setSelectedGroupId(null);
                    setGroupDropdownOpen(false);
                  }}
                  onSelectGroup={(groupId) => {
                    setSelectedGroupId(groupId);
                    setGroupDropdownOpen(false);
                  }}
                  onCreateNewList={() => {
                    setGroupDropdownOpen(false);
                    openCreateGroup();
                  }}
                  onCollaborateFromPersonal={openCreateGroup}
                  onSplitCosts={
                    !isGroupContext && showConfirmedRoommates
                      ? () => navigate('/roommates')
                      : undefined
                  }
                  hasCheckedItems={hasCheckedItems}
                  hasShopEssentialsItems={hasShopEssentialsItems}
                  onImportNotes={() => setImportNotesOpen(true)}
                  onExportPDF={handleExportPDF}
                  onResetToDefault={handleOpenResetModal}
                  onClearChecked={() => clearChecked()}
                  onClearShopEssentials={() => void clearShopEssentialsItems()}
                  onInvite={openInvite}
                  onManageGroup={() => setGroupManageSheetOpen(true)}
                  getInitials={getInitials}
                  canToggleSections={sectionsListSafe.length > 1}
                  allSectionsCollapsed={allSectionsCollapsed}
                  onToggleAllSections={toggleAllSections}
                />
              </div>
            </div>
          )}
        </header>

        <GroupSurfaceModals group={group} bannerClassName="px-4 md:px-8 lg:px-12" />

        {listOpen && (
          <div className="px-4 pt-3 md:px-8 lg:px-12">
            <button
              type="button"
              onClick={() => setListOpen(false)}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
            >
              {/* KEEP: interaction-only focus ring */}
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t("checklist:v2.hub.backToLists")}
            </button>
          </div>
        )}

        {/* Progress summary - sticky under app nav (top-12 web; safe-area + 3rem native). */}
        {!showListsHub && (
          <ChecklistSummaryZone
            packedItems={packedItems}
            totalItems={totalItems}
            progress={progress}
            statusSummary={statusSummary}
            readiness={!isGroupContext ? checklistReadiness : undefined}
            totalEstimatedCost={needToBuyCost}
            remainingItems={remainingItems}
            isGroupContext={isGroupContext}
            listId={!isGroupContext && user?.id ? user.id : null}
            loading={loading || listState === 'unavailable'}
            collapseOnDesktop={!isGroupContext}
            actionsSlot={!isGroupContext ? checklistActionsMenu : undefined}
          />
        )}

        <div className="w-full px-4 pb-6 md:px-8 md:pb-12 lg:px-12">
          {showListsHub ? (
            <ChecklistListsHub
              userId={user!.id}
              groups={allGroups}
              groupsError={groupsError}
              onRetryGroups={() => void refetchGroups()}
              onOpenPersonal={() => {
                setSelectedGroupId(null);
                setListOpen(true);
              }}
              onOpenGroup={(groupId) => {
                setSelectedGroupId(groupId);
                setListOpen(true);
              }}
              onCreateGroup={openCreateGroup}
              onManageGroup={(groupId) => {
                openManageGroup(groupId);
              }}
              onRenameGroup={(groupId, name) => void handleSaveGroupName(groupId, name)}
            />
          ) : /* No loading branch here on purpose. It used to swap the ENTIRE view for
                eight 64px blocks on 16px gaps — 80px per row against a real item row of
                52px, and none of the surrounding chrome (header, progress, add bar) — so
                the load-to-loaded transition reflowed the whole page. Both branches below
                already take `loading` and reserve their own space. */
          listState === 'unavailable' && totalItems === 0 && !loading ? (
            <EmptyState
              icon={WifiOff}
              title={t('checklist:page.loadFailedTitle')}
              description={t('checklist:page.loadFailedBody')}
              action={
                <Button variant="outline" onClick={() => void fetchItems()}>
                  {t('common:actions.retry')}
                </Button>
              }
            />
          ) : !isGroupContext ? (
            <ChecklistReadinessView
              items={items}
              currentUserId={user?.id ?? null}
              readiness={checklistReadiness}
              categories={sectionsListSafe}
              loading={loading}
              estimatedCost={needToBuyCost}
              listId={user?.id ?? null}
              onAdvance={(it) =>
                void cycleStatus(
                  it.id,
                  (it.status ?? undefined) as ChecklistItemStatus | undefined,
                )
              }
              onSetStatus={(id, status) => void setItemsStatus([id], status)}
              onToggleNightOne={(id) => void toggleNightOne(id)}
              onRetag={(id, category) => void updateItem(id, { category })}
              onAddItem={(name) => void handleReadinessAdd(name)}
              onAddBulk={(names) => void handleReadinessAddBulk(names)}
              onDelete={(id) => void deleteItem(id)}
              onSaveLink={(id, url) => void saveLinkWithPreview(id, url)}
              onRemoveLink={(id) => void removeLink(id)}
              linkFetchingId={linkFetchingId}
              moveTargets={checklistCopyTargets}
              onMove={(item, targetId, label) => void moveItemToList(item.id, targetId, label)}
              marketplaceListings={marketplaceMatchListings}
              onShopUsed={() => navigate("/marketplace?tab=buy-sell")}
              onReorderGroup={(orderedIds) => void reorderItemsWithinGroup(orderedIds)}
              actionsSlot={checklistActionsMenu}
              focusAddRequest={focusAddRequest}
            />
          ) : (
            <ChecklistGroupBoard
              items={items}
              currentUserId={user?.id ?? null}
              categories={sectionsListSafe}
              loading={loading}
              estimatedCost={needToBuyCost}
              groupMembers={groupMemberProfiles}
              memberLabels={assigneeLabels}
              onAdvance={(it) =>
                void cycleStatus(
                  it.id,
                  (it.status ?? undefined) as ChecklistItemStatus | undefined,
                )
              }
              onSetStatus={(id, status) => void setItemsStatus([id], status)}
              onToggleNightOne={(id) => void toggleNightOne(id)}
              onRetag={(id, category) => void updateItem(id, { category })}
              onAddItem={(name) => void handleReadinessAdd(name)}
              onAddBulk={(names) => void handleReadinessAddBulk(names)}
              onDelete={(id) => void deleteItem(id)}
              onClaim={(id, uid) => void updateItem(id, { assigned_to: uid })}
              onSaveLink={(id, url) => void saveLinkWithPreview(id, url)}
              onRemoveLink={(id) => void removeLink(id)}
              linkFetchingId={linkFetchingId}
            />
          )}
        </div>

        <TallSheet
          open={onboardingModalOpen}
          onOpenChange={setOnboardingModalOpen}
          title={t('checklist:page.startEssentialsList')}
        >
          <div className="px-1 pb-1">
            <h2 className="font-display text-xl font-bold leading-tight text-foreground">
              {t('checklist:page.startEssentialsList')}
            </h2>
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              {t('checklist:page.chooseTemplate')}
            </p>
          </div>
          <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-raised">
            <ListTypeButton
              icon={<Building2 className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.dorm')}
              description={t('checklist:page.dormDesc')}
              onClick={() => handleOnboardingChoice("dorm")}
            />
            <ListTypeButton
              icon={<Home className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.apartment')}
              description={t('checklist:page.apartmentDesc')}
              onClick={() => handleOnboardingChoice("apartment")}
            />
            <ListTypeButton
              icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.custom')}
              description={t('checklist:page.customDesc')}
              onClick={() => handleOnboardingChoice("custom")}
            />
          </div>
        </TallSheet>

        <TallSheet
          open={resetModalOpen}
          onOpenChange={setResetModalOpen}
          title={t('checklist:page.resetToDefault')}
        >
          <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-raised">
            <ListTypeButton
              icon={<Building2 className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.dorm')}
              description={t('checklist:page.dormDesc')}
              onClick={() => handleResetByType("dorm")}
            />
            <ListTypeButton
              icon={<Home className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.apartment')}
              description={t('checklist:page.apartmentDesc')}
              onClick={() => handleResetByType("apartment")}
            />
            <ListTypeButton
              icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              title={t('checklist:page.custom')}
              description={t('checklist:page.customDesc')}
              onClick={() => handleResetByType("custom")}
            />
          </div>
        </TallSheet>

        <ImportNotesModal
          open={importNotesOpen}
          onOpenChange={setImportNotesOpen}
          sectionOrder={sectionOrderSafe}
          addItem={addItem}
          addSection={addSection}
        />
      </div>
    </ChecklistErrorBoundary>
  );
}

/** One row of the "what kind of list?" pickers (onboarding + reset share the shape). */
function ListTypeButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-secondary/50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{description}</p>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

export default function ChecklistPage() {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background">
        {/* KEEP: loading spinner is malachite-600, primary accent color for loading UX */}
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-malachite-600 border-t-transparent" />
        <p className="mt-4 text-sm text-muted-foreground">{t('common:actions.loading')}</p>
      </div>
    );
  }

  if (!user) {
    return <ChecklistLanding />;
  }

  return <ChecklistPageContent />;
}
