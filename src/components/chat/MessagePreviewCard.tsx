import { useState, type ReactNode } from 'react';
import { ThumbImage } from '@/components/ui/thumb-image';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withListingContact } from '@/lib/marketplaceContact';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { ListingDetailModal } from '@/components/dorm-portal/ListingDetailModalLazy';
import { BusinessDetailModal } from '@/components/marketplace/BusinessDetailModal';
import { RoommateDetailModal } from '@/components/roommate/RoommateDetailModal';
import {
  ROOMMATE_PROFILE_SELECT,
  type RoommateProfileRow,
} from '@/components/roommate/RoommateCard';
import {
  RoommatePostDetail,
  type ProfileEmbed,
  type RoommateSearchPost,
} from '@/components/roommates/FindingRoommates';
import type { MarketplaceListing } from '@/types/marketplace';
import type { Tables } from '@/integrations/supabase/types';
import type { MessageContextType } from '@/lib/messageContext';
import { SHOW_STUDENT_BUSINESSES } from '@/lib/featureFlags';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

type BusinessListing = Tables<'business_listings'>;

const LISTING_PREVIEW_SELECT =
  'id, user_id, title, description, price, category, image_urls, created_at, status, condition, meetup_location, price_negotiable, payment_methods, show_instagram, show_snapchat, show_phone, profiles:public_profiles(full_name)';

const ROOMMATE_POST_EMBED_SELECT = `
  id,
  user_id,
  post_type,
  content,
  budget_max,
  address,
  housing_type,
  move_in_semester,
  spots_total,
  spots_filled,
  is_active,
  interest_count,
  created_at,
  updated_at,
  utilities_included,
  is_furnished,
  parking_available,
  gender_preference,
  additional_details,
  photos,
  show_instagram,
  show_snapchat,
  show_phone,
  profiles:roommate_profiles!roommate_search_posts_user_id_fkey (
    full_name,
    avatar_url,
    major,
    grade_level,
    current_dorm,
    preferred_areas
  )
`;

interface MessagePreviewCardProps {
  marker: { type: MessageContextType; id: string };
  isMe: boolean;
}

function unwrapProfile(embed: ProfileEmbed | ProfileEmbed[] | null | undefined): ProfileEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

