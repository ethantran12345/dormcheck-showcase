import { Link } from 'react-router';
import { CalendarDays, PackagePlus, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type QuickLink = {
  id: string;
  label: string;
  Icon: LucideIcon;
  to: string;
};

/**
 * Home-as-launcher quick links: one tap from Home to the destinations that used
 * to hide behind the ⊞ menu (Roommates and Sell an item).
 * Compact icon tiles in a single row, mobile-first.
 */
export function QuickLinksRow({
  showRoommates,
  showSchedule,
}: {
  showRoommates: boolean;
  showSchedule: boolean;
}) {
  const links: QuickLink[] = [
    // Schedule keeps a working /schedule route for a direct link even when a
    // school switches it off, so this tile follows the flag, not the route.
    ...(showSchedule
      ? [{ id: 'schedule', label: 'Schedule', Icon: CalendarDays, to: '/schedule' } as QuickLink]
      : []),
    ...(showRoommates
      ? [{ id: 'roommates', label: 'Roommates', Icon: Users, to: '/roommates' } as QuickLink]
      : []),
    { id: 'sell', label: 'Sell an item', Icon: PackagePlus, to: '/marketplace?tab=buy-sell&compose=1' },
  ];

  return (
    <nav
      aria-label="Quick links"
      // Column count follows the surviving tiles so a flagged-off link leaves no
      // gap in the row.
      className={cn('grid gap-2', links.length === 2 ? 'grid-cols-2' : links.length === 3 ? 'grid-cols-3' : 'grid-cols-4')}
    >
      {links.map(({ id, label, Icon, to }) => (
        <Link
          key={id}
          to={to}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-1 py-3 text-center shadow-raised transition-colors hover:bg-muted/50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
            <Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden strokeWidth={1.75} />
          </span>
          <span className="text-xs font-semibold leading-tight text-foreground">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
