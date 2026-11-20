import { useEffect } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { GuidedSubStep } from '@/data/moveInGuidedFlows';

/**
 * Renders a guided mini-flow under a move-in step: each sub-step is individually
 * checkable and links out to Pitt's real system (an extension, never a
 * replacement). Sub-step completion persists in the SAME move-in logistics store
 * (synthetic ids `${stepId}::${key}`); when all sub-steps are done the parent
 * step is marked done too, so phase progress and the (derived) step checkmark
 * stay in sync. Flow definitions live in `@/data/moveInGuidedFlows`.
 */
const subId = (stepId: string, key: string) => `${stepId}::${key}`;

/**
 * Renders one guided flow under its move-in step. Each sub-step is individually
 * checkable and links out to Pitt's real system; completing all of them rolls up
 * to the parent step.
 */
export function GuidedFlow({
  stepId,
  subSteps,
  doneIds,
  toggle,
}: {
  stepId: string;
  subSteps: GuidedSubStep[];
  doneIds: Set<string>;
  toggle: (id: string) => void;
}) {
  const allDone = subSteps.length > 0 && subSteps.every((s) => doneIds.has(subId(stepId, s.key)));
  const parentDone = doneIds.has(stepId);

  // Roll completed sub-steps up to the parent step. One-directional on purpose:
  // completing every sub-step marks the parent done, but we never auto-un-mark -
  // so a legacy user who'd already checked this step off doesn't lose that
  // progress just because the new sub-steps aren't tracked yet.
  useEffect(() => {
    if (allDone && !parentDone) toggle(stepId);
  }, [allDone, parentDone, stepId, toggle]);

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">
        Guided steps
      </p>
      <ol className="space-y-2.5">
        {subSteps.map((s) => {
          const id = subId(stepId, s.key);
          const done = doneIds.has(id);
          return (
            <li key={s.key}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => toggle(id)}
                aria-pressed={done}
                // [&_svg]:size-3 keeps the 12px check off the base [&_svg]:size-4.
                className="flex h-auto w-full items-start gap-2.5 rounded-none p-0 text-left font-normal hover:bg-transparent [&_svg]:size-3"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90',
                    done
                      ? 'border-malachite-600 bg-malachite-800 text-white'
                      : 'border-muted-foreground/30 text-transparent',
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm font-medium text-foreground',
                      done && 'text-muted-foreground line-through',
                    )}
                  >
                    {s.label}
                  </span>
                  {s.detail && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {s.detail}
                    </span>
                  )}
                </span>
              </Button>
              {s.href && (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-[30px] mt-1 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  {s.hrefLabel ?? 'Open in Pitt'}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
