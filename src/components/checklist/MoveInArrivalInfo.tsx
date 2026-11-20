import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  ArrowRight,
  ExternalLink,
  X,
} from 'lucide-react';
import {
  AdaptiveOverlay,
  AdaptiveOverlayClose,
  AdaptiveOverlayContent,
  AdaptiveOverlayDescription,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
} from '@/components/ui/adaptive-overlay';
import { Button } from '@/components/ui/button';
import {
  ARRIVAL_LINKS,
  CHECKING_IN,
  HOUSING_ASSIGNMENT_STEPS,
  MOVE_IN_FAQS,
  PACKING_LIST,
  PREPARE_RESOURCES,
  SETTLING_IN_RESOURCES,
  UNIVERSITY_PROVIDES,
  WELCOME_STATION_HOURS,
  WELCOME_WEEK,
  WHAT_TO_EXPECT,
} from '@/data/moveInArrival';

export type TileId = 'assignment' | 'pack' | 'provides' | 'day' | 'welcomeweek' | 'faqs' | 'resources';

function PackGroups({ groups }: { groups: Array<{ category: string; items: string[] }> }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.category}</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{g.items.join(' · ')}</p>
        </div>
      ))}
    </div>
  );
}

function LinkList({ items }: { items: { label: string; description: string; href: string }[] }) {
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <a
          key={r.href}
          href={r.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{r.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      ))}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

/** Title + one-line subtitle shown for each open guide drawer. */
function getDrawerMeta(t: (key: string, opts?: Record<string, string>) => string): Record<TileId, { title: string; description: string }> {
  return {
    assignment: { title: t('checklist:arrival.assignmentTitle'), description: t('checklist:arrival.assignmentDrawerDesc') },
    pack: { title: t('checklist:arrival.packTitle'), description: t('checklist:arrival.packDrawerDesc') },
    provides: { title: t('checklist:arrival.providesTitle'), description: t('checklist:arrival.providesDrawerDesc') },
    day: { title: t('checklist:arrival.dayTitle'), description: t('checklist:arrival.dayDrawerDesc') },
    welcomeweek: { title: t('checklist:arrival.welcomeWeekDrawerTitle', { dates: WELCOME_WEEK.dates }), description: WELCOME_WEEK.intro },
    faqs: { title: t('checklist:arrival.faqsDrawerTitle'), description: t('checklist:arrival.faqsDrawerDesc') },
    resources: { title: t('checklist:arrival.resourcesDrawerTitle'), description: t('checklist:arrival.resourcesDrawerDesc') },
  };
}

