/**
 * Constant-time string equality for secret comparison (BA-05,
 * docs/audits/backend-audit-2026-09-06.md).
 *
 * `a !== b` returns at the first differing byte, so response latency leaks how
 * many leading bytes of a guess were right. send-push's bearer capability token
 * was compared that way and the July audit had recorded it as "constant-time not
 * explicit". Deno's std has no timingSafeEqual for strings and Node's lives in
 * `crypto`, which the Deno bundle does not import, so this is the whole thing:
 * XOR every byte over the LONGER length and fold the length difference in, so
 * the loop count and the result never depend on where the inputs diverge.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
