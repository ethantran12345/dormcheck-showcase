import { Capacitor } from '@capacitor/core';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MoveInTabPanel, MoveOutTabPanel } from '@/components/checklist/LogisticsPanel';
import { PageContainer } from '@/components/ui/page-container';
import { useGroupSurface } from '@/hooks/useGroupSurface';
import { GroupSurfaceModals } from '@/components/collaborate/GroupSurfaceModals';

type LogisticsTab = 'movein' | 'moveout';

/* Which panel to show is driven by the `?tab=` param (sidebar sub-items on
 * desktop); mobile gets an in-page Move In / Move Out toggle below the
 * Get-Ready cluster chips. */

/**
 * Logistics: Move In + Move Out, pulled out of the Shop/Checklist group into
 * their own page/route (`/logistics`). The panels are the same self-contained
 * components ChecklistPage used to render inline - they source everything from
 * hooks/contexts (`useUniversity`, `useMoveOutDate`, ...), so mounting them here
 * needs no ChecklistPage-local state. Old `/checklist?tab=movein|moveout` links
 * redirect here (see AppRoutes).
 */
export default function LogisticsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: LogisticsTab = searchParams.get('tab') === 'moveout' ? 'moveout' : 'movein';
  // The group is a year-long concern, not a checklist tab: the roommates you
  // move in with in August are the ones you move out with in April, so both
  // Logistics tabs read the same surface the checklist does (PRD §5b.3).
  const group = useGroupSurface();

  const setTab = (next: LogisticsTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className={cn('min-h-screen max-w-full bg-background')}>
      {/* xl:max-w-6xl is deliberate: the move-in/move-out panels below become a
          two-column board at xl, and the header rail must track the body it labels. */}
      <PageContainer as="header" width="content" className="bg-background px-4 py-3 md:px-8 md:py-4 xl:max-w-6xl">
        {/* Native: title is scrolling page content (sits by the pill, scrolls away). */}
        {Capacitor.isNativePlatform() && (
          <h1 className="mb-3 truncate pr-28 text-2xl font-semibold leading-tight text-foreground">
            {t('misc:nav.logistics')}
          </h1>
        )}
        {!Capacitor.isNativePlatform() && (
          <h1 className="sr-only">{t('misc:nav.logistics')}</h1>
        )}
        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(v) => {
            // Single-select segmented control: always keep one panel active.
            if (v) setTab(v as LogisticsTab);
          }}
          aria-label={t('misc:nav.logistics')}
          className="inline-flex gap-0 rounded-full border border-border bg-muted p-1 md:hidden"
        >
          {(['movein', 'moveout'] as const).map((key) => (
            <ToggleGroupItem
              key={key}
              value={key}
              className={cn(
                'h-auto min-w-0 rounded-full px-4 py-1.5 text-sm font-semibold leading-none text-muted-foreground transition-colors',
                'data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-raised',
              )}
            >
              {t(key === 'movein' ? 'misc:nav.moveIn' : 'misc:nav.moveOut')}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PageContainer>

      <GroupSurfaceModals group={group} bannerClassName="px-4 md:px-8" />

      {/* xl:max-w-6xl — see the header above; the panels go two-column at xl. */}
      <PageContainer width="content" className="px-4 pb-8 md:px-8 xl:max-w-6xl">
        {tab === 'movein' ? <MoveInTabPanel /> : <MoveOutTabPanel />}
      </PageContainer>
    </div>
  );
}