function DrawerBody({ id }: { id: TileId }) {
  const { t } = useTranslation();
  switch (id) {
    case 'assignment':
      return (
        <div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            {HOUSING_ASSIGNMENT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Button asChild className="mt-4 w-full bg-foreground font-semibold text-background hover:opacity-90">
            <a href={ARRIVAL_LINKS.myPitt} target="_blank" rel="noopener noreferrer">
              {t('checklist:arrival.openMyPitt')}
              <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
            </a>
          </Button>
        </div>
      );

    case 'pack':
      return (
        <div>
          <PackGroups groups={PACKING_LIST} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t('checklist:arrival.packHelp')}
          </p>
          <Button asChild className="mt-4 w-full bg-foreground font-semibold text-background hover:opacity-90">
            <Link to="/checklist?tab=checklist">
              {t('checklist:arrival.trackInChecklist')}
              <ArrowRight className="ml-2 h-4 w-4 opacity-90" aria-hidden />
            </Link>
          </Button>
        </div>
      );

    case 'provides':
      return (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">
          {UNIVERSITY_PROVIDES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );

    case 'day':
      return (
        <div className="space-y-5">
          <div className="space-y-3">
            {WHAT_TO_EXPECT.map((e) => (
              <div key={e.title}>
                <p className="text-sm font-medium text-foreground">{e.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{e.body}</p>
              </div>
            ))}
          </div>

          <div>
            <SubHeading>{t('checklist:arrival.checkingInHeading')}</SubHeading>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{CHECKING_IN.intro}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {t('checklist:arrival.mapsNote')}
            </p>
          </div>

          <div>
            <SubHeading>{t('checklist:arrival.welcomeStationHours')}</SubHeading>
            <ul className="mt-1 space-y-0.5 text-sm text-foreground">
              {WELCOME_STATION_HOURS.map((h) => (
                <li key={h.dates} className="flex flex-wrap justify-between gap-x-3">
                  <span>{h.dates}</span>
                  <span className="text-muted-foreground">{h.time}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">{t('checklist:arrival.movingCarts')}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{CHECKING_IN.carts}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">{t('checklist:arrival.wristbands')}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{CHECKING_IN.wristbands}</p>
          </div>
        </div>
      );

    case 'welcomeweek':
      return (
        <div className="space-y-4">
          <div>
            <SubHeading>{t('checklist:arrival.requiredEvents')}</SubHeading>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
              {WELCOME_WEEK.required.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <div>
            <SubHeading>{t('checklist:arrival.highlights')}</SubHeading>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {WELCOME_WEEK.highlights.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <Button asChild className="w-full bg-foreground font-semibold text-background hover:opacity-90">
            <a href={WELCOME_WEEK.scheduleUrl} target="_blank" rel="noopener noreferrer">
              {t('checklist:arrival.fullScheduleExperiencePitt')}
              <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
            </a>
          </Button>
        </div>
      );

    case 'faqs':
      return (
        <div className="space-y-4">
          {MOVE_IN_FAQS.map((cat) => (
            <div key={cat.category}>
              <SubHeading>{cat.category}</SubHeading>
              <div className="mt-1.5 space-y-2.5">
                {cat.items.map((f) => (
                  <div key={f.q}>
                    <p className="text-sm font-medium text-foreground">{f.q}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );

    case 'resources':
      return (
        <div className="space-y-4">
          <div>
            <SubHeading>{t('checklist:arrival.beforeArrive')}</SubHeading>
            <div className="mt-1.5">
              <LinkList items={PREPARE_RESOURCES} />
            </div>
          </div>
          <div>
            <SubHeading>{t('checklist:arrival.afterMoveIn')}</SubHeading>
            <div className="mt-1.5">
              <LinkList items={SETTLING_IN_RESOURCES} />
            </div>
          </div>
        </div>
      );
  }
}

/**
 * Controlled reference drawer for a single guide topic. Reused by both the
 * legacy tile grid and the new phased move-in journey so the dense Pitt arrival
 * reference (packing list, FAQs, day-of details…) is authored once and opened
 * from wherever it's contextually relevant.
 */
export function MoveInGuideDrawer({
  openId,
  onClose,
}: {
  openId: TileId | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const drawerMeta = getDrawerMeta(t);
  const meta = openId ? drawerMeta[openId] : null;
  return (
    // Mobile keeps the exact vaul Drawer (default drag pill); desktop becomes a
    // centered Dialog. desktopClassName restores the flex-col header+scroll-body
    // layout (Dialog defaults to grid) and hides Dialog's built-in X so only the
    // custom close renders.
    <AdaptiveOverlay
      open={openId !== null}
      onOpenChange={(o) => !o && onClose()}
      mobileVariant="drawer"
    >
      {/* overflow-hidden turns off the base shell scroll so only the body scrolls;
          the pinned header keeps the title in view and the long sheets never clip. */}
      <AdaptiveOverlayContent
        priority
        className="max-h-[88dvh] overflow-hidden"
        desktopClassName="flex flex-col [&>button[aria-label='Close']]:hidden"
      >
        {meta && openId ? (
          <>
            <AdaptiveOverlayHeader className="relative shrink-0 pr-12 text-left">
              <AdaptiveOverlayTitle>{meta.title}</AdaptiveOverlayTitle>
              <AdaptiveOverlayDescription>{meta.description}</AdaptiveOverlayDescription>
              <AdaptiveOverlayClose
                aria-label={t('checklist:arrival.closeAriaLabel')}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </AdaptiveOverlayClose>
            </AdaptiveOverlayHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
              <DrawerBody id={openId} />
            </div>
          </>
        ) : null}
      </AdaptiveOverlayContent>
    </AdaptiveOverlay>
  );
}

