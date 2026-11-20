import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Dorm } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useDorms } from '@/hooks/useDorms';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DormCommunityTab } from '@/components/my-home/DormCommunityTab';
import { DormPeopleTab } from '@/components/my-home/DormPeopleTab';
import { PageContainer } from '@/components/ui/page-container';

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Dedicated home for a resident's building community. Holds the Community
 * (building/floor chats + shared group links) and People & Move-in
 * (residents, visibility, move-in logistics) tabs that used to live inside the
 * Your Dorm card on /my-home - moved out so the card stays down to essentials.
 * Reachable at /my-home/dorm?tab=community|people.
 */
export default function DormHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const { dorms, isLoading: dormsLoading } = useDorms();
  const { building: myBuilding, isLoading: buildingLoading } = useCurrentUserBuilding();
  const { showBuildingChats } = useFeatureFlags();

  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<'community' | 'people'>(
    requestedTab === 'people' ? 'people' : 'community',
  );
  useEffect(() => {
    if (requestedTab === 'people' || requestedTab === 'community') setTab(requestedTab);
  }, [requestedTab]);

  // Profile carries the resident's floor (for the People tab's floor grouping)
  // and current_dorm (to resolve the Dorm record for move-in details).
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['dorm-hub-profile', user?.id ?? ''],
    enabled: !!user?.id,
    queryFn: async (): Promise<{
      current_dorm: string | null;
      current_floor: string | null;
      housing_type: string | null;
    } | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('current_dorm, current_floor, housing_type')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const currentDorm = useMemo<Dorm | null>(() => {
    const name = (profile?.current_dorm ?? '').trim();
    if (!name) return null;
    const lower = name.toLowerCase();
    const exact = dorms.find((d) => d.name.trim().toLowerCase() === lower);
    if (exact) return exact;
    // Building units (e.g. "Bouquet Gardens A/B/C/D") share one dorm record -
    // match on the base name with a trailing single-letter unit suffix stripped.
    const stripUnit = (s: string) => s.trim().toLowerCase().replace(/\s+[a-z]$/i, '').trim();
    const base = stripUnit(name);
    return dorms.find((d) => stripUnit(d.name) === base) ?? null;
  }, [dorms, profile?.current_dorm]);

  const moveInRows = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    if (!currentDorm) return rows;
    if (nonEmpty(currentDorm.moveInParkingLot)) rows.push({ label: 'Parking', value: currentDorm.moveInParkingLot.trim() });
    if (nonEmpty(currentDorm.moveInTimeWindow)) rows.push({ label: 'Time', value: currentDorm.moveInTimeWindow.trim() });
    if (nonEmpty(currentDorm.moveInEntrance)) rows.push({ label: 'Entrance', value: currentDorm.moveInEntrance.trim() });
    if (nonEmpty(currentDorm.moveInCartLocation)) rows.push({ label: 'Cart pickup', value: currentDorm.moveInCartLocation.trim() });
    return rows;
  }, [currentDorm]);
  const moveInNotes = nonEmpty(currentDorm?.moveInNotes) ? currentDorm!.moveInNotes!.trim() : null;

  const loading = profileLoading || buildingLoading || dormsLoading;
  const hallName = myBuilding?.residenceHallName ?? currentDorm?.name ?? 'your building';
  // The tabs need a resolved on-campus building; otherwise there is no community
  // to show (mirrors the widget's showHubTabs gate).
  const showTabs =
    showBuildingChats && myBuilding?.buildingId != null && profile?.housing_type === 'on-campus';

  return (
    <div className="min-h-screen bg-background">
      <PageContainer as="main" id="main-content" width="content" className="px-4 py-6 pb-12 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            onClick={() => navigate('/my-home')}
            aria-label="Back to My Home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">{hallName}</h1>
            <p className="text-sm text-muted-foreground">Your building community</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-10 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
          </div>
        ) : !showTabs || !myBuilding ? (
          <EmptyState
            icon={Building2}
            title={t('housing:emptyStates.communityTitle')}
            description={t('housing:emptyStates.communityBody')}
            action={
              <Button variant="outline" onClick={() => navigate('/my-home')}>
                {t('housing:emptyStates.communityCta')}
              </Button>
            }
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'community' | 'people')} className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-0 rounded-full bg-muted p-1">
              <TabsTrigger
                value="community"
                className="rounded-full py-2 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-raised data-[state=inactive]:text-muted-foreground"
              >
                Community
              </TabsTrigger>
              <TabsTrigger
                value="people"
                className="rounded-full py-2 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-raised data-[state=inactive]:text-muted-foreground"
              >
                People &amp; Move-in
              </TabsTrigger>
            </TabsList>
            <TabsContent value="community" className="mt-4 focus-visible:outline-none">
              <DormCommunityTab buildingId={myBuilding.buildingId} residenceHallName={hallName} />
            </TabsContent>
            <TabsContent value="people" className="mt-4 focus-visible:outline-none">
              <DormPeopleTab
                buildingId={myBuilding.buildingId}
                residenceHallName={hallName}
                currentFloor={profile?.current_floor ?? null}
                moveInRows={moveInRows}
                moveInNotes={moveInNotes}
              />
            </TabsContent>
          </Tabs>
        )}
      </PageContainer>
    </div>
  );
}
