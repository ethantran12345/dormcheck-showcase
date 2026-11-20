import { describe, expect, it } from 'vitest';
import { normalizeBackupCode } from '@/lib/mfa';

// Code generation + hashing moved server-side (mint_backup_codes, migration
// 20260901000003) — the DB-level guarantees (client INSERT denied, aal2 mint
// gate, aal1 redemption, TOTP survival) are pinned by
// supabase/tests/backup_code_mint_and_roommate_contact.test.sql.
describe('mfa backup codes', () => {
  it('normalizes the way use_backup_code() does (trim, lowercase, strip dashes)', () => {
    expect(normalizeBackupCode('  57PH-ech4 ')).toBe('57phech4');
  });
});
