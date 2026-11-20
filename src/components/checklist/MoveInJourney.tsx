import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format } from 'date-fns';
import { Link, useNavigate } from 'react-router';
import {
  ArrowDown,
  ArrowRight,
  Bell,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  Compass,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Home,
  LogIn,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  PartyPopper,
  Sparkles,
  Users,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
// Lazy so the heavy mapbox-gl bundle is only fetched when a map actually renders.
const DormMiniMap = lazy(() =>
  import('@/components/DormMiniMap').then((m) => ({ default: m.DormMiniMap })),
);
import { directionsUrl } from '@/lib/maps';
import { dormSlugFromName } from '@/lib/dormSlug';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useBuildingChatLinks } from '@/hooks/useBuildingChatLinks';
import { PLATFORM_CONFIG } from '@/lib/chatPlatforms';
import { useDorms } from '@/hooks/useDorms';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchDormPin,
  fetchMapboxWalkingRoute,
  formatWalkMinutes,
  type NamedCoord,
} from '@/lib/mapboxWalking';
import { parseIsoDateLocal, countdownLabel } from '@/lib/dateUtils';
import { resolveCampusBuilding } from '@/lib/campusMapData';
import { getMoveInContent, resolveMoveInPlan, type MoveInStep } from '@/data/moveInSteps';
import { useUniversity } from '@/contexts/UniversityContext';
import {
  MOVE_IN_PHASES,
  WELCOME_WEEK_DAYS,
  WELCOME_WEEK_RANGE,
  WELCOME_WEEK_REQUIRED_IDS,
  resolveCurrentPhase,
  type MoveInPhaseId,
} from '@/data/moveInJourney';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MoveInInfoCard } from '@/components/dorm-portal/MoveInInfoCard';
import { DocumentPreviewDialog } from '@/components/DocumentPreviewDialog';
import { MoveInGuideDrawer, type TileId } from '@/components/checklist/MoveInArrivalInfo';
import { RoommateClaimBoard } from '@/components/checklist/RoommateClaimBoard';
import { MoveInPackingList } from '@/components/checklist/MoveInPackingList';
import { GuidedFlow } from '@/components/checklist/MoveInGuidedFlow';
import { MOVE_IN_GUIDED_FLOWS, GUIDED_STEP_IDS } from '@/data/moveInGuidedFlows';
import {
  ARRIVAL_LINKS,
  ARRIVAL_MAPS,
  HOUSING_ASSIGNMENT_STEPS,
} from '@/data/moveInArrival';
import { useLogisticsProgress } from '@/hooks/useLogisticsProgress';
import { cn } from '@/lib/utils';
import type { Dorm } from '@/types';

const MAPBOX_TOKEN = (() => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token || typeof token !== 'string' || token.trim() === '') return '';
  return token;
})();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `moveInDate + dayOffset` calendar days at local midnight (null if no date). */
function computeStepDate(moveInDate: Date | null, dayOffset: number): Date | null {
  if (!moveInDate) return null;
  return new Date(moveInDate.getTime() + dayOffset * MS_PER_DAY);
}

/**
 * From-dorm walking time for each unique step building, in parallel. Buildings
 * that fail are simply absent (treated as "no walking time"); one slow lookup
 * never blocks the others.
 */
async function fetchStepWalkTimes(
  dormPin: NamedCoord,
  buildingCoords: { name: string; lat: number; lng: number }[],
  token: string,
): Promise<Map<string, number>> {
  if (!token || buildingCoords.length === 0) return new Map();
  const results = await Promise.all(
    buildingCoords.map(async (b) => {
      try {
        const route = await fetchMapboxWalkingRoute(
          [
            [dormPin.lng, dormPin.lat],
            [b.lng, b.lat],
          ],
          token,
        );
        const seconds = route?.legs[0]?.duration;
        if (typeof seconds === 'number' && Number.isFinite(seconds)) {
          return [b.name, seconds] as const;
        }
        return null;
      } catch {
        return null;
      }
    }),
  );
  const out = new Map<string, number>();
  for (const r of results) if (r) out.set(r[0], r[1]);
  return out;
}

