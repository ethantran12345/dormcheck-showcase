import { cn } from '@/lib/utils';
import { fieldErrorId } from '@/lib/formCraft';

/**
 * The one way a form field reports an error — IPP-3 (queue item 14).
 *
 * Pairs with `fieldErrorProps(fieldId, error)` in src/lib/formCraft.ts: that puts
 * `aria-invalid` + `aria-describedby` on the CONTROL, this renders the message the
 * describedby points at. Both derive the id from `fieldId`, so the two halves
 * cannot drift apart the way hand-written id strings did.
 *
 * WHY role="alert". A red border communicates nothing to a screen reader, and a
 * message that merely exists in the DOM is not announced. `role="alert"` is an
 * implicit aria-live=assertive region, so mounting this node speaks it. That is the
 * difference between a form that is styled accessibly and one that is usable.
 *
 * COLOUR: `text-red-700`, not `text-destructive` — matching the existing error text
 * in Auth.tsx, and dark enough for AA on the light card backgrounds these forms sit
 * on. Never rely on colour alone; the text IS the error.
 *
 * LAYOUT: renders nothing when there is no message. Errors appear and disappear
 * under a field, so the surrounding container should own its spacing (`space-y-*`)
 * rather than this node reserving a slot — a reserved empty slot on every field of
 * a long form costs more than the shift it prevents. Where a form genuinely cannot
 * take the reflow, give the wrapper a `min-h`; do not make that this component's
 * default and pay for it everywhere.
 */
export function FieldError({
  fieldId,
  message,
  className,
}: {
  /** The id of the control this describes — NOT the id of this node. */
  fieldId: string;
  /** Falsy renders nothing. Already translated. */
  message?: string | null | false;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={fieldErrorId(fieldId)}
      role="alert"
      className={cn('text-xs font-medium text-red-700', className)}
    >
      {message}
    </p>
  );
}

/**
 * The reason a submit button is disabled, rendered beside it — IPP-3 item 5.
 *
 * `aria-live="polite"`, not `role="alert"`: this text CHANGES as the user fills the
 * form out (one requirement replacing another), and an assertive region would
 * interrupt them repeatedly while they work. Polite waits for a pause.
 *
 * Link it to the button with `aria-describedby={submitBlockedId(id)}` so someone
 * who lands on the disabled button is told why, instead of finding a dead control.
 */
export function SubmitBlockedReason({
  id,
  reason,
  className,
}: {
  id: string;
  reason?: string | null;
  className?: string;
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn('text-xs text-muted-foreground', className)}
    >
      {reason ?? ''}
    </p>
  );
}
