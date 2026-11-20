/**
 * Accessors for untrusted upstream JSON.
 *
 * Every campus feed is someone else's schema and can change without notice, so
 * responses are typed as `unknown` and narrowed here rather than asserted with
 * `any`. Each helper returns a usable default instead of throwing: a single
 * renamed field should cost one value, not the whole ingest.
 */

export type Raw = Record<string, unknown>;

export function obj(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function rows(value: unknown): Raw[] {
  return arr(value).map(obj);
}

export function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return fallback;
}

export function optionalStr(value: unknown): string | null {
  const text = str(value).trim();
  return text ? text : null;
}

export function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(str(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed);
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
