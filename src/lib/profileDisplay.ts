/**
 * First letter of the first name-like token for avatar placeholders.
 * Returns null when there is no suitable letter (e.g. "Anonymous", empty).
 */
export function getFirstNameInitial(displayName: string): string | null {
  const t = displayName.trim();
  if (!t) return null;
  if (/^anonymous$/i.test(t)) return null;
  const firstToken = t.split(/\s+/)[0] ?? '';
  const alnum = firstToken.replace(/[^a-zA-Z0-9]/g, '');
  const ch = alnum[0];
  if (!ch) return null;
  return ch.toUpperCase();
}
