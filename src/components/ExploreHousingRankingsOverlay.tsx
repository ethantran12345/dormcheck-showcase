import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowLeft, Heart, ListOrdered, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dorm } from '@/types';
import { DormCard } from '@/components/DormCard';
import { Button } from '@/components/ui/button';
import { HousingRankingsContent } from '@/components/housing/HousingRankingsContent';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useIsMobile } from '@/hooks/use-mobile';

type RankingsSubTab = 'liked' | 'rankings';

interface ExploreHousingRankingsOverlayProps {
  savedDorms: Dorm[];
  onDormClick: (dorm: Dorm) => void;
  isSaved: (dormId: string) => boolean;
  onToggleSave: (dormId: string) => void;
  isLoggedIn: boolean;
  onClose: () => void;
  isMobile?: boolean;
  /** Which sub-tab to open on first mount. Defaults to 'liked'. */
  initialSubTab?: RankingsSubTab;
  /** Show the Rankings sub-tab. Defaults to true; pass false to show only saved (Liked) dorms. */
  showRankingsTab?: boolean;
}

export function ExploreHousingRankingsOverlay({
  savedDorms,
  onDormClick,
  isSaved,
  onToggleSave,
  isLoggedIn,
  onClose,
  isMobile = false,
  initialSubTab = 'liked',
  showRankingsTab = true,
}: ExploreHousingRankingsOverlayProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [subTab, setSubTab] = useState<RankingsSubTab>(initialSubTab);
  const isMobileHook = useIsMobile();
  const isSmallScreen = isMobile ?? isMobileHook;
  // When the Rankings tab is hidden, force the saved (Liked) view so HousingRankingsContent never mounts.
  const effectiveSubTab: RankingsSubTab = showRankingsTab ? subTab : 'liked';

  const content = (
    <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden h-full', isSmallScreen && 'bg-background w-full')}>
      <div className="shrink-0 flex-shrink-0 border-b border-border bg-card">
        <div className={cn('flex items-center gap-1.5', isSmallScreen ? 'px-2 pb-2 pt-2' : 'p-2')}>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
            aria-label={isSmallScreen ? t('housing:explore.rankingsOverlay.backToMap') : t('housing:explore.rankingsOverlay.closeSavedDorms')}
          >
            {isSmallScreen ? (
              <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            ) : (
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            )}
          </button>
          {showRankingsTab ? (
          <div className="flex min-w-0 flex-1 rounded-full bg-muted p-1">
          <button
            type="button"
            onClick={() => setSubTab('liked')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-full text-sm font-medium transition-colors',
              subTab === 'liked' ? 'bg-card text-malachite-800 shadow-raised' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Heart className={cn('w-4 h-4', subTab === 'liked' ? 'text-[#FF6B6B] fill-[#FF6B6B]' : 'text-muted-foreground fill-none stroke-muted-foreground stroke-[1.5]')} strokeWidth={subTab === 'liked' ? 0 : 1.5} />
            {t('housing:explore.rankingsOverlay.likedDorms')}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('rankings')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-full text-sm font-medium transition-colors',
              subTab === 'rankings' ? 'bg-card text-malachite-800 shadow-raised' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ListOrdered className="w-4 h-4" />
            {t('housing:explore.rankingsOverlay.rankings')}
          </button>
          </div>
          ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
            <Heart className="w-4 h-4 shrink-0 text-[#FF6B6B] fill-[#FF6B6B]" strokeWidth={0} />
            <span className="text-sm font-semibold text-foreground">{t('housing:explore.rankingsOverlay.savedDorms')}</span>
          </div>
          )}
        </div>
      </div>

      <div className={cn('flex-1 min-h-0 overflow-hidden', isSmallScreen && 'flex flex-col')}>
        <div
          className={cn(
            'overscroll-contain',
            isSmallScreen
              ? 'min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom,0px))]'
              : 'h-full overflow-y-auto',
          )}
        >
        {effectiveSubTab === 'liked' ? (
          !isLoggedIn ? (
            <div className="flex flex-col items-center justify-center h-full p-6 mt-12 min-h-[280px]">
              <Heart className="w-12 h-12 text-malachite-600/50 mb-4" />
              <h3 className="text-xl font-bold text-foreground mb-2">{t('housing:explore.rankingsOverlay.saveYourFavorites')}</h3>
              <p className="text-sm text-muted-foreground text-center max-w-xs mb-6">
                {t('housing:explore.rankingsOverlay.createProfileDesc')}
              </p>
              <Button
                className="rounded-full px-8 py-6 text-base font-bold bg-malachite-800 hover:bg-malachite-900 text-white"
                onClick={() => { navigate('/auth'); onClose(); }}
              >
                {t('housing:explore.rankingsOverlay.signInCreate')}
              </Button>
            </div>
          ) : savedDorms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 mt-12 min-h-[280px]">
              <Heart className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-lg font-medium text-muted-foreground mb-2">{t('housing:explore.rankingsOverlay.noSavedDormsYet')}</p>
              <p className="text-sm text-muted-foreground text-center max-w-xs mb-6">
                {t('housing:explore.rankingsOverlay.tapHeartToSave')}
              </p>
              <Button variant="outline" onClick={onClose}>
                {t('housing:explore.rankingsOverlay.exploreHousing')}
              </Button>
            </div>
          ) : isSmallScreen ? (
            <div className="grid grid-cols-1 gap-2 px-2 pt-1 pb-4 items-stretch [grid-auto-rows:minmax(0,1fr)]">
              {savedDorms.map((dorm) => (
                <div key={dorm.id} className="h-full min-h-0">
                  <DormCard
                    dorm={dorm}
                    dense
                    onClick={() => onDormClick(dorm)}
                    isSaved={isSaved(dorm.id)}
                    onToggleSave={onToggleSave}
                    isLoggedIn={isLoggedIn}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch [grid-auto-rows:minmax(0,1fr)]">
                {savedDorms.map((dorm) => (
                  <div key={dorm.id} className="h-full min-h-0">
                    <DormCard
                      dorm={dorm}
                      compact
                      onClick={() => onDormClick(dorm)}
                      isSaved={isSaved(dorm.id)}
                      onToggleSave={onToggleSave}
                      isLoggedIn={isLoggedIn}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <ErrorBoundary label="rankings">
            <HousingRankingsContent />
          </ErrorBoundary>
        )}
        </div>
      </div>
    </div>
  );

  if (isSmallScreen) {
    return content;
  }

  return content;
}