interface ProfileRow {
  id: string;
  current_dorm: string | null;
  move_in_date: string | null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Small building blocks                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

/** A single checkable item (a move-in step or a Welcome Week required event). */
function CheckRow({
  id,
  title,
  done,
  onToggle,
  derived = false,
  children,
}: {
  id: string;
  title: ReactNode;
  done: boolean;
  onToggle: (id: string) => void;
  /** When true, the completion circle is a read-only status indicator (a guided
      flow below drives completion) instead of an independently tappable button. */
  derived?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleStr = typeof title === 'string' ? title : 'item';
  const doneLabel = done
    ? t('checklist:moveIn.ariaMarkNotDone', { title: titleStr })
    : t('checklist:moveIn.ariaMarkDone', { title: titleStr });
  const circleClass = cn(
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all',
    done ? 'border-malachite-600 bg-malachite-800 text-white' : 'border-muted-foreground/30 text-transparent',
  ); // KEEP: done-checkbox filled state is a genuine completion signal
  return (
    <li className={cn('rounded-xl border p-3 transition-colors', done ? 'border-border bg-muted' : 'border-border bg-card')}>
      <div className="flex items-start gap-3">
        {/* Reads as an empty checkbox when not done (check fades in on hover)
            so it's obvious each step is completable, not decorative. Guided steps
            render a derived, non-interactive indicator (the flow drives done). */}
        {derived ? (
          <span
            role="img"
            aria-label={done ? t('checklist:moveIn.stepDoneStatus') : t('checklist:moveIn.stepNotDoneStatus')}
            className={circleClass}
          >
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
          </span>
        ) : (
          <Button
            type="button"
            onClick={() => onToggle(id)}
            aria-pressed={done}
            aria-label={doneLabel}
            className={cn(circleClass, 'active:scale-90 focus-visible:ring-malachite-600')}
            variant="ghost"
          >
            <Check className="h-4 w-4" strokeWidth={3} />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-semibold text-foreground', done && 'text-muted-foreground line-through')}>
            {title}
          </p>
          {children}
        </div>
      </div>
    </li>
  );
}

/** A tappable reference entry that opens a guide drawer. */
function ReferenceRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
      variant="ghost"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground/60" aria-hidden />
    </Button>
  );
}

/**
 * Short reference content that expands in place instead of opening a drawer.
 * Same row affordance as `ReferenceRow` (icon tile + title + subtitle + chevron),
 * but the chevron points down and rotates on open and the content reveals inline - 
 * used for the brief blocks (housing assignment, what Pitt provides) that don't
 * warrant a full bottom sheet.
 */
function InlineReference({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-card transition-colors"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-accent">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Inline date picker for the "Confirm your move-in time" step. Saves to
 * `profiles.move_in_date` - the same personal date that drives the My Home hero
 * countdown - and offers a "remind me" opt-in (email `movein` category) for
 * students whose housing email hasn't arrived yet.
 */
function MoveInDateSetter({ userId, savedIso }: { userId: string; savedIso: string | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(savedIso ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [reminder, setReminder] = useState<'idle' | 'saving' | 'on' | 'error'>('idle');

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    setSaveError(false);
    const { error } = await supabase
      .from('profiles')
      .update({ move_in_date: value })
      .eq('id', userId);
    setSaving(false);
    if (error) {
      setSaveError(true);
      return;
    }
    // Refresh every consumer of the personal date (this journey + My Home hero).
    void queryClient.invalidateQueries({ queryKey: ['movein-journey-profile'] });
    void queryClient.invalidateQueries({ queryKey: ['my-home-profile'] });
  };

  const handleReminder = async () => {
    setReminder('saving');
    const { data, error: readError } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', userId)
      .maybeSingle();
    if (readError) {
      setReminder('error');
      return;
    }
    const prefs = (data?.notification_prefs ?? {}) as {
      email?: Record<string, boolean> | null;
      push?: Record<string, boolean> | null;
    };
    const next = { ...prefs, email: { ...(prefs.email ?? {}), movein: true } };
    const { error } = await supabase
      .from('profiles')
      .update({ email_notifications: true, notification_prefs: next })
      .eq('id', userId);
    setReminder(error ? 'error' : 'on');
  };

  const saved = !!savedIso && savedIso === value;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="movein-date-input" className="sr-only">
          {t('checklist:moveIn.dateInputLabel')}
        </label>
        <input
          id="movein-date-input"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
        /> {/* KEEP: focus-ring is interaction-only */}
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!value || saving || saved}
          className="bg-malachite-800 font-semibold text-white hover:bg-malachite-900"
        >
          {saving ? t('checklist:moveIn.saving') : saved ? t('checklist:moveIn.saved') : savedIso ? t('checklist:moveIn.updateDate') : t('checklist:moveIn.saveDate')}
        </Button>
      </div>
      {saveError ? (
        <p className="text-xs font-medium text-destructive">{t('checklist:moveIn.saveError')}</p>
      ) : saved ? (
        <p className="flex items-center gap-1 text-xs font-medium text-foreground">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t('checklist:moveIn.saveSuccess')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('checklist:moveIn.saveHelp')}
        </p>
      )}
      {!savedIso &&
        (reminder === 'on' ? (
          <p className="flex items-center gap-1 text-xs font-medium text-foreground">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {t('checklist:moveIn.reminderOn')}
          </p>
        ) : (
          <Button
            type="button"
            onClick={handleReminder}
            disabled={reminder === 'saving'}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            variant="ghost"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden />
            {reminder === 'saving'
              ? t('checklist:moveIn.reminderSaving')
              : reminder === 'error'
                ? t('checklist:moveIn.reminderError')
                : t('checklist:moveIn.reminderOffer')}
          </Button>
        ))}
    </div>
  );
}

/**
 * Prominent, date-driven countdown that leads the tab once a move-in date is set.
 * Text-carried (never color-only) so it reads on screen readers and passes a11y.
 * The countdown phrase reuses `countdownLabel` (English-only, same as the My Home
 * hero + the footer line below); only the surrounding copy is translated.
 */
function MoveInCountdownBanner({ moveInDate }: { moveInDate: Date }) {
  const { t } = useTranslation();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = differenceInCalendarDays(moveInDate, today) >= 0;
  const dateStr = format(moveInDate, 'EEEE, MMMM d');
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-malachite-800 text-white">
        <CalendarClock className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight text-foreground">
          {upcoming ? countdownLabel(moveInDate) : t('checklist:moveIn.countdownMovedIn')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(upcoming ? 'checklist:moveIn.countdownSubtitle' : 'checklist:moveIn.countdownWasSubtitle', {
            date: dateStr,
          })}
        </p>
      </div>
    </div>
  );
}

const PHASE_ORDER: MoveInPhaseId[] = MOVE_IN_PHASES.map((p) => p.id);
const PHASE_SHORT_TITLE: Record<MoveInPhaseId, string> = {
  before: 'Before',
  day: 'Move-in',
  'campus-ready': 'Campus',
  welcome: 'Welcome',
  settled: 'Settled',
};

const IS_NATIVE = Capacitor.isNativePlatform();
// Sticky stepper sits below the mobile-web top bar (top-12), near the top of the
// chromeless desktop shell (md:top-2 - the md+ app shell has no top bar), or, on
// native, just under the floating NativeTopBar pill. Stages scroll to land just
// beneath it (scroll-mt).
const STEPPER_STICKY_CLASS = IS_NATIVE ? 'top-1' : 'top-12 md:top-2';
const STAGE_SCROLL_MT_CLASS = IS_NATIVE ? 'scroll-mt-[5.5rem]' : 'scroll-mt-[7rem]';

/** Sticky 4-stage progress bar: shows where you are, jumps + focuses on tap. */
function StageStepper({
  stages,
  activeId,
  onSelect,
}: {
  stages: { id: MoveInPhaseId; doneCount: number; totalCount: number }[];
  activeId: MoveInPhaseId | null;
  onSelect: (id: MoveInPhaseId) => void;
}) {
  return (
    <div
      className={cn(
        'sticky z-30 -mx-1 flex gap-0.5 rounded-2xl border border-border bg-background/95 p-1.5 shadow-raised backdrop-blur supports-[backdrop-filter]:bg-background/80',
        STEPPER_STICKY_CLASS,
      )}
    >
      {stages.map((s, i) => {
        const active = s.id === activeId;
        const complete = s.totalCount > 0 && s.doneCount >= s.totalCount;
        return (
          <Button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-1.5 transition-colors',
              active ? 'bg-muted' : 'hover:bg-accent',
            )}
            variant="ghost"
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                complete || active ? 'bg-malachite-800 text-white' : 'bg-muted text-muted-foreground',
              )}
            >
              {complete ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                'w-full truncate text-center text-[10px] font-semibold leading-tight',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {PHASE_SHORT_TITLE[s.id]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Desktop-only vertical phase navigator (the left rail of the xl: master/detail
 * layout). Same jump-and-focus behavior as the mobile `StageStepper`, but laid
 * out as a persistent sidebar list with full phase titles, per-stage progress,
 * and a thin progress bar - so a desktop user always sees where they are in the
 * journey and every stage is one click away without scrolling.
 */
function VerticalStageNav({
  stages,
  activeId,
  onSelect,
}: {
  stages: { id: MoveInPhaseId; doneCount: number; totalCount: number }[];
  activeId: MoveInPhaseId | null;
  onSelect: (id: MoveInPhaseId) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('checklist:moveIn.stepperAriaLabel', 'Move-in stages')}
      className="rounded-2xl border border-border bg-card p-2 shadow-raised"
    >
      <ol className="space-y-1">
        {stages.map((s, i) => {
          const active = s.id === activeId;
          const complete = s.totalCount > 0 && s.doneCount >= s.totalCount;
          const pct = s.totalCount > 0 ? Math.round((s.doneCount / s.totalCount) * 100) : 0;
          const title = MOVE_IN_PHASES.find((p) => p.id === s.id)?.title ?? PHASE_SHORT_TITLE[s.id];
          return (
            <li key={s.id}>
              <Button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors',
                  active ? 'bg-muted' : 'hover:bg-accent',
                )}
                variant="ghost"
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors',
                    complete || active ? 'bg-malachite-800 text-white' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {complete ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-semibold leading-tight',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {title}
                  </span>
                  {s.totalCount > 0 ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-malachite-600 transition-[width] duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </span> {/* KEEP: progress bar fill for the MoveInJourney progress system */}
                      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {s.doneCount}/{s.totalCount}
                      </span>
                    </span>
                  ) : null}
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** End-of-stage forward nudge → opens + focuses the next stage (wrap-up on the last). */
function NextStageButton({
  currentId,
  onGo,
}: {
  currentId: MoveInPhaseId;
  onGo: (id: MoveInPhaseId) => void;
}) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const nextId = PHASE_ORDER[PHASE_ORDER.indexOf(currentId) + 1];
  if (!nextId) {
    return (
      <p className="pt-1 text-center text-sm font-semibold text-foreground">
        {t('checklist:moveIn.allSet', { school: university.shortName })}
      </p>
    );
  }
  const nextTitle = MOVE_IN_PHASES.find((p) => p.id === nextId)?.title ?? '';
  return (
    <Button
      type="button"
      onClick={() => onGo(nextId)}
      className="w-full bg-malachite-800 font-semibold text-white hover:bg-malachite-900"
    >
      {t('checklist:moveIn.next', { title: nextTitle })}
      <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
    </Button>
  );
}

/** A tappable card that opens a PDF in the in-app preview (zoom / pan / save). */
function DocPreviewButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-muted p-4 text-left transition-colors hover:bg-muted/80"
      variant="ghost"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-800 text-white">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
      </span>
      <ZoomIn className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Button>
  );
}

/**
 * Static phase shell: header (number, title, date, progress) + content. One
 * phase renders at a time - the stepper pills / desktop rail switch between
 * them - so there is nothing to expand or collapse here anymore.
 */
function PhaseSection({
  index,
  title,
  blurb,
  dateLabel,
  doneCount,
  totalCount,
  children,
}: {
  index: number;
  title: string;
  blurb: string;
  dateLabel?: string | null;
  doneCount: number;
  totalCount: number;
  children: ReactNode;
}) {
  const complete = totalCount > 0 && doneCount >= totalCount;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card shadow-raised',
        STAGE_SCROLL_MT_CLASS,
      )}
    >
      <div className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            complete ? 'bg-malachite-800 text-white' : 'bg-muted text-muted-foreground',
          )}
        >
          {complete ? <Check className="h-5 w-5" strokeWidth={3} /> : index}
        </span> {/* KEEP: complete state is malachite-800 green, active/current step is earned keep */}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-bold text-foreground">{title}</span>
            {dateLabel ? (
              <span className="text-xs font-medium text-muted-foreground">{dateLabel}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {totalCount > 0 ? `${doneCount} of ${totalCount} done · ` : ''}
            {blurb}
          </span>
        </span>
      </div>
      {totalCount > 0 ? (
        <div className="mx-4 h-1 overflow-hidden rounded-full bg-muted sm:mx-5">
          <div
            className="h-full rounded-full bg-malachite-600 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <div className="space-y-4 p-4 pt-4 sm:p-5">{children}</div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Step list (shared by before / day / settled phases)                      */
/* ──────────────────────────────────────────────────────────────────────── */

function StepList({
  steps,
  moveInDate,
  doneIds,
  toggle,
  walkTimes,
  extras,
  derivedStepIds,
}: {
  steps: MoveInStep[];
  moveInDate: Date | null;
  doneIds: Set<string>;
  toggle: (id: string) => void;
  walkTimes: Map<string, number> | undefined;
  /** Per-step inline action (deep link, date picker, one-click shortcut), keyed by step id. */
  extras?: Partial<Record<string, ReactNode>>;
  /** Steps whose completion is driven by a guided flow below (checkbox is derived). */
  derivedStepIds?: Set<string>;
}) {
  // Read the tenant here rather than threading a slug through four call sites.
  // A step's `building` only resolves against its OWN school's registry, so a
  // school with no registry entry shows the building name with no walk time.
  const { university } = useUniversity();
  if (steps.length === 0) return null;
  return (
    <ul className="space-y-2.5">
      {steps.map((step) => {
        const isDone = doneIds.has(step.id);
        const stepDate = computeStepDate(moveInDate, step.dayOffset);
        const buildingCoord = step.building
          ? resolveCampusBuilding(step.building, university.slug)
          : null;
        const walkSeconds = buildingCoord && walkTimes ? walkTimes.get(buildingCoord.name) ?? null : null;
        const walkLabel = formatWalkMinutes(walkSeconds);
        const locationParts = [step.building, step.locationLabel].filter(Boolean);
        return (
          <CheckRow
            key={step.id}
            id={step.id}
            title={step.title}
            done={isDone}
            onToggle={toggle}
            derived={derivedStepIds?.has(step.id) ?? false}
          >
            {step.timeLabel && (
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">{step.timeLabel}</p>
            )}
            {locationParts.length > 0 &&
              (step.building ? (
                <a
                  href={directionsUrl({ query: `${step.building}, University of Pittsburgh` })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 flex items-start gap-1 text-sm text-foreground hover:underline"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{locationParts.join(' · ')}</span>
                </a>
              ) : (
                <p className="mt-0.5 flex items-start gap-1 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{locationParts.join(' · ')}</span>
                </p>
              ))}
            {(stepDate || walkLabel) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stepDate && format(stepDate, 'EEE MMM d')}
                {stepDate && walkLabel && ' · '}
                {walkLabel && `${walkLabel} from your dorm`}
              </p>
            )}
            {step.bringList && step.bringList.length > 0 && (
              <p className="mt-1.5 text-sm text-foreground">
                <span className="font-medium">Bring:</span> {step.bringList.join(', ')}
              </p>
            )}
            {step.notes && <p className="mt-1.5 text-sm leading-relaxed text-foreground">{step.notes}</p>}
            {step.href && (
              <a
                href={step.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
              >
                {step.hrefLabel ?? 'Learn more'}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
            {extras?.[step.id]}
          </CheckRow>
        );
      })}
    </ul>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Main                                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * The Checklist "Move In" tab as one chronological journey: before move-in →
 * move-in day → Welcome Week → settled in. Phases are pages, not a stack -
 * exactly one renders at a time, switched by the stepper pills / desktop rail /
 * horizontal swipe, defaulting to the date-derived current phase. Deep Pitt
 * reference (packing list, FAQs, day-of details) opens in focused drawers.
 *
 * `shippingSlot` is injected by the parent so the Ship2Pitt accordion can live
 * inside the "before move-in" phase without this module importing it (which
 * would create a cycle with LogisticsPanel).
 */
export function MoveInJourney({ shippingSlot }: { shippingSlot?: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { dorms, isLoading: dormsLoading } = useDorms();
  const { building } = useCurrentUserBuilding();
  const { links: buildingChatLinks } = useBuildingChatLinks(building?.buildingId ?? null);
  const { university } = useUniversity();
  const moveInContent = getMoveInContent(university.slug);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['movein-journey-profile', user?.id ?? ''],
    queryFn: async (): Promise<ProfileRow | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, current_dorm, move_in_date')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const currentDorm = useMemo<Dorm | null>(() => {
    const name = (profile?.current_dorm ?? '').trim();
    if (!name) return null;
    return dorms.find((d) => d.name.trim().toLowerCase() === name.toLowerCase()) ?? null;
  }, [dorms, profile?.current_dorm]);

  const dormAddr = currentDorm?.address?.trim() || currentDorm?.mailingAddress?.trim() || null;

  const [addrCopied, setAddrCopied] = useState(false);
  const handleCopyAddress = async () => {
    if (!dormAddr) return;
    try {
      await navigator.clipboard.writeText(dormAddr);
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const { doneIds, toggle } = useLogisticsProgress('movein');

  const mapTarget = useMemo(() => {
    if (!building) return null;
    const dorm = dorms.find((d) => d.id === String(building.buildingId));
    if (!dorm || dorm.latitude == null || dorm.longitude == null) return null;
    const { latitude, longitude } = dorm;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, name: building.residenceHallName };
  }, [building, dorms]);

  // Personal assigned date (set right here in the "confirm your time" step)
  // wins over the dorm-level published date.
  const moveInDate = useMemo(
    () => parseIsoDateLocal(profile?.move_in_date ?? currentDorm?.moveInDate ?? null),
    [profile?.move_in_date, currentDorm?.moveInDate],
  );

  const hasMoveInDayInfo =
    !!currentDorm &&
    (moveInDate !== null ||
      !!currentDorm.moveInParkingLot?.trim() ||
      !!currentDorm.moveInTimeWindow?.trim() ||
      !!currentDorm.moveInEntrance?.trim() ||
      !!currentDorm.moveInCartLocation?.trim() ||
      !!currentDorm.moveInNotes?.trim());

  // Resolve the step plan and bucket by phase. Prep ("before") and "settled"
  // steps are universal (DEFAULT plan); day-of steps prefer a curated dorm plan
  // when one exists so every dorm still gets a populated before/settled list.
  const { beforeSteps, daySteps, settledSteps } = useMemo(() => {
    const curated = resolveMoveInPlan(currentDorm?.name ?? null, university.slug);
    const universal = moveInContent.defaultPlan;
    const before = universal.filter((s) => s.dayOffset < 0);
    const curatedDay = curated?.steps.filter((s) => s.dayOffset === 0) ?? [];
    const day = curatedDay.length ? curatedDay : universal.filter((s) => s.dayOffset === 0);
    // Curated day-after steps (e.g. orientation) join the universal settled steps;
    // drop the "go to welcome week" pointer since the Welcome Week phase owns it.
    const curatedAfter = curated?.steps.filter((s) => s.dayOffset >= 1) ?? [];
    const universalAfter = universal.filter(
      (s) => s.dayOffset >= 1 && s.id !== 'default-welcome-week',
    );
    const settled = [...curatedAfter, ...universalAfter].sort((a, b) => a.order - b.order);
    return { beforeSteps: before, daySteps: day, settledSteps: settled };
  }, [currentDorm?.name, university.slug, moveInContent]);

  // Walking origin + per-step walk times (day + settled steps with a building).
  const { data: dormPin } = useQuery({
    queryKey: ['movein-journey-dorm-pin', user?.id ?? ''],
    queryFn: () => fetchDormPin(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const buildingCoords = useMemo(() => {
    const byName = new Map<string, { name: string; lat: number; lng: number }>();
    for (const step of [...daySteps, ...settledSteps]) {
      if (!step.building) continue;
      const coord = resolveCampusBuilding(step.building, university.slug);
      if (coord && !byName.has(coord.name)) byName.set(coord.name, coord);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [daySteps, settledSteps, university.slug]);

  const buildingsHash = useMemo(() => buildingCoords.map((b) => b.name).join('|'), [buildingCoords]);

  const { data: walkTimes } = useQuery({
    queryKey: ['movein-journey-walks', dormPin?.lng ?? null, dormPin?.lat ?? null, buildingsHash],
    queryFn: () => fetchStepWalkTimes(dormPin!, buildingCoords, MAPBOX_TOKEN),
    enabled: !!dormPin && buildingCoords.length > 0 && !!MAPBOX_TOKEN,
    staleTime: 60 * 60 * 1000,
  });

  // Per-phase progress counts.
  const doneIn = (ids: string[]) => ids.filter((id) => doneIds.has(id)).length;
  const beforeIds = beforeSteps.map((s) => s.id);
  const dayIds = daySteps.map((s) => s.id);
  const campusReadyIds = moveInContent.campusReadySteps.map((s) => s.id);
  const settledIds = settledSteps.map((s) => s.id);

  // Soft gating: which phase auto-expands. Memoized so toggling other phases
  // doesn't re-derive against a moving "today".
  const initialPhase = useMemo<MoveInPhaseId>(() => {
    const today = new Date();
    const welcomeStart = parseIsoDateLocal(WELCOME_WEEK_RANGE.start) ?? today;
    const welcomeEnd = parseIsoDateLocal(WELCOME_WEEK_RANGE.end) ?? today;
    return resolveCurrentPhase(moveInDate, today, welcomeStart, welcomeEnd);
  }, [moveInDate]);

  // Paged "one phase per screen" model: exactly one phase renders at a time,
  // seeded by the date-derived current phase until the user picks another.
  // Navigation is always free - the pills, the desktop rail, the Next button,
  // and horizontal swipes all just switch the visible page.
  const [pickedPhase, setPickedPhase] = useState<MoveInPhaseId | null>(null);
  const activePhase = pickedPhase ?? initialPhase;

  const pagerRef = useRef<HTMLDivElement | null>(null);
  const focusStage = useCallback((id: MoveInPhaseId) => {
    setPickedPhase(id);
    // Land the reader at the top of the new page (just under the sticky stepper).
    requestAnimationFrame(() => {
      pagerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Horizontal swipe between phases (mobile). Only fires on a clearly
  // horizontal gesture so vertical scrolling through a page is untouched.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t0 = e.touches[0];
    touchStart.current = { x: t0.clientX, y: t0.clientY };
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const t0 = e.changedTouches[0];
      const dx = t0.clientX - start.x;
      const dy = t0.clientY - start.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const idx = PHASE_ORDER.indexOf(activePhase);
      const next = dx < 0 ? PHASE_ORDER[idx + 1] : PHASE_ORDER[idx - 1];
      if (next) focusStage(next);
    },
    [activePhase, focusStage],
  );

  const shippingRef = useRef<HTMLDivElement | null>(null);
  const [drawer, setDrawer] = useState<TileId | null>(null);
  const [docPreview, setDocPreview] = useState<{
    path: string;
    title: string;
    fileName: string;
  } | null>(null);

  // ── Gates ───────────────────────────────────────────────────────────────
  if (authLoading || profileLoading || dormsLoading) {
    return (
      <div className="space-y-3">
        <div className="h-20 w-full animate-pulse rounded-2xl bg-muted" />
        <div className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
        <div className="h-16 w-full animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-raised">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <LogIn className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t('checklist:moveIn.signInTitle')}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t('checklist:moveIn.signInDesc')}
        </p>
        <Button asChild className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90">
          <Link to="/auth">{t('common:actions.signIn')}</Link>
        </Button>
      </div>
    );
  }

  const dormName = (profile?.current_dorm ?? '').trim();
  const phaseDate = (id: MoveInPhaseId): string | null => {
    if (id === 'welcome') return WELCOME_WEEK_RANGE.label;
    if (id === 'day') {
      // Stage-gate hint: the day-of plan fills in with dates once the date is set.
      return moveInDate ? format(moveInDate, 'EEE, MMM d') : t('checklist:moveIn.noDateHint');
    }
    return null;
  };

  // Inline actions on the "before" steps: each task deep-links to the surface
  // that does the work instead of describing it and stopping.
  const beforeExtras: Partial<Record<string, ReactNode>> = {
    'default-confirm-move-in-time': (
      <MoveInDateSetter userId={user.id} savedIso={profile?.move_in_date ?? null} />
    ),
    // Roommate coordination is now the live claim board rendered below the list.
    'default-coordinate-roommate': null,
    'default-ship-vs-carry': shippingSlot ? (
      <Button
        type="button"
        onClick={() => shippingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        // h-auto + whitespace-normal: the Button primitive is single-line
        // (nowrap, fixed height), and at 360px this label ran past the card.
        className="mt-1.5 inline-flex h-auto items-center gap-1 whitespace-normal text-left text-sm font-medium text-foreground hover:underline"
        variant="ghost"
      >
        See Ship2Pitt shipping options below
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
    ) : null,
    // Night-one is now the Moon toggle in the packing list (is_night_one), not a
    // separate seeded "Night One" category - so no per-step shortcut here.
    'default-panther-card': (
      <GuidedFlow
        stepId="default-panther-card"
        subSteps={MOVE_IN_GUIDED_FLOWS['default-panther-card']}
        doneIds={doneIds}
        toggle={toggle}
      />
    ),
  };

  // Campus-ready guided flows: dining plan + campus accounts as short walk-throughs.
  const campusReadyExtras: Partial<Record<string, ReactNode>> = {
    'campus-ready-pitt-email': (
      <GuidedFlow
        stepId="campus-ready-pitt-email"
        subSteps={MOVE_IN_GUIDED_FLOWS['campus-ready-pitt-email']}
        doneIds={doneIds}
        toggle={toggle}
      />
    ),
    'campus-ready-dining': (
      <GuidedFlow
        stepId="campus-ready-dining"
        subSteps={MOVE_IN_GUIDED_FLOWS['campus-ready-dining']}
        doneIds={doneIds}
        toggle={toggle}
      />
    ),
  };

  const stageProgress: { id: MoveInPhaseId; doneCount: number; totalCount: number }[] = [
    { id: 'before', doneCount: doneIn(beforeIds), totalCount: beforeIds.length },
    { id: 'day', doneCount: doneIn(dayIds), totalCount: dayIds.length },
    { id: 'campus-ready', doneCount: doneIn(campusReadyIds), totalCount: campusReadyIds.length },
    { id: 'welcome', doneCount: doneIn(WELCOME_WEEK_REQUIRED_IDS), totalCount: WELCOME_WEEK_REQUIRED_IDS.length },
    { id: 'settled', doneCount: doneIn(settledIds), totalCount: settledIds.length },
  ];

  return (
    <div className="space-y-4 pb-6 sm:space-y-5">
      {!dormName && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/80 px-3 py-2.5 text-sm">
          <p className="text-muted-foreground">
            {t('checklist:moveIn.noDormWarning')}
          </p>
          <Button asChild size="sm" className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/profile/edit">{t('checklist:moveIn.updateProfile')}</Link>
          </Button>
        </div>
      )}

      {moveInDate && <MoveInCountdownBanner moveInDate={moveInDate} />} {/* KEEP: countdown banner bg-malachite tint + icon earned */}

      {/* xl: two-column master/detail - a persistent phase rail on the left, the
          phase content on the right. Gated at xl (not lg) because the ~220px
          desktop app nav eats width the viewport-based lg query can't see, so
          xl is the first breakpoint with real room for two columns (mirrors the
          Shop Essentials layout). Below xl it collapses to the single-column
          stepper + accordion flow (unchanged). */}
      <div className="xl:grid xl:grid-cols-[minmax(220px,264px)_minmax(0,1fr)] xl:items-start xl:gap-6">
        <aside className="hidden self-start xl:sticky xl:top-20 xl:block">
          <VerticalStageNav stages={stageProgress} activeId={activePhase} onSelect={focusStage} />
        </aside>

        <div
          ref={pagerRef}
          className={cn('min-w-0 space-y-4 sm:space-y-5', STAGE_SCROLL_MT_CLASS)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="xl:hidden">
            <StageStepper stages={stageProgress} activeId={activePhase} onSelect={focusStage} />
          </div>

      {/* PHASE 1 - Before move-in */}
      {activePhase === 'before' && (
      <PhaseSection
        index={1}
        title={MOVE_IN_PHASES[0].title}
        blurb={MOVE_IN_PHASES[0].blurb}
        dateLabel={phaseDate('before')}
        doneCount={doneIn(beforeIds)}
        totalCount={beforeIds.length}
      >
        <StepList
          steps={beforeSteps}
          moveInDate={moveInDate}
          doneIds={doneIds}
          toggle={toggle}
          walkTimes={walkTimes}
          extras={beforeExtras}
          derivedStepIds={GUIDED_STEP_IDS}
        />
        {/* Heavy tools live behind entry cards so the page stays scannable -
            the five core tasks above are the whole first read. */}
        <div className="space-y-2.5">
          <InlineReference
            icon={Users}
            title={t('checklist:moveIn.roommateEntryTitle')}
            subtitle={t('checklist:moveIn.roommateEntrySubtitle')}
          >
            <RoommateClaimBoard userId={user.id} hideHeader />
          </InlineReference>
          <InlineReference
            icon={Package}
            title={t('checklist:moveIn.packingEntryTitle')}
            subtitle={t('checklist:moveIn.packingEntrySubtitle')}
          >
            <MoveInPackingList userId={user.id} dormName={dormName || null} hideHeader />
          </InlineReference>
        </div>
        <div className="space-y-2.5">
          <InlineReference
            icon={Home}
            title={t('checklist:arrival.assignmentTitle')}
            subtitle={t('checklist:arrival.assignmentSubtitle')}
          >
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
              {HOUSING_ASSIGNMENT_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Button
              asChild
              className="mt-3 w-full bg-malachite-800 font-semibold text-white hover:bg-malachite-900"
            >
              <a href={ARRIVAL_LINKS.myPitt} target="_blank" rel="noopener noreferrer">
                {t('checklist:arrival.openMyPitt')}
                <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
              </a>
            </Button> {/* KEEP: primary CTA in housing assignment block, earned green */}
          </InlineReference>
        </div>
        {shippingSlot ? (
          <div ref={shippingRef} className={STAGE_SCROLL_MT_CLASS}>
            {shippingSlot}
          </div>
        ) : null}
        <NextStageButton currentId="before" onGo={focusStage} />
      </PhaseSection>
      )}

      {/* PHASE 2 - Move-in day */}
      {activePhase === 'day' && (
      <PhaseSection
        index={2}
        title={MOVE_IN_PHASES[1].title}
        blurb={MOVE_IN_PHASES[1].blurb}
        dateLabel={phaseDate('day')}
        doneCount={doneIn(dayIds)}
        totalCount={dayIds.length}
      >
        {currentDorm && dormAddr && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{t('checklist:arrival.yourBuilding')}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{currentDorm.name}</p>
              </div>
              <a
                href={directionsUrl({ address: dormAddr, lat: currentDorm.latitude, lng: currentDorm.longitude })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-malachite-800 px-4 py-2 text-sm font-medium text-white hover:bg-malachite-900"
              >
                <Navigation className="h-4 w-4" />
                {t('checklist:arrival.directions')}
              </a> {/* KEEP: primary CTA on move-in-day phase, earned green */}
            </div>
            {mapTarget ? (
              <a
                href={directionsUrl({ address: dormAddr, lat: mapTarget.latitude, lng: mapTarget.longitude })}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open directions to ${currentDorm.name}`}
                className="block w-full"
              >
                <div className="h-44 overflow-hidden sm:h-52 [&_button]:hidden">
                  <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted" />}>
                    <DormMiniMap
                      latitude={mapTarget.latitude}
                      longitude={mapTarget.longitude}
                      buildingName={mapTarget.name}
                      onViewMap={() =>
                        navigate(`/campus?focus=${encodeURIComponent(dormSlugFromName(mapTarget.name))}`)
                      }
                      className="h-full min-h-0 w-full rounded-none border-0 shadow-none"
                    />
                  </Suspense>
                </div>
              </a>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{t('checklist:arrival.address')}</p>
                <p className="truncate text-sm text-foreground">{dormAddr}</p>
              </div>
              <Button
                type="button"
                onClick={handleCopyAddress}
                aria-label={t('checklist:arrival.copyAddressAriaLabel')}
                className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                variant="ghost"
              >
                {addrCopied ? (
                  <>
                    <Check className="h-4 w-4 text-malachite-600" />
                    {t('checklist:arrival.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {t('checklist:arrival.copy')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Your building's group chat(s) - crowdsourced per-building invite links. */}
        {building && buildingChatLinks.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-3 shadow-raised">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-semibold text-foreground">
                {t('checklist:moveIn.buildingChatTitle', { building: building.residenceHallName })}
              </p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {buildingChatLinks.slice(0, 4).map((link) => (
                <li key={link.id}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {link.label?.trim() || PLATFORM_CONFIG[link.platform].label}
                      {link.floor ? ` · ${link.floor}` : ''}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {t('checklist:moveIn.buildingChatJoin')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Arrival documents - parking pass + both arrival maps, all previewed
            in-app (zoom / pan / save) instead of bouncing out to a browser tab. */}
        <div className="space-y-2.5">
          <DocPreviewButton
            icon={FileText}
            title={t('checklist:arrival.parkingPassTitle')}
            subtitle={t('checklist:arrival.parkingPassSubtitle')}
            onClick={() =>
              setDocPreview({
                path: '/pitt-arrival-parking-pass.pdf',
                title: t('checklist:arrival.parkingPassTitle'),
                fileName: 'pitt-arrival-parking-pass.pdf',
              })
            }
          />
          {ARRIVAL_MAPS.map((m) => (
            <DocPreviewButton
              key={m.file}
              icon={MapIcon}
              title={m.label}
              subtitle={m.description}
              onClick={() =>
                setDocPreview({
                  path: m.file,
                  title: m.label,
                  fileName: m.file.replace(/^\//, ''),
                })
              }
            />
          ))}
        </div>

        {/* Dorm-specific logistics (parking, window, entrance, carts). */}
        {currentDorm &&
          (hasMoveInDayInfo ? (
            <MoveInInfoCard dorm={currentDorm} />
          ) : (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">{t('checklist:arrival.moveInDayInfo')}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('checklist:arrival.moveInDayInfoDesc', { dorm: currentDorm.name })}
              </p>
            </div>
          ))}

        <StepList
          steps={daySteps}
          moveInDate={moveInDate}
          doneIds={doneIds}
          toggle={toggle}
          walkTimes={walkTimes}
        />

        <ReferenceRow
          icon={CalendarCheck}
          title={t('checklist:arrival.dayTitle')}
          subtitle={t('checklist:arrival.daySubtitle')}
          onClick={() => setDrawer('day')}
        />
        <NextStageButton currentId="day" onGo={focusStage} />
      </PhaseSection>
      )}

      {/* PHASE 3 - Campus Ready */}
      {activePhase === 'campus-ready' && (
      <PhaseSection
        index={3}
        title={MOVE_IN_PHASES[2].title}
        blurb={MOVE_IN_PHASES[2].blurb}
        dateLabel={phaseDate('campus-ready')}
        doneCount={doneIn(campusReadyIds)}
        totalCount={campusReadyIds.length}
      >
        <StepList
          steps={moveInContent.campusReadySteps}
          moveInDate={moveInDate}
          doneIds={doneIds}
          toggle={toggle}
          walkTimes={walkTimes}
          extras={campusReadyExtras}
          derivedStepIds={GUIDED_STEP_IDS}
        />
        <NextStageButton currentId="campus-ready" onGo={focusStage} />
      </PhaseSection>
      )}

      {/* PHASE 4 - Welcome Week */}
      {activePhase === 'welcome' && (
      <PhaseSection
        index={4}
        title={MOVE_IN_PHASES[3].title}
        blurb={MOVE_IN_PHASES[3].blurb}
        dateLabel={phaseDate('welcome')}
        doneCount={doneIn(WELCOME_WEEK_REQUIRED_IDS)}
        totalCount={WELCOME_WEEK_REQUIRED_IDS.length}
      >
        <ol className="space-y-3">
          {WELCOME_WEEK_DAYS.map((day) => (
            <li key={day.id} className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{day.label}</p>
              {day.events.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t('checklist:arrival.noRequiredEvents')}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {day.events.map((ev) => {
                    const done = doneIds.has(ev.id);
                    const meta = [ev.time, ev.location].filter(Boolean).join(' · ');
                    return ev.required ? (
                      <li key={ev.id}>
                        <Button
                          type="button"
                          onClick={() => toggle(ev.id)}
                          aria-pressed={done}
                          className="flex w-full items-start gap-2.5 text-left"
                          variant="ghost"
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90',
                              done
                                ? 'border-malachite-600 bg-malachite-800 text-white'
                                : 'border-muted-foreground/30 text-transparent',
                            )}
                          >
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block text-sm font-medium text-foreground',
                                done && 'text-muted-foreground line-through',
                              )}
                            >
                              {ev.title}
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t('checklist:arrival.required')}
                              </span>
                            </span>
                            {meta && <span className="block text-xs text-muted-foreground">{meta}</span>}
                          </span>
                        </Button>
                      </li>
                    ) : (
                      <li key={ev.id} className="flex items-start gap-2.5">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-foreground">{ev.title}</span>
                          {meta && <span className="block text-xs text-muted-foreground">{meta}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <Button
          asChild
          className="w-full bg-malachite-800 font-semibold text-white hover:bg-malachite-900"
        >
          <a href={WELCOME_WEEK_RANGE.scheduleUrl} target="_blank" rel="noopener noreferrer">
            <PartyPopper className="mr-2 h-4 w-4" aria-hidden />
            {t('checklist:arrival.fullScheduleExperiencePitt')}
          </a>
        </Button> {/* KEEP: primary CTA on welcome phase, earned green */}
        <NextStageButton currentId="welcome" onGo={focusStage} />
      </PhaseSection>
      )}

      {/* PHASE 5 - Settled in */}
      {activePhase === 'settled' && (
      <PhaseSection
        index={5}
        title={MOVE_IN_PHASES[4].title}
        blurb={MOVE_IN_PHASES[4].blurb}
        dateLabel={phaseDate('settled')}
        doneCount={doneIn(settledIds)}
        totalCount={settledIds.length}
      >
        <StepList
          steps={settledSteps}
          moveInDate={moveInDate}
          doneIds={doneIds}
          toggle={toggle}
          walkTimes={walkTimes}
        />
        <div className="space-y-2.5">
          <ReferenceRow
            icon={Compass}
            title={t('checklist:arrival.resourcesTitle')}
            subtitle={t('checklist:arrival.resourcesSubtitle')}
            onClick={() => setDrawer('resources')}
          />
          <ReferenceRow
            icon={HelpCircle}
            title={t('checklist:arrival.faqsTitle')}
            subtitle={t('checklist:arrival.faqsSubtitle')}
            onClick={() => setDrawer('faqs')}
          />
        </div>
        <NextStageButton currentId="settled" onGo={focusStage} />
      </PhaseSection>
      )}

      {moveInDate && (
        <p className="px-1 text-xs text-muted-foreground">
          {t('checklist:moveIn.moveInDateLabel', { date: format(moveInDate, 'EEEE, MMMM d, yyyy'), countdown: countdownLabel(moveInDate) })}
        </p>
      )}
      <p className="border-t border-border px-1 pt-3 text-xs italic text-muted-foreground">
        {t('checklist:moveIn.footerDisclaimer')}
      </p>
        </div>
      </div>

      <MoveInGuideDrawer openId={drawer} onClose={() => setDrawer(null)} />
      {docPreview && (
        <DocumentPreviewDialog
          open
          onOpenChange={(o) => !o && setDocPreview(null)}
          path={docPreview.path}
          title={docPreview.title}
          fileName={docPreview.fileName}
        />
      )}
    </div>
  );
}