async function fetchListingPreview(id: string): Promise<MarketplaceListing | null> {
  const { data, error } = await supabase
    .from('marketplace_listings')
    .select(LISTING_PREVIEW_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  // Seller contact comes from the opt-out-masked view (SEC-6).
  return withListingContact((data as MarketplaceListing | null) ?? null);
}

async function fetchBusinessPreview(id: string): Promise<BusinessListing | null> {
  const { data, error } = await supabase
    .from('business_listings')
    .select('*')
    .eq('id', id)
    .eq('is_approved', true)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function fetchProfilePreview(id: string): Promise<RoommateProfileRow | null> {
  const { data, error } = await supabase
    .from('roommate_profiles')
    .select(ROOMMATE_PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as RoommateProfileRow | null) ?? null;
}

async function fetchPostPreview(id: string): Promise<RoommateSearchPost | null> {
  const { data, error } = await supabase
    .from('roommate_search_posts')
    .select(ROOMMATE_POST_EMBED_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  // `data as unknown as` bridge: supabase-js can't type a view-embed made through
  // a base-table FK hint (roommate_profiles!roommate_search_posts_user_id_fkey),
  // so `profiles` infers as SelectQueryError. The embed resolves correctly at
  // runtime (verified against PostgREST). No relationship metadata exists for the
  // view, unlike public_profiles.
  return (data as unknown as RoommateSearchPost | null) ?? null;
}

function isMarkerTypeGated(type: MessageContextType, showRoommates: boolean): boolean {
  if ((type === 'profile' || type === 'post') && !showRoommates) return true;
  if (type === 'business' && !SHOW_STUDENT_BUSINESSES) return true;
  return false;
}

function previewOwnerId(
  type: MessageContextType,
  markerId: string,
  data: MarketplaceListing | BusinessListing | RoommateProfileRow | RoommateSearchPost,
): string | null {
  switch (type) {
    case 'profile':
      return markerId || null;
    case 'post':
      return (data as RoommateSearchPost).user_id ?? null;
    case 'listing':
      return (data as MarketplaceListing).user_id ?? null;
    case 'business':
      return (data as BusinessListing).user_id ?? null;
    default:
      return null;
  }
}

function unavailableMessage(type: MessageContextType, t: TFunction): string {
  switch (type) {
    case 'business':
      return t('messaging:preview.unavailable.business');
    case 'profile':
      return t('messaging:preview.unavailable.profile');
    case 'post':
      return t('messaging:preview.unavailable.post');
    default:
      return t('messaging:preview.unavailable.listing');
  }
}

function PreviewShell({ isMe, children }: { isMe: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}>
      <div className="mb-1.5 w-full max-w-[16rem]">{children}</div>
    </div>
  );
}

function LoadingCard({ isMe }: { isMe: boolean }) {
  return (
    <PreviewShell isMe={isMe}>
      <div className="overflow-hidden rounded-xl border border-border bg-muted shadow-raised animate-pulse">
        <div className="aspect-[4/3] w-full bg-muted" />
        <div className="space-y-2 px-3 py-2">
          <div className="h-3.5 w-4/5 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
        </div>
      </div>
    </PreviewShell>
  );
}

function UnavailableCard({ isMe, message }: { isMe: boolean; message: string }) {
  return (
    <PreviewShell isMe={isMe}>
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {message}
      </div>
    </PreviewShell>
  );
}

function PreviewImage({ src }: { src: string | null }) {
  if (src) {
    return <ThumbImage src={src} thumbWidth={600} alt="" className="aspect-[4/3] w-full object-cover bg-muted" />;
  }
  return <div className="aspect-[4/3] w-full bg-muted" />;
}

function ListingPreviewBody({ listing }: { listing: MarketplaceListing }) {
  const { t } = useTranslation();
  const coverUrl = listing.image_urls?.[0] ?? null;

  return (
    <>
      <PreviewImage src={coverUrl} />
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium text-foreground">
          {listing.title?.trim() || t('messaging:preview.fallback.listing')}
        </p>
        <p className="text-sm font-semibold text-primary">${listing.price}</p>
        {listing.category?.trim() ? (
          <p className="text-xs capitalize text-muted-foreground">{listing.category.trim()}</p>
        ) : null}
        {listing.condition?.trim() ? (
          <p className="text-xs text-muted-foreground">
            {t('messaging:preview.condition', { value: listing.condition.trim() })}
          </p>
        ) : null}
      </div>
    </>
  );
}

function BusinessPreviewBody({ listing }: { listing: BusinessListing }) {
  const { t } = useTranslation();
  const imageUrl = listing.logo_url?.trim() || listing.banner_image_url?.trim() || null;

  return (
    <>
      <PreviewImage src={imageUrl} />
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium text-foreground">
          {listing.business_name?.trim() || t('messaging:preview.fallback.business')}
        </p>
        {listing.category?.trim() ? (
          <p className="text-xs text-muted-foreground">{listing.category.trim()}</p>
        ) : listing.description?.trim() ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{listing.description.trim()}</p>
        ) : null}
      </div>
    </>
  );
}

function ProfilePreviewBody({ profile }: { profile: RoommateProfileRow }) {
  const photos = Array.isArray(profile.profile_photos) ? profile.profile_photos : [];
  const imageUrl = photos[0]?.trim() || profile.avatar_url?.trim() || null;
  const name = profile.full_name?.trim() || 'Student';
  const yearLabel =
    profile.grade_level?.trim() ||
    (profile.graduation_year != null ? String(profile.graduation_year) : '');
  const subtitle = [profile.major?.trim(), yearLabel].filter(Boolean).join(' · ');
  const bio = profile.bio?.trim();

  return (
    <>
      <PreviewImage src={imageUrl} />
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{name}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        {bio ? <p className="line-clamp-1 text-xs text-muted-foreground">{bio}</p> : null}
      </div>
    </>
  );
}

function postPreviewTitle(post: RoommateSearchPost, t: TFunction): string {
  const maybeTitle = (post as RoommateSearchPost & { title?: string | null }).title?.trim();
  return maybeTitle || t('messaging:preview.fallback.roommatePost');
}

function PostPreviewBody({ post }: { post: RoommateSearchPost }) {
  const { t } = useTranslation();
  const author = unwrapProfile(post.profiles);
  const imageUrl = post.photos?.[0]?.trim() || author?.avatar_url?.trim() || null;
  const authorName = author?.full_name?.trim() || 'Student';

  return (
    <>
      <PreviewImage src={imageUrl} />
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{postPreviewTitle(post, t)}</p>
        <p className="text-xs text-muted-foreground">{authorName}</p>
      </div>
    </>
  );
}

export function MessagePreviewCard({ marker, isMe }: MessagePreviewCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { blockedUserIds } = useBlockedUserIds();
  const { showRoommates } = useFeatureFlags();
  const isMobile = useIsMobile();
  const [modalOpen, setModalOpen] = useState(false);
  const gated = isMarkerTypeGated(marker.type, showRoommates);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dm-preview', marker.type, marker.id],
    enabled: !!marker.id && !gated,
    queryFn: async () => {
      switch (marker.type) {
        case 'listing':
          return fetchListingPreview(marker.id);
        case 'business':
          return fetchBusinessPreview(marker.id);
        case 'profile':
          return fetchProfilePreview(marker.id);
        case 'post':
          return fetchPostPreview(marker.id);
        default:
          return null;
      }
    },
  });

  if (gated) {
    return <UnavailableCard isMe={isMe} message={unavailableMessage(marker.type, t)} />;
  }

  if (isLoading) {
    return <LoadingCard isMe={isMe} />;
  }

  if (isError || !data) {
    return <UnavailableCard isMe={isMe} message={unavailableMessage(marker.type, t)} />;
  }

  const ownerId = previewOwnerId(marker.type, marker.id, data);
  if (ownerId && blockedUserIds.has(ownerId)) {
    return null;
  }

  const listing = marker.type === 'listing' ? (data as MarketplaceListing) : null;
  const business = marker.type === 'business' ? (data as BusinessListing) : null;
  const profile = marker.type === 'profile' ? (data as RoommateProfileRow) : null;
  const post = marker.type === 'post' ? (data as RoommateSearchPost) : null;

  return (
    <>
      <PreviewShell isMe={isMe}>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full overflow-hidden rounded-xl border border-border bg-card text-left shadow-raised transition-shadow hover:shadow-overlay cursor-pointer"
        >
          {listing ? <ListingPreviewBody listing={listing} /> : null}
          {business ? <BusinessPreviewBody listing={business} /> : null}
          {profile ? <ProfilePreviewBody profile={profile} /> : null}
          {post ? <PostPreviewBody post={post} /> : null}
        </button>
      </PreviewShell>

      {listing ? (
        <ListingDetailModal
          listing={listing}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          isOwnListing={Boolean(user && listing.user_id === user.id)}
          isLoggedIn={!!user}
        />
      ) : null}

      {business ? (
        <BusinessDetailModal
          listing={business}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          isSaved={false}
          onToggleSave={() => {}}
          isOwner={Boolean(user && business.user_id === user.id)}
        />
      ) : null}

      {profile ? (
        <RoommateDetailModal
          profile={profile}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          isOwnProfile={Boolean(user && profile.id === user.id)}
        />
      ) : null}

      {post ? (
        <RoommatePostDetail
          post={post}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          isMobile={isMobile}
          isMine={Boolean(user && post.user_id === user.id)}
          hasMyInterest={false}
          onEdit={() => {}}
          onDeactivate={() => {}}
          onOpenInterests={() => {}}
          interestCount={post.interest_count ?? 0}
        />
      ) : null}
    </>
  );
}
