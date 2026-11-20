import { Dorm, RoomPhoto } from '@/types';
import { ArrowLeft, LayoutGrid, Sparkles, Heart, MapPin } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '@/hooks/useAnalytics';
import { dormSlugFromName } from '@/lib/dormSlug';
import { useLocation, useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { OverviewTab } from './dorm-portal/OverviewTab';
import { StudentSetupsTab } from './dorm-portal/StudentSetupsTab';
import { DormCard } from '@/components/DormCard';
import { HorizontalScrollCarousel } from '@/components/ui/horizontal-scroll-carousel';
import { useSavedDorms } from '@/hooks/useSavedDorms';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DormDetailProps {
  dorm: Dorm;
  photos: RoomPhoto[];
  onBack: () => void;
  onViewMap?: () => void;
  allDorms?: Dorm[];
  onDormSelect?: (dorm: Dorm) => void;
}

type DormDetailTab = 'overview' | 'setups';

export function DormDetail({ dorm, onBack, onViewMap, allDorms, onDormSelect }: DormDetailProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { track } = useAnalytics();
  const { isSaved, toggleSave, isLoggedIn } = useSavedDorms();
  const location = useLocation();
  const { t } = useTranslation();
  // Deep links (e.g. Room Gallery's "Post your setup") can land directly on the
  // setups tab via ?tab=setups.
  const [activeTab, setActiveTab] = useState<DormDetailTab>(() =>
    new URLSearchParams(location.search).get('tab') === 'setups' ? 'setups' : 'overview',
  );
  const tabBarRef = useRef<HTMLDivElement>(null);
  const handleTabChange = useCallback((value: string) => {
    const next = value === 'overview' || value === 'setups' ? value : 'overview';
    setActiveTab(next);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    });
  }, []);

  const [selectedBuilding, setSelectedBuilding] = useState<string | undefined>(
    dorm.subBuildings?.[0]?.letter
  );
  const isDormSaved = isSaved(dorm.id);
  
  const handleHeartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!isLoggedIn) {
      navigate('/auth');
      return;
    }
    
    toggleSave(dorm.id);
  };

  // Get the currently selected sub-building data
  const selectedSubBuilding = dorm.subBuildings?.find(b => b.letter === selectedBuilding);

  // Scroll to top when building ID or view changes so the hero and title are visible
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [dorm.id]);

  useEffect(() => {
    const dormIdNum = Number(dorm.id);
    track('dorm_viewed', {
      dorm_id: Number.isFinite(dormIdNum) ? dormIdNum : dorm.id,
      dorm_slug: dormSlugFromName(dorm.name),
    });
  }, [dorm.id, dorm.name, track]);

  return (
    <div className="min-h-screen pb-24 animate-fade-in bg-background">
      {/* 1. Immersive Top - full-bleed hero that owns its own back/save controls.
          #root carries the safe-area top padding; the hero cancels it with a negative
          top margin so the photo runs under the status bar with no white sliver, then
          adds the same inset back as padding so the controls clear the notch. The
          controls are positioned INSIDE the hero (no sticky element with a
          hand-computed negative bottom margin to keep in sync). */}
      <div className="relative w-full overflow-clip mt-[calc(-1_*_env(safe-area-inset-top))] h-[calc(30vh_+_env(safe-area-inset-top))] md:h-[42vh]">
        <img
          src={safeImageSrc(dorm.image) || '/placeholder.svg'}
          alt={dorm.name}
          className="h-full w-full object-cover"
        />
        {/* Top scrim - keeps the glass controls legible over a bright sky. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/35 to-transparent" />
        {/* Bottom scrim - blends the hero into the content below so there's no hard cut. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

        {/* Back / save - pinned to the true top corners of the photo, one circular
            glass button per side (the standard listing-detail pattern). */}
        {/* md:pt-16 drops the row below the desktop shell's fixed top-right
            account cluster (AppShellTopRight, top-2.5), which covered Save. */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)_+_0.5rem))] md:pt-16">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label={t('housing:detail.ariaBackToExplore')}
            className="h-10 w-10 rounded-pill border border-white/25 bg-black/25 text-white shadow-raised backdrop-blur-md hover:bg-black/40 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleHeartClick}
            aria-label={isDormSaved ? t('housing:detail.ariaRemoveFromSaved') : t('housing:detail.ariaSaveThisHall')}
            className="h-10 w-10 rounded-pill border border-white/25 bg-black/25 text-white shadow-raised backdrop-blur-md hover:bg-black/40 hover:text-white"
          >
            <Heart
              className={cn(
                'h-5 w-5 transition-transform',
                isDormSaved ? 'scale-110 text-[#FF6B6B] fill-[#FF6B6B]' : 'fill-none stroke-current',
              )}
              strokeWidth={isDormSaved ? 0 : 2.25}
            />
          </Button>
        </div>

        {/* Title overlay */}
        <div className="absolute bottom-4 left-4 right-4 z-10 md:bottom-6 md:left-8 md:right-8">
          <h1 className="font-display text-2xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] md:text-4xl">{dorm.name}</h1>
          {dorm.address && (
            <p className="mt-1 hidden items-center gap-1.5 text-sm text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] md:flex">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              {dorm.address}
            </p>
          )}
        </div>
      </div>

      {/* Building Selector - flush with content, shares the hero/tabs surface */}
      {dorm.subBuildings && dorm.subBuildings.length > 0 && (
        <div
          className={cn(
            'w-full max-w-7xl mx-auto py-4',
            isMobile ? 'px-4' : 'px-6 md:px-12',
          )}
        >
          <label htmlFor="dorm-building-select" className="block text-sm font-medium text-muted-foreground mb-2">
            {t('housing:detail.buildingSelector.label')}
          </label>
          <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
            <SelectTrigger id="dorm-building-select" className="w-full bg-card border-border">
              <SelectValue placeholder={t('housing:detail.buildingSelector.placeholder')} />
            </SelectTrigger>
            <SelectContent className="bg-card border-border z-[100]">
              {dorm.subBuildings.map((building) => (
                <SelectItem key={building.letter} value={building.letter}>
                  {t('housing:detail.buildingSelector.building', { letter: building.letter })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tab Bar - scrolls with the page (non-sticky). */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div
          ref={tabBarRef}
          className="w-full"
        >
          <div className={cn('w-full border-b border-border', isMobile ? 'px-4' : 'px-6 md:px-12')}>
            {/* Underline tabs, not a capsule. `!rounded-none` / `!shadow-none` are
                deliberate: TabsTrigger's base carries `rounded-pill` +
                `data-[state=active]:shadow-raised`, and `rounded-pill` is a custom
                radius key tailwind-merge does not fold into the `rounded-*` group,
                so a plain `rounded-none` loses to stylesheet order. */}
            <TabsList className="flex h-auto w-full rounded-none bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className={cn(
                'flex flex-1 items-center justify-center gap-2 !rounded-none !shadow-none px-4 py-3.5',
                '-mb-px border-b-2 border-transparent transition-colors',
                'text-sm font-semibold text-muted-foreground hover:text-foreground',
                'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary',
              )}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
              {t('housing:detail.tabs.overview')}
            </TabsTrigger>
            <TabsTrigger
              value="setups"
              className={cn(
                'flex flex-1 items-center justify-center gap-2 !rounded-none !shadow-none px-4 py-3.5',
                '-mb-px border-b-2 border-transparent transition-colors',
                'text-sm font-semibold text-muted-foreground hover:text-foreground',
                'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary',
              )}
            >
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              {t('housing:detail.tabs.setups')}
            </TabsTrigger>
          </TabsList>
          </div>
        </div>

        {/* 2. Content - About, Room Rates, Map, Amenities (wider layout) */}
        <div className={cn('max-w-7xl mx-auto', isMobile ? 'px-4' : 'px-6 md:px-12')}>
          <TabsContent value="overview" className="m-0 scroll-mt-[120px]">
            <OverviewTab dorm={dorm} selectedSubBuilding={selectedSubBuilding} onViewMap={onViewMap} />
          </TabsContent>

          <TabsContent value="setups" className="m-0 py-4 pb-20 scroll-mt-[120px]">
            <StudentSetupsTab
              dormName={dorm.name}
              dormId={selectedSubBuilding?.id ?? (dorm.id ? Number(dorm.id) : undefined)}
              dorm={dorm}
              selectedSubBuilding={selectedSubBuilding}
            />
          </TabsContent>

        </div>

        {/* 3. More to explore - same max-w-7xl + horizontal padding as tab panels */}
        {activeTab === 'overview' && allDorms && allDorms.length > 0 && (
          <div
            className={cn(
              'w-full border-t border-border pb-8',
              isMobile ? 'mt-8 pt-6' : 'mt-12 pt-10',
            )}
          >
            <div className={cn('max-w-7xl mx-auto', isMobile ? 'px-4' : 'px-6 md:px-12')}>
              <h2
                className={cn(
                  'font-semibold text-foreground',
                  isMobile ? 'text-base tracking-tight mb-4' : 'text-2xl font-bold mb-6',
                )}
              >
                {t('housing:detail.moreToExplore')}
              </h2>
              <HorizontalScrollCarousel className="w-full pb-2">
                {allDorms
                  .filter((d) => d.id !== dorm.id)
                  .slice(0, 10)
                  .map((otherDorm) => (
                    // Plain wrapper: DormCard already carries the open control
                    // and "Save dorm". This used to be a role="button" div
                    // AROUND them (axe nested-interactive), a second tab stop
                    // for the same action.
                    <div key={otherDorm.id} className="transition-opacity hover:opacity-95">
                      <DormCard
                        dorm={otherDorm}
                        onClick={() => {
                          if (onDormSelect) {
                            onDormSelect(otherDorm);
                            window.scrollTo({ top: 0, behavior: 'instant' });
                          }
                        }}
                        isSaved={isSaved(otherDorm.id)}
                        onToggleSave={toggleSave}
                        isLoggedIn={isLoggedIn}
                      />
                    </div>
                  ))}
              </HorizontalScrollCarousel>
            </div>
          </div>
        )}
      </Tabs>
    </div>
  );
}
