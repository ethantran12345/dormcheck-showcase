import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThumbImage } from '@/components/ui/thumb-image';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Building2, Heart, Loader2, MessageCircle, ShoppingBag, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoomDoorIllustration } from '@/components/illustrations/DormIllustrations';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useChat } from '@/contexts/ChatContext';
import { useDorms } from '@/hooks/useDorms';
import { useSavedDorms } from '@/hooks/useSavedDorms';
import { useSavedRoommates } from '@/hooks/useSavedRoommates';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { ListingDetailModal } from '@/components/dorm-portal/ListingDetailModalLazy';
import type { MarketplaceListing } from '@/components/dorm-portal/MarketplaceTab';
import type { RoommateProfileRow } from '@/components/roommate/RoommateCard';
import { dormSlugFromName } from '@/lib/dormSlug';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import type { Dorm } from '@/types';
import { WidgetCard } from '@/components/my-home/WidgetCard';
import { ProfilePhotoPlaceholder } from '@/components/profile/ProfilePhotoPlaceholder';

function SavedRoommatePhoto({ profile }: { profile: RoommateProfileRow }) {
  const [failedSrcs, setFailedSrcs] = useState<Record<string, boolean>>({});
  const name = profile.full_name ?? profile.display_name ?? profile.name ?? 'Roommate';
  const rawPhotos =
    Array.isArray(profile.profile_photos) && profile.profile_photos.length > 0
      ? profile.profile_photos
      : profile.avatar_url
        ? [profile.avatar_url]
        : [];
  const photos =
    rawPhotos.length > 0
      ? rawPhotos.map((u) => safeImageSrc(u)).filter((u): u is string => u != null)
      : [];

  const galleryImages = useMemo(
    () => photos.filter((src) => !failedSrcs[src]),
    [photos, failedSrcs],
  );

  useEffect(() => {
    setFailedSrcs({});
  }, [profile.id, photos.join('|')]);

  return (
    <div className="relative aspect-[3/4] overflow-hidden bg-muted/50">
      {galleryImages.length === 0 ? (
        <ProfilePhotoPlaceholder name={name} className="absolute inset-0" />
      ) : (
        <img
          src={galleryImages[0]}
          alt={name}
          className="absolute inset-0 h-full w-full object-cover object-top"
          onError={() => {
            const src = galleryImages[0];
            setFailedSrcs((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
          }}
        />
      )}
    </div>
  );
}

interface SavedHomeBandProps {
  userId: string;
  showSavedDorms?: boolean;
  showSavedRoommates?: boolean;
  /** Hide the band heading when embedded in a parent shell. */
  showTitle?: boolean;
  /** When true, render empty copy instead of null when no sections are visible. */
  showEmptyState?: boolean;
}

// Exported for the rate-label regression test: monthly-billed halls must never render a bare per-term price.
export function dormRateLine(dorm: Dorm): string {
  const periodStr = String(dorm.rent_period ?? dorm.rentPeriod ?? '').trim().toLowerCase();
  const periodLabel = periodStr === 'month' ? 'mo' : 'sem';
  return `$${(dorm.semesterRate ?? dorm.minRate ?? 0).toLocaleString()}/${periodLabel}`;
}

export function SavedHomeBand({
  userId,
  showSavedDorms = true,
  showSavedRoommates = true,
  showTitle = true,
  showEmptyState = false,
}: SavedHomeBandProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // View-as: admin DM affordances follow the previewed role.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  const { blockedUserIds } = useBlockedUserIds();
  const { openChatWithConversation } = useChat();
  const { dorms } = useDorms();
  const { t } = useTranslation();
  const { savedDormIds, toggleSave } = useSavedDorms();
  const { savedIds: savedRoommateIds, toggle: toggleSavedRoommate } = useSavedRoommates(userId);

  const savedDorms = useMemo(
    () => dorms.filter((d) => savedDormIds.has(d.id)),
    [dorms, savedDormIds],
  );

  const savedRoommateIdList = useMemo(() => Array.from(savedRoommateIds).sort(), [savedRoommateIds]);

  const { data: savedRoommateProfiles = [], isLoading: savedRoommatesLoading } = useQuery({
    queryKey: ['my-home-saved-roommate-profiles', userId, savedRoommateIdList],
    queryFn: async () => {
      if (!savedRoommateIdList.length) return [];
      const { data, error } = await supabase
        .from('roommate_profiles')
        .select(
          'id, full_name, pronouns, avatar_url, profile_photos, major, grade_level, graduation_year, graduation_semester, bio, tags, cleanliness, social_level, study_style, guests, sleep, temp, conflict_style, dealbreakers, instagram_username, snapchat_username',
        )
        .in('id', savedRoommateIdList);
      if (error) throw error;
      const byId = new Map<string, RoommateProfileRow>();
      (data ?? []).forEach((row) => byId.set(row.id, row as RoommateProfileRow));
      return savedRoommateIdList
        .map((id) => byId.get(id))
        .filter((row): row is RoommateProfileRow => row != null);
    },
    enabled: !!userId && savedRoommateIdList.length > 0,
  });

  const { data: savedListings = [], isLoading: savedListingsLoading } = useQuery({
    queryKey: ['saved_items', userId, 'listings'],
    queryFn: async (): Promise<MarketplaceListing[]> => {
      const { data: savedRows, error: savedError } = await supabase
        .from('saved_items')
        .select('item_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (savedError || !savedRows?.length) return [];
      const ids = savedRows.map((r: { item_id: string }) => r.item_id);
      const { data: listings, error } = await supabase
        .from('marketplace_listings')
        .select(
          'id, user_id, title, description, price, category, image_urls, created_at, status, condition, meetup_location, show_instagram, show_snapchat, profiles:public_profiles(full_name)',
        )
        .in('id', ids);
      if (error) return [];
      const orderMap = new Map(ids.map((id, i) => [id, i]));
      return ((listings ?? []) as MarketplaceListing[]).sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
      );
    },
    enabled: !!userId,
  });

  const savedMarketplaceItems = useMemo(
    () =>
      savedListings
        .filter((l) => l.category !== 'Sublease')
        .filter((l) => !l.user_id || !blockedUserIds.has(l.user_id)),
    [savedListings, blockedUserIds],
  );

  const [selectedSavedListing, setSelectedSavedListing] = useState<MarketplaceListing | null>(null);

  const handleMessageSeller = useCallback(
    async (listing: MarketplaceListing) => {
      if (!user) return;
      const targetUserId = listing.user_id;
      if (targetUserId === user.id) return;
      const me = user.id;
      const them = targetUserId;
      const { data: existingRows } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`,
        )
        .limit(1);
      const existing = existingRows?.[0];
      if (existing?.id) {
        openChatWithConversation(existing.id);
        return;
      }
      const p1 = me < them ? me : them;
      const p2 = me < them ? them : me;
      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_1: p1, participant_2: p2, initiated_by: me, status: 'pending' })
        .select('id')
        .single();
      if (error) {
        toast.error("Couldn't start conversation");
        return;
      }
      if (!isAdmin) {
        void apiPost('/api/notify-message-request', { conversationId: created.id }).catch((e) =>
          console.warn('[SavedHomeBand] notify-message-request failed:', e),
        );
      }
      void apiPost('/api/notify-marketplace-inquiry', { listingId: listing.id }).catch((e) =>
        console.warn('[SavedHomeBand] notify-marketplace-inquiry failed:', e),
      );
      openChatWithConversation(created.id);
    },
    [user, openChatWithConversation, isAdmin],
  );

  const handleRemoveFromFavorites = async (listing: MarketplaceListing) => {
    try {
      await supabase
        .from('saved_items')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', listing.id);
      await queryClient.invalidateQueries({ queryKey: ['saved_items', userId] });
      setSelectedSavedListing((prev) => (prev?.id === listing.id ? null : prev));
    } catch (err) {
      console.error('Remove from favorites error:', err);
      toast.error("Couldn't remove saved item");
    }
  };

  const showHousing = showSavedDorms && savedDorms.length > 0;
  const showRoommates =
    showSavedRoommates && (savedRoommatesLoading || savedRoommateProfiles.length > 0);
  const showItems = savedListingsLoading || savedMarketplaceItems.length > 0;

  if (!showHousing && !showRoommates && !showItems) {
    if (showEmptyState) {
      return <EmptyState icon={Bookmark} illustration={<RoomDoorIllustration />} title={t('common:state.nothingSaved')} description={t('common:state.nothingSavedHint')} />;
    }
    return null;
  }

  return (
    <div className="space-y-4">
      {showTitle ? (
        <h2 className="text-lg font-semibold text-foreground px-0.5">Saved</h2>
      ) : null}
      <div className="space-y-6">
        {showHousing && (
          <WidgetCard title="Saved Housing" icon={<Building2 className="h-4 w-4" />} tint="rose" accent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {savedDorms.map((dorm) => (
                <div
                  key={dorm.id}
                  className="relative rounded-lg overflow-hidden border border-border bg-card shadow-raised hover:shadow-overlay transition-all"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/housing/${dormSlugFromName(dorm.name)}`)}
                    className="w-full text-left block"
                  >
                    <div className="aspect-[4/3] overflow-hidden">
                      <ThumbImage
                        src={safeImageSrc(dorm.image)}
                        thumbWidth={400}
                        alt={dorm.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-1.5">
                      <p className="font-medium text-xs text-foreground truncate leading-tight">
                        {dorm.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {dormRateLine(dorm)}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleSave(dorm.id);
                    }}
                    className="absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-accent"
                    aria-label="Remove from saved housing"
                  >
                    <Heart className="w-4 h-4 text-[#FF6B6B] fill-[#FF6B6B]" strokeWidth={0} />
                  </button>
                </div>
              ))}
            </div>
          </WidgetCard>
        )}

        {showRoommates && (
          <WidgetCard title="Saved Roommates" icon={<Users className="h-4 w-4" />} tint="rose" accent>
            {savedRoommatesLoading && savedRoommateProfiles.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div
                className="-mx-2 overflow-x-auto overflow-y-hidden pb-1 sm:-mx-3"
                style={{ scrollbarWidth: 'thin' }}
              >
                <div className="flex gap-3 px-2 min-w-0 sm:px-3">
                  {savedRoommateProfiles.map((rp) => {
                    const name = rp.full_name ?? rp.display_name ?? rp.name ?? 'Roommate';
                    return (
                      <div
                        key={rp.id}
                        className="relative flex flex-col shrink-0 w-[140px] rounded-lg overflow-hidden border border-border bg-card shadow-raised hover:shadow-overlay"
                      >
                        <button
                          type="button"
                          onClick={() => navigate('/roommates')}
                          className="w-full text-left block flex-1 min-w-0"
                        >
                          <SavedRoommatePhoto profile={rp} />
                          <p className="p-2 font-medium text-xs text-foreground truncate leading-tight">
                            {name}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSavedRoommate(rp.id).catch(() => {
                              toast.error("Couldn't remove saved roommate");
                            });
                          }}
                          className="absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-accent"
                          aria-label="Remove from saved roommates"
                        >
                          <Heart className="w-4 h-4 text-[#FF6B6B] fill-[#FF6B6B]" strokeWidth={0} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </WidgetCard>
        )}

        {showItems && (
          <WidgetCard title="Saved Items" icon={<ShoppingBag className="h-4 w-4" />} tint="rose" accent>
            {savedListingsLoading && savedMarketplaceItems.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div
                className="-mx-2 overflow-x-auto overflow-y-hidden pb-1 sm:-mx-3"
                style={{ scrollbarWidth: 'thin' }}
              >
                <div className="flex gap-3 px-2 min-w-0 sm:px-3">
                  {savedMarketplaceItems.map((listing) => {
                    const imgUrl = safeImageSrc(listing.image_urls?.[0]) || '/placeholder.svg';
                    const price = Number(listing.price).toLocaleString('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    });
                    return (
                      <div
                        key={listing.id}
                        className={cn(
                          'relative flex flex-col shrink-0 w-[160px] rounded-card overflow-hidden border border-border bg-card shadow-flat hover:border-border hover:shadow-raised transition-all',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSavedListing(listing)}
                          className="w-full text-left block flex-1 min-w-0"
                        >
                          <div className="aspect-[4/3] overflow-hidden bg-muted/50">
                            <ThumbImage
                              src={imgUrl}
                              thumbWidth={400}
                              alt={listing.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="p-2">
                            <p className="font-medium text-xs text-foreground truncate leading-tight">
                              {listing.title}
                            </p>
                            <p className="text-foreground font-semibold text-sm mt-0.5">{price}</p>
                          </div>
                        </button>
                        {!(user && listing.user_id === user.id) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMessageSeller(listing);
                            }}
                            className="flex items-center justify-center gap-1 border-t border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Message
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRemoveFromFavorites(listing);
                          }}
                          className="absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-card shadow-raised transition-colors hover:bg-accent"
                          aria-label="Remove from saved items"
                        >
                          <Heart className="w-4 h-4 text-[#FF6B6B] fill-[#FF6B6B]" strokeWidth={0} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </WidgetCard>
        )}
      </div>

      <ListingDetailModal
        listing={selectedSavedListing}
        open={!!selectedSavedListing}
        onClose={() => setSelectedSavedListing(null)}
        onMessageSeller={handleMessageSeller}
        isOwnListing={Boolean(user && selectedSavedListing?.user_id === user.id)}
        isLoggedIn={!!user}
        onEdit={
          selectedSavedListing
            ? () => navigate(`/marketplace/edit/${selectedSavedListing.id}`)
            : undefined
        }
      />
    </div>
  );
}
