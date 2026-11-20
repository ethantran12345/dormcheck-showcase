/**
 * Single source of truth for the signup password policy.
 *
 * These rules MUST mirror the live Supabase Auth password policy exactly
 * (Dashboard -> Authentication -> Policies): minimum length plus one character
 * from each required class. A client/server mismatch is what produces the
 * "looks valid, still rejected" bug, so keep this in sync and keep each rule at
 * least as strict as GoTrue.
 *
 * Confirmed policy: min 6 chars + a lowercase letter + an uppercase letter + a
 * digit + a symbol.
 */

export const PASSWORD_MIN_LENGTH = 6;

/**
 * The exact symbol set GoTrue counts as "symbols" for
 * `password_required_characters`. Mirroring it (rather than "any non
 * alphanumeric") keeps the client rule from disagreeing with the server.
 */
export const SYMBOL_CHARACTERS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export interface PasswordRule {
  /** Stable id, handy for React keys and tests. */
  id: 'length' | 'lowercase' | 'uppercase' | 'number' | 'symbol';
  /** User-facing requirement copy (no em dashes). */
  label: string;
  /** Whether the given password satisfies this rule. */
  met: boolean;
}

const hasSymbol = (pw: string): boolean =>
  [...pw].some((char) => SYMBOL_CHARACTERS.includes(char));

/**
 * Evaluate a password against every policy rule, in display order. Rules are
 * always returned (met true/false) so the UI can render a live checklist.
 */
export function evaluatePassword(pw: string): PasswordRule[] {
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: pw.length >= PASSWORD_MIN_LENGTH },
    { id: 'lowercase', label: 'A lowercase letter', met: /[a-z]/.test(pw) },
    { id: 'uppercase', label: 'An uppercase letter', met: /[A-Z]/.test(pw) },
    { id: 'number', label: 'A number', met: /[0-9]/.test(pw) },
    { id: 'symbol', label: 'A symbol', met: hasSymbol(pw) },
  ];
}

/** True only when every policy rule is met. */
export function isPasswordValid(pw: string): boolean {
  return evaluatePassword(pw).every((rule) => rule.met);
}

/** Friendly copy shown when the server rejects a password for policy reasons. */
export const PASSWORD_POLICY_MESSAGE =
  `Your password doesn't meet all the requirements. It needs at least ${PASSWORD_MIN_LENGTH} characters and must include a lowercase letter, an uppercase letter, a number, and a symbol.`;

/**
 * Translate a Supabase/GoTrue password-strength error into readable copy,
 * or return null when the error is something else (transport, unknown) so the
 * caller can fall back to its generic error handling.
 *
 * Detects GoTrue's `weak_password` code and its raw character-class dump
 * ("Password should contain at least one character of each: abcdefghij...").
 */
export function mapPasswordPolicyServerError(err: unknown): string | null {
  const e = err as { message?: string; code?: string; name?: string } | null;
  const code = e?.code?.toLowerCase();
  const message = (e?.message ?? '').toLowerCase();

  const isPolicyError =
    code === 'weak_password' ||
    message.includes('password should contain at least one character of each') ||
    message.includes('password should be at least') ||
    /abcdefghij/.test(message);

  return isPolicyError ? PASSWORD_POLICY_MESSAGE : null;
}
