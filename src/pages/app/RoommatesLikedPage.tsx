import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Heart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSavedRoommates } from '@/hooks/useSavedRoommates';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChat } from '@/contexts/ChatContext';
import { supabase } from '@/integrations/supabase/client';
import {
  RoommateCard,
  ROOMMATE_PROFILE_SELECT,
  type RoommateProfileRow,
} from '@/components/roommate/RoommateCard';
import { RoommateDetailModal } from '@/components/roommate/RoommateDetailModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { apiPost } from '@/lib/apiPost';

export default function RoommatesLikedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  const { blockedUserIds } = useBlockedUserIds();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { openChatWithConversation } = useChat();

  const fromTab = useMemo(() => {
    const s = (location.state ?? {}) as Record<string, unknown>;
    const t = s?.fromTab;
    return t === 'match' || t === 'browse' ? t : 'browse';
  }, [location.state]);

  const { savedIdList, toggle } = useSavedRoommates(user?.id);
  const [selectedProfile, setSelectedProfile] = useState<RoommateProfileRow | null>(null);

  const { data: likedProfiles = [], isLoading } = useQuery({
    queryKey: ['favorite_roommate_profiles', user?.id, savedIdList],
    queryFn: async (): Promise<RoommateProfileRow[]> => {
      if (!user?.id || savedIdList.length === 0) return [];
      const { data, error } = await supabase
        .from('roommate_profiles')
        .select(ROOMMATE_PROFILE_SELECT)
        .in('id', savedIdList);
      if (error) return [];
      const byId = new Map<string, RoommateProfileRow>();
      ((data ?? []) as unknown as RoommateProfileRow[]).forEach((r) => byId.set(r.id, r));
      return savedIdList.map((id) => byId.get(id)).filter(Boolean) as RoommateProfileRow[];
    },
    enabled: !!user?.id && savedIdList.length > 0,
  });

  const visibleLikedProfiles = useMemo(
    () => likedProfiles.filter((p) => !p.id || !blockedUserIds.has(p.id)),
    [likedProfiles, blockedUserIds],
  );

  const handleClose = () => {
    navigate('/roommates', { state: { roommateTab: fromTab } });
  };

  const handleMessageRoommate = async (profile: RoommateProfileRow) => {
    if (!user) {
      toast.error(t('roommates:liked.signInRequired'), {
        description: t('roommates:liked.signInToMessage'),
      });
      navigate('/auth');
      return;
    }
    const targetUserId = profile.id;
    if (!targetUserId) return;
    if (targetUserId === user.id) {
      toast.error(t('roommates:liked.cantMessageSelf'));
      return;
    }
    const me = user.id;
    const them = targetUserId;
    const { data: existingRows } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_1.eq.${me},participant_2.eq.${them}),and(participant_1.eq.${them},participant_2.eq.${me})`)
      .limit(1);
    const existing = existingRows?.[0];
    if (existing?.id) {
      if (isMobile) {
        navigate(`/messages?conversation=${encodeURIComponent(existing.id)}`);
      } else {
        openChatWithConversation(existing.id);
      }
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
      console.error('Create conversation error:', error);
      toast.error(t('roommates:liked.couldNotStartConversation'));
      return;
    }
    if (!isAdmin) {
      void apiPost('/api/notify-message-request', { conversationId: created.id }).catch((e) => console.warn('[RoommatesLikedPage] notify-message-request failed:', e));
    }
    if (isMobile) {
      navigate(`/messages?conversation=${encodeURIComponent(created.id)}`);
    } else {
      openChatWithConversation(created.id);
    }
  };

  // Close modal when the selected profile is unliked
  useEffect(() => {
    if (selectedProfile && !visibleLikedProfiles.some((p) => p.id === selectedProfile.id)) {
      setSelectedProfile(null);
    }
  }, [selectedProfile, visibleLikedProfiles]);

  const handleToggleFavorite = async (e: React.MouseEvent, prospectId: string) => {
    e.stopPropagation();
    if (!user) {
      toast.error(t('roommates:liked.signInRequired'), { description: t('roommates:liked.signInToSave') });
      navigate('/auth');
      return;
    }
    try {
      await toggle(prospectId);
      queryClient.invalidateQueries({ queryKey: ['favorite_roommate_profiles'] });
    } catch {
      toast.error(t('roommates:liked.favoriteUpdateFailed'), {
        description: t('roommates:liked.unableToUpdate'),
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="w-full px-4 sm:px-8 py-6 pb-8 md:pb-12">
        {/* Header pinned to top, left-aligned */}
        <div className="flex items-start justify-between gap-4 z-10 bg-background pt-2 pb-4 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-border/50 shadow-[0_1px_0_0_var(--border)]">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Heart className="w-6 h-6 text-muted-foreground shrink-0" strokeWidth={1.75} />
              {t('roommates:liked.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 text-left">
              {t('roommates:liked.subtitle')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-full shrink-0"
            onClick={handleClose}
            aria-label={t('roommates:liked.backAriaLabel')}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {!user ? (
          <Card className="mt-8 rounded-2xl border p-6">
            <p className="text-sm text-muted-foreground">
              {t('roommates:liked.signInMessage')}
            </p>
            <div className="mt-4">
              <Button onClick={() => navigate('/auth')}>{t('common:actions.continue')}</Button>
            </div>
          </Card>
        ) : isLoading && visibleLikedProfiles.length === 0 ? (
          <Card className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">
            {t('roommates:liked.loading')}
          </Card>
        ) : visibleLikedProfiles.length === 0 ? (
          <Card className="mt-8 rounded-2xl border p-6 text-sm text-muted-foreground">
            {t('roommates:liked.empty')}
          </Card>
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-8">
            {visibleLikedProfiles.map((profile) => {
              const isOwnProfile = !!user && profile.id === user.id;
              return (
                <RoommateCard
                  key={profile.id}
                  profile={profile}
                  onClick={() => setSelectedProfile(profile)}
                  isOwnProfile={isOwnProfile}
                  isFavorite={true}
                  onToggleFavorite={(e) => handleToggleFavorite(e, profile.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      <RoommateDetailModal
        profile={selectedProfile}
        open={!!selectedProfile}
        onClose={() => setSelectedProfile(null)}
        onMessage={handleMessageRoommate}
        isOwnProfile={!!selectedProfile && !!user && selectedProfile.id === user.id}
      />
    </div>
  );
}
