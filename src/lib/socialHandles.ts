/**
 * Normalizes a social handle for storage. Handles are stored BARE (no leading
 * @) because every display site adds its own, and users type them every which
 * way — "@name", " name ", "na me" from a paste.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, '');
}
