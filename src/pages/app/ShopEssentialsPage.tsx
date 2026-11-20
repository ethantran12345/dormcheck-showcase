import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useChecklist } from "@/hooks/useChecklist";
import { useGroupSurface } from "@/hooks/useGroupSurface";
import { GroupSurfaceModals } from "@/components/collaborate/GroupSurfaceModals";
import { ChecklistErrorBoundary } from "@/components/checklist/ChecklistErrorBoundary";
import { ChecklistExploreTab } from "@/components/checklist/ChecklistExploreTab";
import { ExploreProductDetailModal } from "@/components/checklist/ExploreProductDetailModal";
import { ChecklistLanding } from "@/components/checklist/ChecklistLanding";
import { useAmazonProductsForModal } from "@/hooks/useAmazonProducts";
import { isAmazonAffiliateUrl } from "@/lib/amazonAffiliateUrl";
import { checklistExploreNameKey } from "@/lib/checklistExploreNameKey";
import type { ExploreProduct } from "@/types/exploreProduct";

/**
 * Shop Essentials - the Amazon affiliate product browser, on its own route.
 *
 * Extracted from ChecklistPage's `?tab=explore` in the §5b split. It was a
 * product browser wearing a checklist costume, and it is the live affiliate
 * revenue path, so it sits next to the marketplace in nav rather than three taps
 * inside a checklist. `/checklist?tab=explore` still redirects here.
 *
 * **Move-in only, deliberately.** Move-out "shopping" is boxes and tape; the
 * actual move-out transaction is selling what you bought in August, which is the
 * marketplace. See PRD §5b "Why Shop is move-in only".
 */
export default function ShopEssentialsPage() {
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

  if (!user) return <ChecklistLanding />;

  return <ShopEssentialsContent />;
}

function ShopEssentialsContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const group = useGroupSurface();
  const {
    selectedGroupId,
    setSelectedGroupId,
    allGroups,
    isGroupContext,
    selectedGroupDisplayName,
    pairedGroupForCrossList,
  } = group;

  const {
    items,
    otherListItemNames,
    sectionOrder,
    totalEstimatedCost,
    addItem,
    updateItem,
    deleteItem,
    clearShopEssentialsItems,
    restoreChecklistItems,
  } = useChecklist(isGroupContext ? selectedGroupId : null, {
    pairedGroupIdWhenPersonal: !isGroupContext ? pairedGroupForCrossList : null,
  });

  const sectionOrderSafe: string[] = sectionOrder ?? [];

  /** Product titles on the checklist - Shop Essentials matches picks to `item` text. */
  const exploreChecklistItemNames = useMemo(() => {
    const s = new Set<string>();
    for (const row of items) {
      const name = (row.item ?? "").trim();
      if (name) s.add(name);
    }
    return s;
  }, [items]);

  /** Personal + paired group (or group + personal): normalized keys for "In Checklist" / heart decrement. */
  const exploreChecklistItemNamesForDisplay = useMemo(() => {
    const s = new Set<string>();
    for (const row of items) {
      const k = checklistExploreNameKey(row.item ?? "");
      if (k) s.add(k);
    }
    for (const name of otherListItemNames) {
      if (name) s.add(name);
    }
    return s;
  }, [items, otherListItemNames]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console -- guarded by the import.meta.env.DEV early return above.
    console.debug('[checklist explore]', {
      otherListItemNames: [...otherListItemNames].sort(),
      exploreChecklistItemNamesForDisplay: [...exploreChecklistItemNamesForDisplay].sort(),
    });
  }, [otherListItemNames, exploreChecklistItemNamesForDisplay]);

  const { data: amazonProductsForModal = [] } = useAmazonProductsForModal();
  const amazonImageByTrimmedName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of amazonProductsForModal) {
      const u = p.imageUrl?.trim();
      if (u) m.set(p.name.trim(), u);
    }
    return m;
  }, [amazonProductsForModal]);
  const amazonImageBackfillAttemptedRef = useRef<Set<string>>(new Set());
  const [shopModalProduct, setShopModalProduct] = useState<ExploreProduct | null>(null);
  const [exploreSavedNames, setExploreSavedNames] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const loadPicks = async () => {
      const { data, error } = await supabase
        .from("explore_picks")
        .select("product_name")
        .eq("user_id", user.id);
      if (cancelled || error) return;
      if (data) {
        setExploreSavedNames(
          new Set(data.map((d: { product_name: string }) => d.product_name)),
        );
      }
    };

    void loadPicks();
    const onFocus = () => {
      void loadPicks();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id]);

  // Backfill Amazon product images onto checklist rows that were added before we
  // had an image for that product.
  useEffect(() => {
    if (!user?.id) {
      amazonImageBackfillAttemptedRef.current.clear();
      return;
    }
    if (amazonProductsForModal.length === 0) return;
    for (const row of items) {
      if (row.image_url?.trim()) continue;
      const link = row.link?.trim();
      if (!link || !isAmazonAffiliateUrl(link)) continue;
      const img = amazonImageByTrimmedName.get(row.item.trim());
      if (!img) continue;
      if (amazonImageBackfillAttemptedRef.current.has(row.id)) continue;
      amazonImageBackfillAttemptedRef.current.add(row.id);
      void (async () => {
        try {
          await updateItem(row.id, { image_url: img });
        } catch {
          amazonImageBackfillAttemptedRef.current.delete(row.id);
        }
      })();
    }
  }, [user?.id, items, amazonImageByTrimmedName, amazonProductsForModal.length, updateItem]);

  const shopEssentialsCount = items.filter(
    (i) => !!i.image_url?.trim() && !!i.link?.trim() && isAmazonAffiliateUrl(i.link),
  ).length;

  return (
    <ChecklistErrorBoundary>
      <div className={cn("min-h-screen max-w-full bg-background")}>
        <header className="w-full bg-background px-6 py-3 md:px-8 md:py-4 lg:px-12">
          {/* Native: title is scrolling page content (sits by the pill, scrolls away). */}
          {Capacitor.isNativePlatform() ? (
            <h1 className="mb-3 truncate pr-28 text-2xl font-semibold leading-tight text-foreground">
              {t('checklist:page.shopEssentials')}
            </h1>
          ) : (
            <h1 className="sr-only">{t('checklist:page.shopDormEssentials')}</h1>
          )}
        </header>

        <GroupSurfaceModals group={group} bannerClassName="px-8 lg:px-12 py-4 pb-0 pt-0 md:pt-2" />

        <div className="w-full px-8 pb-6 pt-0 md:pb-12 md:pt-1 lg:px-12">
          <div className="max-md:-mt-3">
            <ChecklistExploreTab
              addItem={addItem}
              existingSections={sectionOrderSafe}
              checklistItemNamesForAdd={exploreChecklistItemNames}
              checklistItemNamesForDisplay={exploreChecklistItemNamesForDisplay}
              exploreSavedNames={exploreSavedNames}
              setExploreSavedNames={setExploreSavedNames}
              activeListGroupId={isGroupContext ? selectedGroupId : null}
              activeListDisplayName={selectedGroupDisplayName ?? "Personal List"}
              allGroups={allGroups}
              onSelectList={(id) => setSelectedGroupId(id)}
              hasShopEssentialsItems={shopEssentialsCount > 0}
              shopEssentialsCount={shopEssentialsCount}
              clearShopEssentialsItems={clearShopEssentialsItems}
              restoreChecklistItems={restoreChecklistItems}
              checklistEstimatedTotal={totalEstimatedCost}
              activeChecklistItems={items}
              deleteItem={deleteItem}
            />
          </div>
        </div>

        <ExploreProductDetailModal
          product={shopModalProduct}
          open={!!shopModalProduct}
          onOpenChange={(open) => {
            if (!open) setShopModalProduct(null);
          }}
          savedNames={exploreSavedNames}
          setSavedNames={setExploreSavedNames}
        />
      </div>
    </ChecklistErrorBoundary>
  );
}
