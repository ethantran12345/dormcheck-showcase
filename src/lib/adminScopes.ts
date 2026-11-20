import type { AppRole } from '@/hooks/useAuth';

/**
 * Capability scopes for delegated (university_admin) accounts. Mirrors the DB
 * helper public.has_admin_scope (20260731020000): superadmins always pass;
 * NULL scopes = all scopes (pre-scope behavior); a non-null array narrows the
 * admin to the listed areas. UI-side convenience only - the DB helper and
 * server routes are the enforcement.
 */
export const ADMIN_SCOPES = [
  'broadcasts',
  'listings',
  'reports',
  'dorms',
  'resources',
  'team',
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];

export function hasAdminScope(
  role: AppRole,
  adminScopes: string[] | null,
  scope: AdminScope,
): boolean {
  if (role === 'superadmin') return true;
  if (role !== 'university_admin') return false;
  return adminScopes === null || adminScopes.includes(scope);
}
