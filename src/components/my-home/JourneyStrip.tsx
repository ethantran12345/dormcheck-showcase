import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Building2, ListChecks, MapPin, Users } from 'lucide-react';
import type { SetupStep, SetupStepId } from '@/lib/setupSteps';
import { burstAtElement } from '@/lib/celebrate';
import { MY_HOME_CARD, SectionHeading } from '@/components/my-home/cardSystem';
import { cn } from '@/lib/utils';

export type JourneyStepState = 'locked' | 'available' | 'current' | 'done';

export interface JourneyStripStep extends SetupStep {
  state: JourneyStepState;
}

const STEP_ICONS: Record<SetupStepId, typeof MapPin> = {
  dorm: MapPin,
  roommates: Users,
  checklist: ListChecks,
  visibility: Building2,
};

const STATE_TAGS: Record<JourneyStepState, string> = {
  locked: 'Locked',
  available: 'Open',
  current: 'Do this next',
  done: 'Done',
};

/**
 * The 4-card setup journey under the hero (set dorm → roommates → checklist →
 * building). Each card self-observes its `done` flip within a session and
 * celebrates it (badge pop + local confetti burst); the page passes
 * `popDelayMs` during the fill-in choreography so the burst lands after the
 * building photo has scaled in. When all four are done the strip collapses
 * into the success banner.
 */
export function JourneyStrip({
  steps,
  allDone,
  moveInLabel,
  popDelayMs = 0,
}: {
  steps: JourneyStripStep[];
  allDone: boolean;
  /** e.g. "Aug 15–16" - closes the finale banner copy. */
  moveInLabel: string | null;
  popDelayMs?: number;
}) {
  const reduceMotion = useReducedMotion();
  const doneCount = steps.filter((s) => s.state === 'done').length;

  if (allDone) {
    return (
      <motion.section
        aria-label="Setup complete"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={cn(
          MY_HOME_CARD,
          'flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-4',
        )}
      >
        <span aria-hidden className="text-3xl">
          🎓
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-foreground">All set for move-in.</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your dorm, roommates, checklist, and building are ready.
            {moveInLabel ? ` See you ${moveInLabel}.` : ''}
          </p>
        </div>
        <Link
          to="/my-home/dorm?tab=people"
          className="inline-flex shrink-0 items-center justify-center rounded-control bg-malachite-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-malachite-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
        >
          See who&apos;s on your floor
        </Link>
      </motion.section>
    );
  }

  return (
    <section aria-label="Setup steps">
      <SectionHeading
        title={doneCount === 0 ? 'Get set up in 4 steps' : 'Finish setting up'}
        trailing={`${doneCount} of 4`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {steps.map((step) => (
          <StepCard key={step.id} step={step} popDelayMs={popDelayMs} />
        ))}
      </div>
    </section>
  );
}

function StepCard({ step, popDelayMs }: { step: JourneyStripStep; popDelayMs: number }) {
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const prevDoneRef = useRef<boolean | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  // Celebrate a done-flip that happens while the page is mounted (never on
  // first render, so a refresh shows the settled state with no re-fire).
  useEffect(() => {
    const prev = prevDoneRef.current;
    prevDoneRef.current = step.done;
    if (prev !== false || !step.done) return;
    const t = setTimeout(() => {
      setCelebrating(true);
      if (!reduceMotion) burstAtElement(cardRef.current);
    }, popDelayMs);
    return () => clearTimeout(t);
  }, [step.done, popDelayMs, reduceMotion]);

  const Icon = STEP_ICONS[step.id];
  const locked = step.state === 'locked';
  const current = step.state === 'current';
  const done = step.state === 'done';

  const inner = (
    <motion.div
      ref={cardRef}
      animate={
        reduceMotion
          ? undefined
          : celebrating
            ? { scale: [1, 1.04, 1], transition: { duration: 0.5, ease: 'easeOut' } }
            : { opacity: 1 }
      }
      className={cn(
        MY_HOME_CARD,
        'relative h-full p-4 transition-[box-shadow,opacity] duration-300',
        locked && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          // Subtractive (Phase 1.7): containerless monochrome glyph. State is read
          // from the text tag below (weight/position), not a coloured fill.
          'flex h-10 w-10 items-center justify-center',
          done && 'text-foreground',
          current && 'text-foreground',
          step.state === 'available' && 'text-muted-foreground',
          locked && 'text-muted-foreground/50',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[13.5px] font-semibold leading-snug text-foreground">{step.label}</p>
      <p
        className={cn(
          'mt-1.5 text-[11px] font-medium',
          done && 'text-muted-foreground',
          (current || step.state === 'available') && 'text-orange-700 dark:text-orange-400',
          locked && 'text-muted-foreground/70',
        )}
      >
        {current ? (
          <>
            <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#FF7A59] align-middle" />
            {STATE_TAGS.current}
          </>
        ) : done ? (
          STATE_TAGS.done
        ) : (
          STATE_TAGS[step.state]
        )}
      </p>
    </motion.div>
  );

  if (locked) {
    return <div aria-disabled="true">{inner}</div>;
  }
  return (
    <Link
      to={step.href}
      aria-label={`${step.label} - ${done ? 'done' : STATE_TAGS[step.state]}`}
      className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
    >
      {inner}
    </Link>
  );
}
