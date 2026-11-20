import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Home, ListChecks, Users } from 'lucide-react';
import { ReadinessRing } from '@/components/my-home/ReadinessRing';
import { MY_HOME_CARD, SectionHeading } from '@/components/my-home/cardSystem';
import { cn } from '@/lib/utils';

export interface GlanceRoommate {
  full_name: string | null;
}

/**
 * At-a-glance cards under the journey strip. One code path, driven by state:
 * before the dorm is set every card is an invitation (never a bare "0" or an
 * empty chart); once populated they show the checklist mini-ring and the
 * roommate group. `entranceDelay` staggers the data cards in during the
 * fill-in choreography.
 */
export function GlanceRow({
  populated,
  checklist,
  roommates,
  showRoommates,
  onSetDorm,
  entranceDelay = 0,
}: {
  populated: boolean;
  checklist: { packed: number; total: number; pct: number; nextItem: string | null };
  roommates: { members: GlanceRoommate[]; unread: number };
  showRoommates: boolean;
  onSetDorm: () => void;
  entranceDelay?: number;
}) {
  const roommateHref = showRoommates ? '/roommates' : '/roommates/us?confirm=1';
  const hasGroup = roommates.members.length >= 2;

  return (
    <section aria-label="At a glance">
      <SectionHeading title={populated ? 'At a glance' : 'Start with one of these'} />
      <div className={cn('grid grid-cols-1 gap-3', populated ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {populated ? (
          <>
            <GlanceCard index={0} entranceDelay={entranceDelay} swapKey="data">
              <Link to="/checklist" className="flex h-full items-center gap-4 focus-visible:outline-none">
                {checklist.total > 0 ? (
                  <ReadinessRing
                    pct={checklist.pct}
                    size={56}
                    strokeWidth={16}
                    label={`Checklist ${checklist.pct}% packed`}
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center text-muted-foreground">
                    <ListChecks className="h-6 w-6" aria-hidden />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Checklist
                  </span>
                  <span className="mt-0.5 block truncate text-lg font-extrabold text-foreground">
                    {checklist.total > 0
                      ? `${checklist.packed} / ${checklist.total}`
                      : 'Plan what to bring'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {checklist.total === 0
                      ? 'Start your list ›'
                      : checklist.nextItem
                        ? `Next: ${checklist.nextItem}`
                        : 'All packed 🎉'}
                  </span>
                </span>
              </Link>
            </GlanceCard>
            <GlanceCard index={1} entranceDelay={entranceDelay} swapKey="data">
              <Link
                to={hasGroup ? '/messages' : roommateHref}
                className="flex h-full items-center gap-4 focus-visible:outline-none"
              >
                {hasGroup ? (
                  <span className="flex" aria-hidden>
                    {roommates.members.slice(0, 3).map((m, i) => (
                      <span
                        key={i}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-muted text-[13px] font-bold text-foreground',
                          i > 0 && '-ml-3',
                        )}
                      >
                        {initials(m.full_name)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center text-muted-foreground">
                    <Users className="h-6 w-6" aria-hidden />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Roommates
                  </span>
                  <span className="mt-0.5 block truncate text-lg font-extrabold text-foreground">
                    {hasGroup ? groupLabel(roommates.members) : 'Find your people'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {hasGroup
                      ? roommates.unread > 0
                        ? `${roommates.unread} new ${roommates.unread === 1 ? 'message' : 'messages'}`
                        : 'Say hi in the group chat ›'
                      : 'Match before move-in ›'}
                  </span>
                </span>
              </Link>
            </GlanceCard>
          </>
        ) : (
          <>
            <InviteCard
              index={0}
              icon={<Home className="h-6 w-6" aria-hidden />}
              label="Housing"
              title="Set your dorm"
              onClick={onSetDorm}
            />
            <InviteCard
              index={1}
              icon={<Users className="h-6 w-6" aria-hidden />}
              label="Community"
              title="Add roommates"
              href={roommateHref}
            />
            <InviteCard
              index={2}
              icon={<ListChecks className="h-6 w-6" aria-hidden />}
              label="Get ready"
              title="Start checklist"
              href="/checklist"
            />
          </>
        )}
      </div>
    </section>
  );
}

function GlanceCard({
  children,
  index,
  entranceDelay,
  swapKey,
  className,
}: {
  children: ReactNode;
  index: number;
  entranceDelay: number;
  swapKey: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      key={swapKey}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: entranceDelay + index * 0.08 }}
      className={cn(
        MY_HOME_CARD,
        'min-h-[104px] p-4 transition-shadow hover:shadow-raised focus-within:ring-2 focus-within:ring-malachite-600',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function InviteCard({
  index,
  icon,
  label,
  title,
  href,
  onClick,
}: {
  index: number;
  icon: ReactNode;
  label: string;
  title: string;
  href?: string;
  onClick?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const content = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="mt-0.5 block text-sm font-extrabold text-foreground">{title}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
  const cardClass =
    'flex min-h-[88px] w-full items-center gap-3.5 rounded-card border border-dashed border-border bg-card p-4 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600';
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: index * 0.06 }}
    >
      {href ? (
        <Link to={href} className={cardClass}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cardClass}>
          {content}
        </button>
      )}
    </motion.div>
  );
}

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function groupLabel(members: GlanceRoommate[]): string {
  const others = members.length - 1;
  if (others === 1) {
    const other = members[1]?.full_name?.trim().split(/\s+/)[0];
    return other ? `You + ${other}` : 'You + 1 roommate';
  }
  return `You + ${others} roommates`;
}
