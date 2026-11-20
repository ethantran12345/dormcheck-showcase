import { useCallback, useRef, useState } from 'react';

/**
 * FORM UX CRAFT — IPP-3 (Renewal Build Queue item 14).
 *
 * WHAT THIS IS NOT. It is not a form library and it does not own form state. Every
 * form in this app is hand-rolled `useState` (react-hook-form and zod are in
 * package.json but were imported by ZERO files in src/ when this landed), and
 * rebuilding that logic is an explicit non-goal. So this module supplies only the
 * three things the forms were each getting wrong in their own way:
 *
 *   1. WHEN an error is allowed to appear   (useErrorReveal)
 *   2. HOW an error reaches assistive tech  (fieldErrorProps + <FieldError>)
 *   3. WHY a disabled submit is disabled    (firstUnmetRequirement)
 *
 * Values, validators and submit handlers stay exactly where they were.
 *
 * ── 1. THE TIMING RULE ────────────────────────────────────────────────────────
 * Validate on BLUR, or after the FIRST SUBMIT ATTEMPT. Never on every keystroke:
 * telling someone their email is invalid while they are still on the third
 * character is worse than saying nothing, because the message is wrong far more
 * often than it is right and it trains people to ignore it.
 *
 * The nuance that makes this feel good rather than merely correct: reveal is
 * sticky, and once a field is revealed its message tracks the value live. So the
 * error appears when you leave the field, and DISAPPEARS the instant you fix it —
 * you are never told off mid-word, and never left staring at a stale complaint you
 * have already addressed. `shouldReveal` is the reveal gate only; the message
 * itself is derived by the caller from the current value.
 *
 * ── 2. ANNOUNCEMENT ───────────────────────────────────────────────────────────
 * A red border is not an error message. Every field error needs `aria-invalid` on
 * the control, the message linked by `aria-describedby`, and the message node
 * carrying `role="alert"` so it is spoken when it appears. `fieldErrorProps` and
 * <FieldError> (src/components/ui/field-error.tsx) are a matched pair — they agree
 * on the id, which is the part that silently rots when each form hand-writes it.
 *
 * ── 3. DISABLED SUBMITS ───────────────────────────────────────────────────────
 * A disabled button with no reason is worse than an enabled one that errors: the
 * user cannot even find out what is wrong. `firstUnmetRequirement` turns the
 * boolean `canSubmit` a form already computes into the single next thing to fix,
 * which the caller renders beside the button and links with `aria-describedby`.
 * Report ONE requirement, not a list — a list of five is a wall, and the user can
 * only act on one at a time anyway.
 */

/** The DOM id of a field's error node. Single source of truth for the pairing. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/**
 * ARIA wiring for a field that may be showing an error.
 *
 * `describedBy` carries any id the field ALREADY points at (a password-rules hint,
 * a help line). Both must survive: `aria-describedby` is a token list, and
 * clobbering the hint to add the error is a regression dressed as a fix.
 */
export function fieldErrorProps(
  fieldId: string,
  error: string | null | undefined,
  describedBy?: string,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const ids = [describedBy, error ? fieldErrorId(fieldId) : null].filter(Boolean) as string[];
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': ids.length ? ids.join(' ') : undefined,
  };
}

export type ErrorReveal = {
  /** True once this field's error may be shown (it blurred, or submit was tried). */
  shouldReveal: (field: string) => boolean;
  /** Spread onto the control: `{...reveal.blurProps('email')}`. */
  blurProps: (field: string) => { onBlur: () => void };
  /** Mark a field revealed directly (e.g. a control with no real blur event). */
  reveal: (field: string) => void;
  /** Call at the TOP of the submit handler, before any early return. */
  markSubmitAttempted: () => void;
  submitAttempted: boolean;
  /** Un-reveal everything — for a form that resets or switches mode. */
  resetReveal: () => void;
};

/**
 * The timing discipline, in one place. See "THE TIMING RULE" above.
 *
 * Deliberately stores no values and runs no validators: the caller already has
 * both. It only answers "am I allowed to show this yet?".
 */
export function useErrorReveal(): ErrorReveal {
  const [blurred, setBlurred] = useState<ReadonlySet<string>>(() => new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Handlers are cached per field so spreading blurProps() in render doesn't hand
  // the input a new function identity on every keystroke.
  const blurHandlers = useRef(new Map<string, { onBlur: () => void }>());

  const reveal = useCallback((field: string) => {
    setBlurred((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  const blurProps = useCallback(
    (field: string) => {
      const cached = blurHandlers.current.get(field);
      if (cached) return cached;
      const props = { onBlur: () => reveal(field) };
      blurHandlers.current.set(field, props);
      return props;
    },
    [reveal],
  );

  const shouldReveal = useCallback(
    (field: string) => submitAttempted || blurred.has(field),
    [submitAttempted, blurred],
  );

  const resetReveal = useCallback(() => {
    setBlurred(new Set());
    setSubmitAttempted(false);
  }, []);

  return {
    shouldReveal,
    blurProps,
    reveal,
    markSubmitAttempted: useCallback(() => setSubmitAttempted(true), []),
    submitAttempted,
    resetReveal,
  };
}

/** One requirement standing between the user and a working submit button. */
export type SubmitRequirement = {
  /** True when this requirement is already satisfied. */
  met: boolean;
  /** Plain, terse, already translated: "Add at least one photo." */
  reason: string;
};

/**
 * The FIRST unmet requirement, in the order the form lists them — which should be
 * the order the fields appear, so the answer points down the page rather than
 * bouncing around it. Returns null when nothing is blocking (submit is live).
 *
 * In-flight states (isSubmitting) are NOT requirements: the button is busy, not
 * blocked, and "Posting..." already says so.
 */
export function firstUnmetRequirement(
  requirements: readonly SubmitRequirement[],
): string | null {
  return requirements.find((r) => !r.met)?.reason ?? null;
}
