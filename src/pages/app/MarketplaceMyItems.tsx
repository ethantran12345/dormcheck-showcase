import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, useSearchParams } from 'react-router';
import { Package, Plus, Pencil, Trash2, Loader2, CheckCircle, Clock, RotateCcw, ArrowLeft, Briefcase } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMyListings } from '@/hooks/useMyListings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { MyListing } from '@/hooks/useMyListings';
import { ListingDetailModal } from '@/components/dorm-portal/ListingDetailModalLazy';
import type { MarketplaceListing } from '@/components/dorm-portal/MarketplaceTab';
import { BusinessListingCard } from '@/components/marketplace/BusinessListingCard';
import { BusinessDetailModal } from '@/components/marketplace/BusinessDetailModal';
import { BusinessListingForm } from '@/components/marketplace/BusinessListingForm';
import type { Tables } from '@/integrations/supabase/types';
import { SHOW_STUDENT_BUSINESSES } from '@/lib/featureFlags';
import { isListingInReview } from '@/lib/marketplaceModeration';
import { isServiceListing, serviceStatusLabelKey } from '@/lib/servicePosts';
import { ServicePostSummary } from '@/components/marketplace/ServicePostSummary';
import { PageContainer } from '@/components/ui/page-container';
import { useUniversity } from '@/contexts/UniversityContext';
function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Adapt MyListing to MarketplaceListing for components that expect it */
function toMarketplaceListing(listing: MyListing, userId: string): MarketplaceListing {
  return {
    ...listing,
    image_url: listing.image_urls?.[0] ?? null,
    profiles: null,
    user_id: userId,
  };
}

type MyListingsTab = 'items' | 'businesses';

function getInitialTab(
  state: { tab?: string; section?: string } | null,
  queryTab: string | null,
): MyListingsTab {
  const tab = state?.tab ?? queryTab;
  if (tab === 'businesses' && SHOW_STUDENT_BUSINESSES) return 'businesses';
  return 'items';
}

/**
 * The My Items / My Businesses switcher is a `ToggleGroup`, not `Tabs` (T3.5).
 * Radix Tabs OWNS its panels, but the two panels here are non-adjacent across a
 * ~700-line return and each carries its own query + modal state; hoisting them
 * into `TabsContent` would remount them on every switch. These controls only
 * *select*, so ToggleGroup is the honest primitive. There are two of them - a
 * desktop pill bar and a mobile card selector (a product surface with count
 * badges) - both now composing the primitive instead of raw <button>s.
 */
const myItemsTabPillClass =
  'h-auto min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-4 py-3 text-sm font-medium ' +
  'text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-card ' +
  'data-[state=on]:text-foreground data-[state=on]:shadow-raised';

const myItemsTabCardClass =
  'group h-auto min-h-[72px] w-full min-w-0 justify-start gap-3 rounded-2xl border border-border ' +
  'bg-muted/20 p-3 text-left hover:bg-accent data-[state=on]:bg-muted ' +
  'data-[state=on]:text-foreground [&_svg]:size-5';

