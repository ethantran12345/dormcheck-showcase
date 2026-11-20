import { Radio } from 'lucide-react';
import { PageContainer } from '@/components/ui/page-container';
import { DiningToday } from '@/components/pitt/DiningToday';
import { KeyDatesCard } from '@/components/pitt/KeyDatesCard';
import { LaundryCard } from '@/components/pitt/LaundryCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useDiningToday, useLaundryRooms, useUpcomingAcademicDates } from '@/hooks/usePittCampusLive';

/**
 * Campus Live: what is happening on campus right now, from the university's own
 * public feeds. Laundry machine status, today's dining hours and menus, and the
 * registrar's upcoming dates.
 *
 * Everything here is read from Postgres, populated by the scheduled ingests in
 * api/cron/campus-*.ts. Nothing on this page calls a university endpoint
 * directly. It follows the standing rule that DormCheck renders the information
 * and Pitt keeps every action, so there is nothing to submit or change here.
 */
export default function CampusLivePage() {
  // Paint the cards once, when all three feeds have answered. Each card's
  // fixed-height skeleton resolved to a different height (rows or an empty
  // line), shifting everything below it: CLS ~0.3 on phones. Same query keys
  // as the cards (KeyDatesCard's default limit is 6), so this adds no requests.
  const laundry = useLaundryRooms();
  const dining = useDiningToday();
  const dates = useUpcomingAcademicDates(6);
  const settling = laundry.isPending || dining.isPending || dates.isPending;

  return (
    <PageContainer width="content" className="space-y-4 px-4 py-6 sm:px-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
          <Radio className="h-5 w-5 text-malachite-700" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campus Live</h1>
          <p className="text-sm text-muted-foreground">
            Laundry, dining and key dates, straight from your school's public feeds.
          </p>
        </div>
      </header>

      {settling ? (
        <div className="space-y-4" aria-busy="true" aria-hidden>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <LaundryCard />
          <DiningToday />
          <KeyDatesCard />

          <p className="px-1 text-xs text-muted-foreground">
            Source: University of Pittsburgh public feeds. Questions? Panther Central is open 24/7 at 412-648-1100.
          </p>
        </>
      )}
    </PageContainer>
  );
}
