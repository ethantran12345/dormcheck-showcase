import { describe, it, expect } from 'vitest';
import { hasAdminScope } from '@/lib/adminScopes';

describe('hasAdminScope (mirrors public.has_admin_scope)', () => {
  it('superadmin passes every scope regardless of the column', () => {
    expect(hasAdminScope('superadmin', null, 'broadcasts')).toBe(true);
    expect(hasAdminScope('superadmin', [], 'broadcasts')).toBe(true);
    expect(hasAdminScope('superadmin', ['listings'], 'broadcasts')).toBe(true);
  });

  it('plain user never passes', () => {
    expect(hasAdminScope('user', null, 'broadcasts')).toBe(false);
    expect(hasAdminScope('user', ['broadcasts'], 'broadcasts')).toBe(false);
  });

  it('university_admin with NULL scopes has all scopes (pre-scope behavior)', () => {
    expect(hasAdminScope('university_admin', null, 'broadcasts')).toBe(true);
    expect(hasAdminScope('university_admin', null, 'team')).toBe(true);
  });

  it('university_admin with a scope list is narrowed to it', () => {
    expect(hasAdminScope('university_admin', ['broadcasts'], 'broadcasts')).toBe(true);
    expect(hasAdminScope('university_admin', ['listings'], 'broadcasts')).toBe(false);
    expect(hasAdminScope('university_admin', [], 'broadcasts')).toBe(false);
  });
});
