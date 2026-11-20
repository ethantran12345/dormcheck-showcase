import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, ShoppingBag, HelpCircle, Camera, Sparkles, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { dormSlugFromName } from '@/lib/dormSlug';
import { cn } from '@/lib/utils';
import { WidgetCard } from './WidgetCard';
import { WIDGET_EMPTY_CTA } from './cardSystem';
import { timeAgo } from './timeAgo';

interface ActivityFeedWidgetProps {
  currentDormName: string | null;
  currentDormId: string | null;
  userId: string;
}

type ActivityType = 'marketplace' | 'question' | 'setup';

interface ActivityItem {
  type: ActivityType;
  id: string;
  title: string;
  created_at: string;
  link: string;
}

const STALE_TIME_MS = 60_000;

const TYPE_LABEL: Record<ActivityType, string> = {
  marketplace: 'New listing',
  question: 'New question',
  setup: 'New room setup',
};

const TYPE_ICON: Record<ActivityType, typeof ShoppingBag> = {
  marketplace: ShoppingBag,
  question: HelpCircle,
  setup: Camera,
};

function parseDormIdNumber(currentDormId: string | null): number | null {
  if (!currentDormId) return null;
  const n = Number.parseInt(currentDormId, 10);
  return Number.isFinite(n) ? n : null;
}

export function ActivityFeedWidget({
  currentDormName,
  currentDormId,
}: ActivityFeedWidgetProps) {
  const navigate = useNavigate();
  // App Store 1.2: a blocked user's listings and room setups must not appear
  // in the home activity feed either.
  const { blockedUserIds } = useBlockedUserIds();
  const dormSlug = currentDormName ? dormSlugFromName(currentDormName) : null;
  const dormPortalLink = dormSlug ? `/campus/${dormSlug}` : '/campus';
  const dormIdNum = parseDormIdNumber(currentDormId);
  const dormNameLower = (currentDormName ?? '').trim().toLowerCase();

  // Query A - recent marketplace listings, client-side filtered by dorm.
  const { data: marketplaceItems = [], isLoading: marketplaceLoading } = useQuery({
    queryKey: ['activity-marketplace', dormNameLower, blockedUserIds.size],
    enabled: !!dormNameLower,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase
        .from('marketplace_listings')
        // user_id is selected only to drop blocked sellers (App Store 1.2).
        .select('id, title, created_at, meetup_location, building_name, user_id')
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      type Row = {
        id: string;
        title: string;
        created_at: string;
        meetup_location: string | null;
        building_name: string | null;
        user_id: string | null;
      };
      const matched = ((data ?? []) as Row[]).filter((row) => {
        if (row.user_id && blockedUserIds.has(row.user_id)) return false;
        const m = (row.meetup_location ?? '').toLowerCase();
        const b = (row.building_name ?? '').toLowerCase();
        return m.includes(dormNameLower) || b.includes(dormNameLower);
      });
      return matched.slice(0, 4).map((row) => ({
        type: 'marketplace',
        id: String(row.id),
        title: row.title,
        created_at: row.created_at,
        link: '/marketplace',
      }));
    },
  });

  // Query B - recent dorm questions for the user's dorm.
  const { data: questionItems = [], isLoading: questionsLoading } = useQuery({
    queryKey: ['activity-questions', dormIdNum ?? 'none', blockedUserIds.size],
    enabled: dormIdNum != null,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase
        .from('dorm_questions')
        // user_id is selected only to drop blocked authors (App Store 1.2).
        // Over-fetch so that filtering cannot starve the 4-item feed.
        .select('id, question, created_at, dorm_id, user_id')
        .eq('dorm_id', dormIdNum as number)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      type Row = { id: string; question: string; created_at: string; user_id: string | null };
      return ((data ?? []) as Row[])
        .filter((row) => !(row.user_id && blockedUserIds.has(row.user_id)))
        .slice(0, 4)
        .map((row) => ({
          type: 'question' as const,
          id: row.id,
          title: row.question,
          created_at: row.created_at,
          link: dormPortalLink,
        }));
    },
  });

  // Query C - recent student setups for the user's dorm.
  const { data: setupItems = [], isLoading: setupsLoading } = useQuery({
    queryKey: ['activity-setups', dormIdNum ?? 'none', dormNameLower, blockedUserIds.size],
    enabled: dormIdNum != null || !!dormNameLower,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase
        .from('student_setups')
        // user_id is selected only to drop blocked authors (App Store 1.2).
        // Over-fetch so that filtering cannot starve the 4-item feed.
        .select('id, created_at, dorm_id, dorm_name, caption, user_id')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      type Row = {
        id: number;
        created_at: string | null;
        dorm_id: number | null;
        dorm_name: string;
        caption: string | null;
        user_id: string | null;
      };
      const matched = ((data ?? []) as Row[]).filter((row) => {
        if (row.user_id && blockedUserIds.has(row.user_id)) return false;
        if (dormIdNum != null && row.dorm_id != null && row.dorm_id === dormIdNum) {
          return true;
        }
        if (dormNameLower && (row.dorm_name ?? '').toLowerCase() === dormNameLower) {
          return true;
        }
        return false;
      });
      return matched.slice(0, 4).map((row) => ({
        type: 'setup',
        id: String(row.id),
        title: (row.caption ?? '').trim() || 'New room setup',
        created_at: row.created_at ?? new Date(0).toISOString(),
        link: dormPortalLink,
      }));
    },
  });

  const merged = useMemo<ActivityItem[]>(() => {
    const all = [...marketplaceItems, ...questionItems, ...setupItems];
    all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return all.slice(0, 8);
  }, [marketplaceItems, questionItems, setupItems]);

  const isLoading =
    !!currentDormName &&
    (marketplaceLoading || questionsLoading || setupsLoading);

  return (
    <WidgetCard
      title="Recent activity in your dorm"
      icon={<Activity className="h-4 w-4" />}
      accent
    >
      {!currentDormName ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center py-6">
          <Building2
            className="h-10 w-10 text-muted-foreground/40 mb-3"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            Set your dorm to see activity here
          </p>
          <button
            type="button"
            onClick={() => navigate('/profile/edit')}
            className={cn('mt-3', WIDGET_EMPTY_CTA)}
          >
            Update dorm
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                <div className="h-3 w-20 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : merged.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center py-6">
          <Sparkles
            className="h-10 w-10 text-muted-foreground/40 mb-3"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            Nothing new in your dorm yet. Be the first to post.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => navigate(dormPortalLink)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Ask a question
            </button>
            <button
              type="button"
              onClick={() => navigate('/marketplace')}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Sell something
            </button>
            <button
              type="button"
              onClick={() => navigate(dormPortalLink)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Share your setup
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {merged.map((item) => {
            const Icon = TYPE_ICON[item.type];
            return (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                onClick={() => navigate(item.link)}
                aria-label={`${TYPE_LABEL[item.type]}: ${item.title}`}
                className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-border hover:bg-muted/50"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {TYPE_LABEL[item.type]} · {timeAgo(item.created_at)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}
