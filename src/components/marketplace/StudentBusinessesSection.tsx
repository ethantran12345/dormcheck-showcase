import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Briefcase, Heart, Loader2, Search, SlidersHorizontal, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
  AdaptiveOverlayTrigger,
} from '@/components/ui/adaptive-overlay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useChat } from '@/contexts/ChatContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { BusinessListingCard } from './BusinessListingCard';
import { BusinessDetailModal } from './BusinessDetailModal';
import { BusinessListingForm } from './BusinessListingForm';
import type { Tables } from '@/integrations/supabase/types';
import { apiPost } from '@/lib/apiPost';

type BusinessListing = Tables<'business_listings'>;

const DM_DIVIDER = '━━━━━━━━━━━━━━━';

/**
 * Filter chip. Same pill in both the mobile drawer and the desktop popover, so
 * it lives in one place now and composes ToggleGroupItem (T3.5) - previously
 * four near-identical raw <button> loops.
 */
const FILTER_CHIP_CLASS =
  'h-auto min-w-0 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium ' +
  'text-foreground hover:bg-accent hover:text-foreground data-[state=on]:border-border ' +
  'data-[state=on]:bg-foreground data-[state=on]:text-background';

function BusinessFilterBody({
  sortBy,
  setSortBy,
  categoryFilter,
  setCategoryFilter,
  availableCategories,
  sortLabel,
  categoryLabel,
  allLabel,
  sortOptions,
}: {
  sortBy: 'newest' | 'az';
  setSortBy: (v: 'newest' | 'az') => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  availableCategories: string[];
  sortLabel: string;
  categoryLabel: string;
  allLabel: string;
  sortOptions: { value: 'newest' | 'az'; label: string }[];
}) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground mb-2 block">{sortLabel}</Label>
        <ToggleGroup
          type="single"
          value={sortBy}
          // Deselect-guard: a sort is always applied.
          onValueChange={(v) => { if (v) setSortBy(v as 'newest' | 'az'); }}
          className="flex flex-wrap justify-start gap-2"
        >
          {sortOptions.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} className={FILTER_CHIP_CLASS}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground mb-2 block">{categoryLabel}</Label>
        <ToggleGroup
          type="single"
          value={categoryFilter}
          // Deselect-guard: "All" is the cleared state, not an empty value.
          onValueChange={(v) => { if (v) setCategoryFilter(v); }}
          className="flex flex-wrap justify-start gap-2"
        >
          {availableCategories.map((cat) => (
            <ToggleGroupItem key={cat} value={cat} className={FILTER_CHIP_CLASS}>
              {cat === 'All' ? allLabel : cat}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </>
  );
}

function businessContextMarker(listingId: string): string {
  return `[Dormcheck:business:${listingId}]`;
}

function buildBusinessDmCard(listing: BusinessListing): string {
  const desc = listing.description?.trim();
  const snippet = desc && desc.length > 120 ? `${desc.slice(0, 120)}...` : desc;
  return [
    DM_DIVIDER,
    `🏪 ${listing.business_name}`,
    listing.category ? `Category: ${listing.category}` : null,
    snippet ? `"${snippet}"` : null,
    DM_DIVIDER,
  ].filter(Boolean).join('\n');
}

export function StudentBusinessesSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // App Store 1.2: blocked users' business listings must not surface.
  const { blockedUserIds } = useBlockedUserIds();
  // View-as: hide admin affordances while a superadmin previews as a student.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const { openChatWithConversation } = useChat();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [formOpen, setFormOpen] = useState(false);
  const [editListing, setEditListing] = useState<BusinessListing | null>(null);
  const [selectedListing, setSelectedListing] = useState<BusinessListing | null>(null);
  const [, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'az'>('newest');

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['business_listings', blockedUserIds.size],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_listings')
        .select('*')
        .eq('is_approved', true)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // App Store 1.2: a blocked user's business listings disappear too.
      return (data as BusinessListing[]).filter(
        (l) => !l.user_id || !blockedUserIds.has(l.user_id),
      );
    },
  });

  const availableCategories = useMemo(() => {
    const cats = [...new Set(listings.map((l) => l.category).filter(Boolean) as string[])].sort();
    return ['All', ...cats];
  }, [listings]);

  const { data: pendingListings = [] } = useQuery({
    queryKey: ['business_listings_pending'],
    enabled: Boolean(isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_listings')
        .select('*')
        .eq('is_approved', false)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as BusinessListing[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('business_listings')
        .update({ is_approved: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business_listings'] });
      void queryClient.invalidateQueries({ queryKey: ['business_listings_pending'] });
      toast.success(t('marketplace:business.section.toast.approved'));
    },
    onError: () => toast.error(t('marketplace:business.section.toast.approveError')),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('business_listings')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business_listings_pending'] });
      toast.success(t('marketplace:business.section.toast.rejected'));
    },
    onError: () => toast.error(t('marketplace:business.section.toast.rejectError')),
  });

  const { data: savedIds = [] } = useQuery({
    queryKey: ['saved_businesses', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from('saved_businesses')
        .select('business_listing_id')
        .eq('user_id', user!.id);
      return (data ?? []).map((r) => r.business_listing_id);
    },
  });
  const savedIdSet = new Set(savedIds);

  const filteredListings = useMemo(() => {
    let result = listings;
    if (showSavedOnly) result = result.filter((l) => savedIds.includes(l.id));
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (l) =>
          l.business_name.toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          (l.category ?? '').toLowerCase().includes(q),
      );
    }
    if (categoryFilter !== 'All') result = result.filter((l) => l.category === categoryFilter);
    if (sortBy === 'az') {
      result = [...result].sort((a, b) => a.business_name.localeCompare(b.business_name));
    } else {
      result = [...result].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return result;
  }, [listings, savedIds, showSavedOnly, searchQuery, categoryFilter, sortBy]);

  const clearAllFilters = useCallback(() => {
    setCategoryFilter('All');
    setSortBy('newest');
  }, []);

  // Identical filter controls in the mobile drawer and the desktop popover.
  const renderFilterBody = () => (
    <BusinessFilterBody
      sortBy={sortBy}
      setSortBy={setSortBy}
      categoryFilter={categoryFilter}
      setCategoryFilter={setCategoryFilter}
      availableCategories={availableCategories}
      sortLabel={t('marketplace:business.section.sortBy')}
      categoryLabel={t('marketplace:business.form.fields.category')}
      allLabel={t('marketplace:business.section.categoryAll')}
      sortOptions={[
        { value: 'newest', label: t('marketplace:business.section.sortNewest') },
        { value: 'az', label: t('marketplace:business.section.sortAz') },
      ]}
    />
  );

  const toggleSave = useCallback(
    async (listingId: string) => {
      if (!user?.id) {
        toast(t('marketplace:business.section.toast.signInSave'));
        navigate('/auth');
        return;
      }
      const isSaved = savedIdSet.has(listingId);
      try {
        if (isSaved) {
          await supabase.from('saved_businesses').delete().eq('user_id', user.id).eq('business_listing_id', listingId);
        } else {
          await supabase.from('saved_businesses').insert({ user_id: user.id, business_listing_id: listingId });
        }
        await queryClient.invalidateQueries({ queryKey: ['saved_businesses', user.id] });
      } catch {
        toast.error(t('marketplace:myItems.toast.saveBusinessError'));
      }
    },
    [user, savedIdSet, queryClient, navigate, t],
  );

  const handleMessageSeller = useCallback(
    async (listing: BusinessListing) => {
      if (!user) {
        toast(t('marketplace:business.section.toast.signInMessage'));
        navigate('/auth');
        return;
      }
      if (listing.user_id === user.id) {
        toast.error(t('marketplace:business.section.toast.messageSelf'));
        return;
      }

      const me = user.id;
      const them = listing.user_id;
      const { data: existingRows } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`)
        .limit(1);

      const existing = existingRows?.[0];
      const conversationAlreadyExisted = Boolean(existing?.id);
      let conversationId = existing?.id;

      if (!conversationId) {
        const p1 = me < them ? me : them;
        const p2 = me < them ? them : me;
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({ participant_1: p1, participant_2: p2, initiated_by: me, status: 'pending' })
          .select('id')
          .single();
        if (error || !created?.id) {
          toast.error(t('marketplace:business.section.toast.conversationError'));
          return;
        }
        conversationId = created.id;
      }

      const marker = businessContextMarker(listing.id);
      let shouldInsertContext = true;
      if (conversationAlreadyExisted) {
        const { data: priorContextRows } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .or(`content.ilike.%${marker}%,content.ilike.%[Dormcheck:business:${listing.id}]%`)
          .limit(1);
        shouldInsertContext = !priorContextRows?.length;
      }

      if (shouldInsertContext) {
        const contextBody = buildBusinessDmCard(listing);
        const contextMessage = `${contextBody}\n\n${marker}`;
        try {
          const { error: msgError } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: me,
            content: contextMessage,
          });
          if (msgError) throw msgError;
          if (!isAdmin) {
            void apiPost('/api/notify-message-request', { conversationId }).catch(() => {});
          }
        } catch (e) {
          console.warn('[StudentBusinesses] send context failed:', e);
        }
      }

      if (isMobile) {
        navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`);
      } else {
        openChatWithConversation(conversationId);
      }
    },
    [user, isAdmin, isMobile, navigate, openChatWithConversation, t],
  );

  const handleDelete = useCallback(
    async (listingId: string) => {
      setDeletingId(listingId);
      try {
        const { error } = await supabase.from('business_listings').delete().eq('id', listingId);
        if (error) throw error;
        toast.success(t('marketplace:myItems.toast.listingDeleted'));
        await queryClient.invalidateQueries({ queryKey: ['business_listings'] });
        await queryClient.invalidateQueries({ queryKey: ['my_business_listings'] });
        if (selectedListing?.id === listingId) setSelectedListing(null);
      } catch {
        toast.error(t('marketplace:myItems.toast.deleteError'));
      } finally {
        setDeletingId(null);
      }
    },
    [queryClient, selectedListing, t],
  );

  const handleListClick = () => {
    if (!user) {
      toast(t('marketplace:business.section.toast.signInList'));
      navigate('/auth');
      return;
    }
    setEditListing(null);
    setFormOpen(true);
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 w-full">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground mb-1">{t('marketplace:business.section.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('marketplace:business.section.subtitle')}</p>
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/50"
            onClick={() => navigate('/marketplace/my-items', { state: { tab: 'businesses' } })}
          >
            <Briefcase className="h-4 w-4" />
            {t('marketplace:myItems.tabs.businesses')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!user) {
                toast(t('marketplace:business.section.toast.signInSaved'));
                return;
              }
              setShowSavedOnly((v) => !v);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors',
              showSavedOnly
                ? 'border-border bg-foreground text-background hover:opacity-90'
                : 'border-border text-foreground hover:bg-muted/50',
            )}
            aria-label={t('marketplace:business.section.savedAria')}
          >
            <Heart
              className={cn(
                'h-4 w-4 shrink-0',
                showSavedOnly ? 'fill-background text-background' : 'fill-none stroke-foreground stroke-[1.5]',
              )}
              strokeWidth={showSavedOnly ? 0 : 1.5}
            />
            {t('common:state.saved')}
          </button>
          <button
            type="button"
            onClick={handleListClick}
            // KEEP: primary CTA for this screen (list your business), earned green
            className="flex items-center gap-1.5 rounded-full bg-malachite-800 px-4 py-2 text-sm font-medium text-white hover:bg-malachite-900"
          >
            <Plus className="h-4 w-4" />
            {t('marketplace:myItems.businessEmpty.listButton')}
          </button>
        </div>

        {/* Mobile actions - same row pattern as the marketplace tabs */}
        <div className="md:hidden w-full shrink-0">
          <div className="flex gap-2 px-4 pt-3">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border py-2 text-sm text-foreground"
              onClick={() => navigate('/marketplace/my-items', { state: { tab: 'businesses' } })}
              aria-label={t('marketplace:myItems.tabs.businesses')}
            >
              <Briefcase className="h-4 w-4" />
              {t('marketplace:myItems.tabs.businesses')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  toast(t('marketplace:business.section.toast.signInSaved'));
                  return;
                }
                setShowSavedOnly((v) => !v);
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-sm transition-colors',
                showSavedOnly
                  ? 'border-border bg-foreground text-background'
                  : 'border-border text-foreground',
              )}
              aria-label={t('marketplace:business.section.savedAria')}
            >
              <Heart
                className={cn(
                  'h-4 w-4 shrink-0',
                  showSavedOnly
                    ? 'fill-background text-background'
                    : 'fill-none stroke-foreground stroke-[1.5] text-foreground',
                )}
                strokeWidth={showSavedOnly ? 0 : 1.5}
              />
              {t('common:state.saved')}
            </button>
          </div>
          <div className="px-4 pt-2 pb-3">
            <button
              type="button"
              onClick={handleListClick}
              // KEEP: primary CTA for this screen (mobile variant of list-your-business)
              className="flex w-full items-center justify-center gap-2 rounded-full bg-malachite-800 py-2.5 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              {t('marketplace:myItems.businessEmpty.listButton')}
            </button>
          </div>
        </div>
      </div>

      {!isLoading && listings.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] mt-4 mb-6">
          <div className="flex gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder={t('marketplace:business.section.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 w-full text-base pl-12 rounded-xl border-border bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary" // KEEP: interaction-only focus ring
              />
            </div>
            {isMobile ? (
              <AdaptiveOverlay open={filtersOpen} onOpenChange={setFiltersOpen} shouldScaleBackground={false} mobileVariant="drawer">
                <AdaptiveOverlayTrigger asChild>
                  <Button
                    variant="outline"
                    className="relative h-12 shrink-0 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-none hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground"
                  >
                    <SlidersHorizontal className="h-5 w-5 shrink-0" />
                    {t('marketplace:business.section.filters')}
                    {categoryFilter !== 'All' && (
                      <span
                        className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-foreground border-2 border-card"
                        aria-hidden
                      />
                    )}
                  </Button>
                </AdaptiveOverlayTrigger>
                <AdaptiveOverlayContent priority className="max-h-[85vh] h-auto w-full rounded-t-xl bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] pb-4">
                  <div className="flex flex-col">
                    <AdaptiveOverlayHeader className="flex flex-row items-center justify-between p-4 pb-0 shrink-0">
                      <AdaptiveOverlayTitle>{t('marketplace:business.section.filters')}</AdaptiveOverlayTitle>
                      <Button
                        type="button"
                        variant="link"
                        onClick={clearAllFilters}
                        className="h-auto p-0 text-sm font-medium text-foreground"
                      >
                        {t('marketplace:business.section.clearAll')}
                      </Button>
                    </AdaptiveOverlayHeader>
                    <div className="overflow-y-auto px-4 py-4 pr-6 space-y-4">
                      {renderFilterBody()}
                    </div>
                  </div>
                </AdaptiveOverlayContent>
              </AdaptiveOverlay>
            ) : (
              // Desktop: Popover, not a hand-rolled `fixed inset-0` tap-away
              // scrim + absolutely positioned panel (T3.5). Escape, outside-click
              // dismissal, focus return and collision-aware placement are free.
              <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="relative h-12 shrink-0 gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-none hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground"
                  >
                    <SlidersHorizontal className="h-5 w-5 shrink-0" />
                    {t('marketplace:business.section.filters')}
                    {categoryFilter !== 'All' && (
                      <span
                        className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-foreground border-2 border-card"
                        aria-hidden
                      />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  sideOffset={8}
                  className="max-h-[70vh] w-[400px] overflow-y-auto rounded-xl border border-border bg-popover p-4 shadow-overlay scrollbar-thin"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">{t('marketplace:business.section.filters')}</h3>
                    <Button
                      type="button"
                      variant="link"
                      onClick={clearAllFilters}
                      className="h-auto p-0 text-sm text-foreground"
                    >
                      {t('marketplace:business.section.clearAll')}
                    </Button>
                  </div>
                  <div className="space-y-4 pr-2">{renderFilterBody()}</div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {isAdmin && pendingListings.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/40 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {t('marketplace:business.section.pendingReviewCount', { n: pendingListings.length })}
            </span>
          </div>
          <div className="space-y-3">
            {pendingListings.map((listing) => (
              <div
                key={listing.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-amber-100 bg-card p-3 dark:border-amber-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground truncate">{listing.business_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{listing.category}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{listing.description}</p>
                  {listing.price_range && (
                    <p className="text-xs text-muted-foreground mt-0.5">{listing.price_range}</p>
                  )}
                  {listing.instagram_handle && (
                    <p className="text-xs text-muted-foreground mt-0.5">@{listing.instagram_handle}</p>
                  )}
                  {listing.website_url && (
                    <p className="text-xs text-muted-foreground mt-0.5">{listing.website_url}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="rounded-full bg-foreground text-background hover:opacity-90 text-xs px-3 h-7"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(listing.id)}
                  >
                    {t('marketplace:business.section.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full border-red-200 text-red-600 hover:bg-red-50 text-xs px-3 h-7"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(listing.id)}
                  >
                    {t('marketplace:business.section.reject')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('marketplace:business.section.loading')}</p>
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={Store}
          title={t('marketplace:business.section.emptyTitle')}
          description={t('marketplace:business.section.emptySubtitle')}
          action={
            <button
              type="button"
              onClick={handleListClick}
              // KEEP: primary CTA for this screen (empty-state variant of list-your-business)
              className="inline-flex items-center gap-2 rounded-full bg-malachite-800 px-4 py-2 text-sm font-medium text-white hover:bg-malachite-900"
            >
              <Plus className="h-4 w-4" />
              {t('marketplace:myItems.businessEmpty.listButton')}
            </button>
          }
        />
      ) : filteredListings.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('marketplace:business.section.noMatchTitle')}
          description={t('marketplace:business.section.noMatchSubtitle')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredListings.map((listing) => (
            <BusinessListingCard
              key={listing.id}
              listing={listing}
              isSaved={savedIdSet.has(listing.id)}
              onToggleSave={() => void toggleSave(listing.id)}
              currentUserId={user?.id ?? null}
              onEdit={
                user?.id === listing.user_id
                  ? () => { setEditListing(listing); setFormOpen(true); }
                  : undefined
              }
              onDelete={
                user?.id === listing.user_id
                  ? () => void handleDelete(listing.id)
                  : undefined
              }
              onClick={() => setSelectedListing(listing)}
              onMessage={() => void handleMessageSeller(listing)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <BusinessDetailModal
        listing={selectedListing}
        open={!!selectedListing}
        onClose={() => setSelectedListing(null)}
        isSaved={selectedListing ? savedIdSet.has(selectedListing.id) : false}
        onToggleSave={() => { if (selectedListing) void toggleSave(selectedListing.id); }}
        isOwner={Boolean(user && selectedListing?.user_id === user.id)}
        onEdit={
          user && selectedListing?.user_id === user.id
            ? () => { setEditListing(selectedListing); setSelectedListing(null); setFormOpen(true); }
            : undefined
        }
        onDelete={
          user && selectedListing?.user_id === user.id
            ? () => { void handleDelete(selectedListing!.id); }
            : undefined
        }
        onMessage={
          selectedListing && user && selectedListing.user_id !== user.id
            ? () => void handleMessageSeller(selectedListing)
            : undefined
        }
      />

      {/* Listing Form */}
      <BusinessListingForm
        open={formOpen}
        onOpenChange={setFormOpen}
        existingListing={editListing}
      />
    </>
  );
}
