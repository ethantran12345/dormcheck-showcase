import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, MessageCircle, RefreshCw, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBuildingResidents, useUpdateBuildingVisibility } from '@/hooks/useBuildingResidents';
import { useRoommateGroup } from '@/hooks/useRoommateGroup';
import { buildInviteLink, useRotateInviteCode } from '@/hooks/useGroupInvite';
import {
  groupBuildingResidents,
  groupResidentsByMoveInDay,
  type BuildingResidentRow,
} from '@/lib/buildingResidents';
import { parseIsoDateLocal } from '@/lib/dateUtils';
import { useStartDm } from '@/components/roommates/useStartDm';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DormPeopleTabProps {
  residenceHallName: string;
  buildingId: number;
  currentFloor: string | null;
  /** Move-in details rows from master_housing (parking, time, entrance, cart). */
  moveInRows: { label: string; value: string }[];
  moveInNotes: string | null;
}

function getInitials(name: string | null): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function formatMoveInDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Section heading for the by-arrival-day view, e.g. "Sat, Aug 22". */
function formatDayHeading(iso: string): string {
  const d = parseIsoDateLocal(iso);
  return d
    ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : iso;
}

function ResidentRow({
  resident,
  pinned,
  hideMoveIn,
  onMessage,
}: {
  resident: BuildingResidentRow;
  pinned?: boolean;
  /** Suppress the "Moving in …" subtitle part (redundant inside a day section). */
  hideMoveIn?: boolean;
  onMessage: (id: string) => void;
}) {
  const moveIn = hideMoveIn ? null : formatMoveInDate(resident.move_in_date);
  const subtitleParts = [
    resident.current_floor?.trim() ? `Floor ${resident.current_floor.trim()}` : null,
    moveIn ? `Moving in ${moveIn}` : null,
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={resident.avatar_url ?? undefined} />
        <AvatarFallback
          className={cn(
            'text-xs',
            pinned ? 'bg-foreground/10 text-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {getInitials(resident.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{resident.full_name || 'Student'}</p>
        {subtitleParts.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{subtitleParts.join(' · ')}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => onMessage(resident.id)}
        aria-label={`Message ${resident.full_name || 'student'}`}
      >
        <MessageCircle className="mr-1 h-3.5 w-3.5" />
        Message
      </Button>
    </div>
  );
}

/**
 * People & Move-in tab of the Your Dorm hub. Residents are populated passively
 * from profiles.current_dorm and listed only when they have explicitly opted in
 * (show_in_building, default off); the viewer's confirmed roommate group is
 * pinned at the top. Identity comes from the identity tier only.
 */
export function DormPeopleTab({
  residenceHallName,
  buildingId,
  currentFloor,
  moveInRows,
  moveInNotes,
}: DormPeopleTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const startDm = useStartDm();
  const { residents, isLoading } = useBuildingResidents(buildingId);
  const { roommateGroup } = useRoommateGroup(user?.id);
  const updateVisibility = useUpdateBuildingVisibility();
  const rotateInvite = useRotateInviteCode();

  const copyInviteLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteLink(code));
      toast.success('Invite link copied', { description: 'Text it to your roommate to confirm.' });
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const handleRotateInvite = (groupId: string) => {
    rotateInvite.mutate(groupId, {
      onSuccess: (newCode) => void copyInviteLink(newCode),
      onError: () => toast.error('Could not reset the link'),
    });
  };

  // Own opt-in state comes from the profiles row (the RPC intentionally does
  // not return show_in_building).
  const { data: visibility } = useQuery({
    queryKey: ['building-visibility-self', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<{ show_in_building: boolean; move_in_date: string | null } | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('show_in_building, move_in_date')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const optedIn = visibility?.show_in_building ?? false;

  const saveVisibility = (patch: { show_in_building?: boolean; move_in_date?: string | null }) => {
    updateVisibility.mutate(patch, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['building-visibility-self', user?.id] });
        // My Home derives the "See your building" setup step (and the finale
        // celebration) from profiles.show_in_building - keep it live.
        queryClient.invalidateQueries({ queryKey: ['my-home-profile', user?.id ?? ''] });
      },
      onError: () => toast.error('Could not save'),
    });
  };

  const roommateIds = useMemo(
    () => new Set((roommateGroup?.members ?? []).map((m) => m.id).filter((id) => id !== user?.id)),
    [roommateGroup, user?.id],
  );
  const grouped = useMemo(
    () => groupBuildingResidents(residents, { viewerFloor: currentFloor, roommateIds }),
    [residents, currentFloor, roommateIds],
  );
  const [viewMode, setViewMode] = useState<'floor' | 'day'>('floor');
  // Roommates render in their pinned section; day buckets cover everyone else.
  const dayGroups = useMemo(
    () => groupResidentsByMoveInDay(residents.filter((r) => !roommateIds.has(r.id))),
    [residents, roommateIds],
  );

  const handleMessage = async (targetId: string) => {
    if (!user?.id) return;
    try {
      await startDm(targetId, user.id);
    } catch {
      toast.error('Could not start the conversation');
    }
  };

  const otherRoommates = (roommateGroup?.members ?? []).filter((m) => m.id !== user?.id);
  // Roommates render in the pinned section above; the list below (and its empty
  // state) covers only non-roommate residents.
  const visibleCount = grouped.sameFloor.length + grouped.rest.length;

  return (
    <div className="space-y-4">
      {(moveInRows.length > 0 || moveInNotes) && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Move-in details
          </p>
          {moveInRows.length > 0 && (
            <dl className="space-y-2.5">
              {moveInRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="mt-0.5 text-sm text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {moveInNotes && (
            <p className="mt-3 whitespace-pre-wrap text-sm italic text-muted-foreground">{moveInNotes}</p>
          )}
        </div>
      )}

      {otherRoommates.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your roommates
          </p>
          <div className="divide-y divide-border rounded-card border border-border bg-muted/40">
            {otherRoommates.map((m) => (
              <ResidentRow
                key={m.id}
                pinned
                resident={{
                  id: m.id,
                  full_name: m.full_name,
                  avatar_url: m.avatar_url,
                  current_floor: null,
                  move_in_date: null,
                  is_self: false,
                }}
                onMessage={handleMessage}
              />
            ))}
          </div>
        </div>
      )}

      {roommateGroup?.inviteCode && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="copy-invite-link-button"
            size="sm"
            variant="outline"
            onClick={() => void copyInviteLink(roommateGroup.inviteCode!)}
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Copy roommate invite link
          </Button>
          {roommateGroup.ownerId === user?.id && (
            <Button
              data-testid="reset-invite-link-button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={rotateInvite.isPending}
              onClick={() => handleRotateInvite(roommateGroup.groupId)}
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', rotateInvite.isPending && 'animate-spin')} aria-hidden />
              Reset link
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label htmlFor="show-in-building" className="text-sm font-medium text-foreground">
              Show me to others in my building
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off by default. When on, students in {residenceHallName} can see your name and floor here.
            </p>
          </div>
          <Switch
            id="show-in-building"
            data-testid="show-in-building-switch"
            checked={optedIn}
            disabled={updateVisibility.isPending || visibility === undefined}
            onCheckedChange={(checked) => saveVisibility({ show_in_building: checked })}
          />
        </div>
        {optedIn && (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="move-in-date" className="text-sm text-foreground">
              My move-in date (optional)
            </label>
            <Input
              id="move-in-date"
              type="date"
              className="w-40"
              value={visibility?.move_in_date ?? ''}
              disabled={updateVisibility.isPending}
              onChange={(e) => saveVisibility({ move_in_date: e.target.value || null })}
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : visibleCount === 0 ? (
        <EmptyState
          icon={Users}
          title={t('roommates:people.emptyTitle')}
          description={
            optedIn
              ? t('roommates:people.emptyBodyFirst', { hall: residenceHallName })
              : t('roommates:people.emptyBody', { hall: residenceHallName })
          }
        />
      ) : (
        <div className="space-y-4">
          <div
            role="group"
            aria-label="Group residents by"
            className="flex w-fit items-center gap-1 rounded-full bg-muted p-1"
          >
            {(
              [
                { mode: 'floor', label: 'By floor' },
                { mode: 'day', label: 'By arrival day' },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  viewMode === mode
                    ? 'bg-background text-foreground shadow-raised'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {viewMode === 'day' && optedIn && !visibility?.move_in_date && (
            <p className="text-xs text-muted-foreground">
              Add your move-in date above to see who arrives with you.
            </p>
          )}
          {viewMode === 'day' &&
            dayGroups.map((group) => {
              const isYourDay =
                group.dateIso != null && group.dateIso === (visibility?.move_in_date ?? null);
              return (
                <div key={group.dateIso ?? 'tbd'}>
                  <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.dateIso ? formatDayHeading(group.dateIso) : 'Date TBD'}
                    {isYourDay && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
                        Your day
                      </span>
                    )}
                  </p>
                  <div
                    className={cn(
                      'divide-y divide-border rounded-xl border',
                      isYourDay ? 'border-foreground/30' : 'border-border',
                    )}
                  >
                    {group.residents.map((r) => (
                      <ResidentRow key={r.id} hideMoveIn resident={r} onMessage={handleMessage} />
                    ))}
                  </div>
                </div>
              );
            })}
          {viewMode === 'floor' && grouped.sameFloor.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {currentFloor?.trim() ? `Floor ${currentFloor.trim()}` : 'Your floor'}
              </p>
              <div className="divide-y divide-border rounded-xl border border-border">
                {grouped.sameFloor.map((r) => (
                  <ResidentRow key={r.id} resident={r} onMessage={handleMessage} />
                ))}
              </div>
            </div>
          )}
          {viewMode === 'floor' && grouped.rest.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Also in {residenceHallName}
              </p>
              <div className="divide-y divide-border rounded-xl border border-border">
                {grouped.rest.map((r) => (
                  <ResidentRow key={r.id} resident={r} onMessage={handleMessage} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