export default function MarketplaceMyItemsPage() {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<MyListingsTab>(() =>
    getInitialTab(
      location.state as { tab?: string; section?: string } | null,
      searchParams.get('tab'),
    )
  );

  useEffect(() => {
    if (!SHOW_STUDENT_BUSINESSES && activeTab === 'businesses') {
      setActiveTab('items');
    }
  }, [activeTab]);

  // Deselect-guard: the tab switcher always has exactly one active tab, so an
  // empty ToggleGroup value (Radix's "toggled off") is ignored.
  const handleSelectTab = (v: string) => {
    if (!v) return;
    setActiveTab(v as MyListingsTab);
  };

  const {
    listings,
    isLoading,
    deleteListing,
    markAsSold,
    markAsPending,
    relistListing,
    markItemSold,
    relistItem,
  } = useMyListings(user?.id);

  const myItemListings = listings;

  const [deletingListing, setDeletingListing] = useState<MyListing | null>(null);
  const [markingSoldId, setMarkingSoldId] = useState<string | null>(null);
  const [relistingId, setRelistingId] = useState<string | null>(null);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  // Business listings state
  const queryClient = useQueryClient();
  const [businessFormOpen, setBusinessFormOpen] = useState(false);
  const [editBusinessListing, setEditBusinessListing] = useState<Tables<'business_listings'> | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<Tables<'business_listings'> | null>(null);

  const { data: myBusinessListings = [], isLoading: isLoadingBusinesses } = useQuery({
    queryKey: ['my_business_listings', user?.id],
    enabled: Boolean(user?.id) && SHOW_STUDENT_BUSINESSES,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_listings')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Tables<'business_listings'>[];
    },
  });

  const { data: savedBusinessListings = [], isLoading: isLoadingSavedBusinesses } = useQuery({
    queryKey: ['saved_businesses_full', user?.id],
    enabled: Boolean(user?.id) && SHOW_STUDENT_BUSINESSES,
    queryFn: async () => {
      const { data: savedRows } = await supabase
        .from('saved_businesses')
        .select('business_listing_id')
        .eq('user_id', user!.id);
      const ids = (savedRows ?? []).map((r) => r.business_listing_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('business_listings')
        .select('*')
        .in('id', ids)
        .eq('is_approved', true)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Tables<'business_listings'>[];
    },
  });

  const savedBusinessIdSet = new Set(
    savedBusinessListings.map((l) => l.id),
  );

  const toggleSavedBusiness = async (listingId: string) => {
    if (!user?.id) return;
    const isSaved = savedBusinessIdSet.has(listingId);
    try {
      if (isSaved) {
        await supabase.from('saved_businesses').delete().eq('user_id', user.id).eq('business_listing_id', listingId);
      } else {
        await supabase.from('saved_businesses').insert({ user_id: user.id, business_listing_id: listingId });
      }
      await queryClient.invalidateQueries({ queryKey: ['saved_businesses_full', user.id] });
      await queryClient.invalidateQueries({ queryKey: ['saved_businesses', user.id] });
    } catch {
      toast.error(t('marketplace:myItems.toast.saveBusinessError'));
    }
  };

  const handleDeleteBusiness = async (listingId: string) => {
    try {
      const { error } = await supabase.from('business_listings').delete().eq('id', listingId);
      if (error) throw error;
      toast.success(t('marketplace:myItems.toast.listingDeleted'));
      await queryClient.invalidateQueries({ queryKey: ['my_business_listings'] });
      await queryClient.invalidateQueries({ queryKey: ['business_listings'] });
      if (selectedBusiness?.id === listingId) setSelectedBusiness(null);
    } catch {
      toast.error(t('marketplace:myItems.toast.deleteError'));
    }
  };

  if (!user) {
    navigate('/auth', { replace: true });
    return null;
  }

  const handleAddListing = () => {
    navigate('/marketplace');
  };

  const handleMarkAsSold = async (listing: MarketplaceListing) => {
    setMarkingSoldId(listing.id);
    try {
      await markAsSold(listing.id, () => setSelectedListing(null));
    } finally {
      setMarkingSoldId(null);
    }
  };

  const handleToggleItemStatus = async (
    item: NonNullable<MarketplaceListing['items']>[number],
    listing: MarketplaceListing,
    nextStatus: 'available' | 'sold',
  ) => {
    setTogglingItemId(item.id);
    try {
      const ok =
        nextStatus === 'sold'
          ? await markItemSold(item.id, listing.id)
          : await relistItem(item.id, listing.id);
      if (ok) {
        // Keep the open modal's snapshot in sync with the refetched listings.
        setSelectedListing((prev) => {
          if (!prev || prev.id !== listing.id) return prev;
          const items = (prev.items ?? []).map((i) =>
            i.id === item.id ? { ...i, status: nextStatus } : i,
          );
          const allSold = items.length > 0 && items.every((i) => i.status === 'sold');
          return { ...prev, items, status: allSold ? 'sold' as const : 'available' as const };
        });
      }
    } finally {
      setTogglingItemId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <PageContainer width="wide" className="px-6 lg:px-12 py-6 pb-8 md:pb-12">
        <div className="space-y-4 py-4 animate-fade-in">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] gap-2 text-muted-foreground hover:text-foreground -ml-2"
              onClick={() => navigate('/marketplace')}
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common:actions.back')}
            </Button>
          </div>

          <h1 className="text-2xl font-bold text-foreground">{t('marketplace:myItems.title')}</h1>

          {/* Tabs: My Items | My Businesses (see myItemsTabPillClass above for
              why this is ToggleGroup and not Tabs) */}
          {/* Desktop tab pills */}
          <ToggleGroup
            type="single"
            value={activeTab}
            onValueChange={handleSelectTab}
            className="hidden w-full max-w-full justify-start gap-0 overflow-x-auto rounded-full bg-muted p-1 md:flex"
          >
            <ToggleGroupItem value="items" className={myItemsTabPillClass}>
              <Package className="shrink-0" />
              {t('marketplace:myItems.tabs.items')}
            </ToggleGroupItem>
            {SHOW_STUDENT_BUSINESSES ? (
              <ToggleGroupItem value="businesses" className={myItemsTabPillClass}>
                <Briefcase className="shrink-0" />
                {t('marketplace:myItems.tabs.businesses')}
              </ToggleGroupItem>
            ) : null}
          </ToggleGroup>

          {/* Mobile tab cards - only when multiple tabs exist */}
          {SHOW_STUDENT_BUSINESSES ? (
            <ToggleGroup
              type="single"
              value={activeTab}
              onValueChange={handleSelectTab}
              className="grid grid-cols-2 gap-3 md:hidden"
            >
              <ToggleGroupItem value="items" className={myItemsTabCardClass}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/30 group-data-[state=on]:bg-muted">
                  <Package className="text-muted-foreground group-data-[state=on]:text-foreground" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t('marketplace:myItems.tabs.items')}
                  </span>
                  {!isLoading && myItemListings.length > 0 && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {myItemListings.length}
                    </span>
                  )}
                </div>
              </ToggleGroupItem>

              <ToggleGroupItem value="businesses" className={myItemsTabCardClass}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/30 group-data-[state=on]:bg-muted">
                  <Briefcase className="text-muted-foreground group-data-[state=on]:text-foreground" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t('marketplace:myItems.tabs.businessesShort')}
                  </span>
                  {!isLoadingBusinesses && myBusinessListings.length > 0 && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {myBusinessListings.length}
                    </span>
                  )}
                </div>
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}

          {/* My Items tab */}
          {activeTab === 'items' && (
            <>
              {isLoading && myItemListings.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8" aria-hidden>
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={`listing-skeleton-${idx}`} className="overflow-hidden rounded-xl border border-border bg-card shadow-raised">
                      <div className="aspect-[4/3] animate-pulse bg-muted" />
                      <div className="space-y-2 p-3">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : myItemListings.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={t('marketplace:myItems.empty.title')}
                  description={t('marketplace:myItems.empty.subtitle')}
                  action={
                    <Button
                      size="sm"
                      className="gap-2 bg-secondary hover:bg-secondary/90 text-secondary-foreground"
                      onClick={handleAddListing}
                    >
                      <Plus className="w-4 h-4" />
                      {t('marketplace:myItems.empty.addListing')}
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
                  {myItemListings.map((listing) => (
                    <Card
                      key={listing.id}
                      className={cn(
                        'overflow-hidden border-2 border-transparent bg-card transition-all duration-200 hover:-translate-y-1 hover:border-border hover:shadow-overlay cursor-pointer'
                      )}
                      onClick={() => setSelectedListing(toMarketplaceListing(listing, user.id))}
                    >
                      <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-muted">
                        <img
                          src={safeImageSrc(listing.image_urls?.[0]) || '/placeholder.svg'}
                          alt={listing.title}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }}
                        />
                        <div className="absolute top-2 right-2 flex gap-3">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); navigate(`/marketplace/edit/${listing.id}`); }}
                            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-black/80"
                            aria-label={t('marketplace:myItems.editListingAria')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeletingListing(listing); }}
                            /* Both fills sit over an arbitrary listing photo, so the
                               worst case is a bright one. Measured against a white
                               photo: the old rest pair (stone-200 on black/60) was
                               4.61:1 and the old hover pair was WHITE on red-600/80
                               at 3.78:1 - the hover state failed AA even at its
                               best. Rest is now white (5.74:1) and hover is the
                               solid destructive token #BA1C1C (6.42:1), which is
                               what DESIGN.md specifies for a destructive action
                               anyway. */
                            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-destructive hover:text-destructive-foreground"
                            aria-label={t('marketplace:myItems.deleteListingAria')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <CardContent className="p-3 space-y-1">
                        <p className="font-medium text-foreground text-sm line-clamp-2">{listing.title}</p>
                        {listing.description?.trim() && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{listing.description.trim()}</p>
                        )}
                        {/* NO PAYMENTS: a service post is pinned at price 0, so
                            this row rendered "$0" to its own author. It has no
                            price and no item category — the structured task
                            summary is what it has. */}
                        {isServiceListing(listing) ? (
                          <ServicePostSummary
                            compact
                            serviceCategory={listing.service_category}
                            serviceDate={listing.service_date}
                            serviceDurationMinutes={listing.service_duration_minutes}
                            serviceLocation={listing.service_location}
                          />
                        ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-foreground font-semibold">
                            {(listing.items?.length ?? 0) > 0 ? t('marketplace:myItems.fromPrice', { price: formatPrice(listing.price) }) : formatPrice(listing.price)}
                          </span>
                          {listing.category && (
                            <span className="text-xs text-muted-foreground capitalize">{listing.category}</span>
                          )}
                        </div>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isListingInReview(listing.status, listing.moderation_decision) ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              <Clock className="h-3 w-3 shrink-0" aria-hidden />
                              {t('marketplace:status.inReview')}
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                (listing.status ?? 'available') === 'sold'
                                  ? 'bg-red-100 text-red-800'
                                  : (listing.status ?? 'available') === 'expired' ||
                                      (listing.status ?? 'available') === 'pending'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {/* A service post runs open -> claimed -> completed,
                                  so "Active" would be the wrong word for all
                                  three of its states. */}
                              {isServiceListing(listing)
                                ? t(serviceStatusLabelKey(listing.status ?? 'open'))
                                : (listing.status ?? 'available') === 'sold'
                                ? t('marketplace:status.sold')
                                : (listing.status ?? 'available') === 'expired'
                                  ? t('marketplace:status.expired')
                                  : (listing.status ?? 'available') === 'pending'
                                    ? t('marketplace:status.pending')
                                    : t('marketplace:status.active')}
                            </span>
                          )}
                          {(listing.items?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {t('marketplace:myItems.itemsSoldCount', { sold: listing.items!.filter((i) => i.status === 'sold').length, total: listing.items!.length })}
                            </span>
                          )}
                        </div>
                        {isListingInReview(listing.status, listing.moderation_decision) && (
                          <p className="text-xs text-muted-foreground">
                            {listing.moderation_reason?.trim()
                              ? listing.moderation_reason.trim()
                              : t('marketplace:myItems.inReviewHint')}
                          </p>
                        )}
                      </CardContent>
                      <CardFooter className="p-3 pt-0" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-2 w-full">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-muted-foreground"
                            onClick={() => navigate(`/marketplace/edit/${listing.id}`)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {t('common:actions.edit')}
                          </Button>
                          {(listing.status ?? 'available') === 'available' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                              onClick={() => void markAsPending(listing.id)}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              {t('marketplace:myItems.actions.markPending')}
                            </Button>
                          )}
                          {['available', 'pending'].includes(listing.status ?? 'available') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={async () => {
                                setMarkingSoldId(listing.id);
                                try {
                                  await markAsSold(listing.id);
                                } finally {
                                  setMarkingSoldId(null);
                                }
                              }}
                              disabled={markingSoldId === listing.id}
                            >
                              {markingSoldId === listing.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle className="w-3.5 h-3.5" />
                              )}
                              {t('marketplace:myItems.actions.markSold')}
                            </Button>
                          ) : null}
                          {(listing.status ?? 'available') !== 'available' &&
                            /* Relisting an in-review listing would hit the
                               guard_listing_status_change trigger and throw -
                               don't offer an action that can't succeed. */
                            !isListingInReview(listing.status, listing.moderation_decision) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={async () => {
                                setRelistingId(listing.id);
                                try {
                                  await relistListing(listing.id);
                                } finally {
                                  setRelistingId(null);
                                }
                              }}
                              disabled={relistingId === listing.id}
                            >
                              {relistingId === listing.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              {(listing.status ?? 'available') === 'pending' ? t('marketplace:myItems.actions.backToAvailable') : t('marketplace:myItems.actions.relist')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-destructive hover:text-destructive dark:text-red-400 dark:hover:text-red-300"
                            onClick={() => setDeletingListing(listing)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('common:actions.delete')}
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* My Businesses tab */}
          {SHOW_STUDENT_BUSINESSES && activeTab === 'businesses' && (
            <>
              {isLoadingBusinesses && myBusinessListings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('marketplace:myItems.loadingBusinesses')}</p>
                </div>
              ) : myBusinessListings.length === 0 ? (
                <EmptyState
                  icon={Briefcase}
                  title={t('marketplace:myItems.businessEmpty.title')}
                  description={t('marketplace:myItems.businessEmpty.subtitle', { school: university.shortName })}
                  action={
                    <Button
                      size="sm"
                      // KEEP: primary CTA of My Items (post a listing)
                      className="gap-2 bg-malachite-800 hover:bg-malachite-900 text-white"
                      onClick={() => { setEditBusinessListing(null); setBusinessFormOpen(true); }}
                    >
                      <Briefcase className="w-4 h-4" />
                      {t('marketplace:myItems.businessEmpty.listButton')}
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myBusinessListings.map((listing) => (
                    <BusinessListingCard
                      key={listing.id}
                      listing={listing}
                      isSaved={false}
                      onToggleSave={() => {}}
                      currentUserId={user.id}
                      onEdit={() => { setEditBusinessListing(listing); setBusinessFormOpen(true); }}
                      onDelete={() => void handleDeleteBusiness(listing.id)}
                      onClick={() => setSelectedBusiness(listing)}
                      statusBadge={listing.is_approved ? 'live' : 'pending'}
                    />
                  ))}
                </div>
              )}

              {/* Saved Businesses */}
              <div className="pt-6">
                <h2 className="text-lg font-semibold text-foreground mb-3">{t('marketplace:myItems.savedBusinesses.title')}</h2>
                {isLoadingSavedBusinesses ? (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t('marketplace:myItems.savedBusinesses.loading')}</p>
                  </div>
                ) : savedBusinessListings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {t('marketplace:myItems.savedBusinesses.empty')}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {savedBusinessListings.map((listing) => (
                      <BusinessListingCard
                        key={listing.id}
                        listing={listing}
                        isSaved={savedBusinessIdSet.has(listing.id)}
                        onToggleSave={() => void toggleSavedBusiness(listing.id)}
                        currentUserId={user.id}
                        onClick={() => setSelectedBusiness(listing)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

        </div>

        <ListingDetailModal
          listing={selectedListing}
          open={!!selectedListing}
          onClose={() => setSelectedListing(null)}
          isOwnListing={Boolean(selectedListing && selectedListing.user_id === user.id)}
          onEdit={selectedListing && selectedListing.user_id === user.id ? () => navigate(`/marketplace/edit/${selectedListing.id}`) : undefined}
          onMarkAsSold={selectedListing && selectedListing.user_id === user.id ? () => handleMarkAsSold(selectedListing) : undefined}
          markingSold={markingSoldId === selectedListing?.id}
          onMarkItemSold={(item, listing) => void handleToggleItemStatus(item, listing, 'sold')}
          onRelistItem={(item, listing) => void handleToggleItemStatus(item, listing, 'available')}
          togglingItemId={togglingItemId}
        />

        <AlertDialog open={!!deletingListing} onOpenChange={(open) => !open && setDeletingListing(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('marketplace:myItems.deleteDialog.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('marketplace:myItems.deleteDialog.description', { title: deletingListing?.title ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  if (deletingListing) {
                    await deleteListing(deletingListing.id, () => setDeletingListing(null));
                    setDeletingListing(null);
                  }
                }}
              >
                {t('common:actions.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {SHOW_STUDENT_BUSINESSES ? (
          <>
            <BusinessDetailModal
              listing={selectedBusiness}
              open={!!selectedBusiness}
              onClose={() => setSelectedBusiness(null)}
              isSaved={false}
              onToggleSave={() => {}}
              isOwner={Boolean(selectedBusiness && selectedBusiness.user_id === user.id)}
              onEdit={
                selectedBusiness && selectedBusiness.user_id === user.id
                  ? () => { setEditBusinessListing(selectedBusiness); setSelectedBusiness(null); setBusinessFormOpen(true); }
                  : undefined
              }
              onDelete={
                selectedBusiness && selectedBusiness.user_id === user.id
                  ? () => void handleDeleteBusiness(selectedBusiness.id)
                  : undefined
              }
            />
            <BusinessListingForm
              open={businessFormOpen}
              onOpenChange={setBusinessFormOpen}
              existingListing={editBusinessListing}
            />
          </>
        ) : null}
      </PageContainer>
    </div>
  );
}
