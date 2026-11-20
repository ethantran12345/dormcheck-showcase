import { useEffect } from 'react';
import { AppLoadFailed } from '@/components/AppLoadFailed';
import { useAuth } from '@/hooks/useAuth';
import { useSearchParams } from 'react-router';
import { MarketplaceTab } from '@/components/dorm-portal/MarketplaceTab';
import { PullToRefreshIndicator } from '@/components/ui/pull-to-refresh-indicator';
import { usePullToRefreshQueries } from '@/hooks/usePullToRefresh';
import { SHOW_STUDENT_BUSINESSES } from '@/lib/featureFlags';
import { RouteMeta } from '@/components/seo/RouteMeta';
import { pageTitle } from '@/lib/seo';

export default function MarketplacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'buy-sell';

  // Window-scrolled page (min-h-screen, no inner overflow box), so the hook's
  // default window listeners are correct here — no scrollRef needed.
  const { pull, refreshing } = usePullToRefreshQueries([
    'marketplace_listings',
    'saved_items',
  ]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const allowed = SHOW_STUDENT_BUSINESSES ? ['buy-sell', 'businesses'] : ['buy-sell'];
    if (tab && allowed.includes(tab)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'buy-sell');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Public route, so ProtectedRoute's profile-error gate does not cover it: a
  // signed-in student whose profile read failed would otherwise see a feed of
  // skeletons forever (its queries are tenant-scoped and never run).
  const { user, profileError, retryProfile } = useAuth();
  if (user && profileError && retryProfile) return <AppLoadFailed onRetry={retryProfile} />;

  return (
    <div className="relative min-h-screen bg-background overflow-x-hidden">
      {/* The only app-zone route a signed-out visitor may browse (App Store
          5.1.1(v)), so it is the only one that is indexable. The effect above
          always writes `?tab=…` back into the URL, and listing detail opens as
          `?listing=<id>` on this same path — the canonical collapses every one
          of those onto /marketplace. */}
      <RouteMeta title={pageTitle('Student Market')} />
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      {/* Full-bleed like Facebook Marketplace: the feed fills the content region
          edge to edge (just an outer gutter), no centered max-width column. */}
      <div className="w-full px-4 sm:px-6 lg:px-8 pt-4 pb-8 md:pt-5 md:pb-12" data-marketplace-tab={activeTab}>
        <MarketplaceTab />
      </div>
    </div>
  );
}
