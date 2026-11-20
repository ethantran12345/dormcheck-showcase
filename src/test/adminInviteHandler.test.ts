import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * api/admin-invite.ts — the delegation rails that live in the handler.
 *
 * The DB rails are asserted where a client actually reaches them, in
 * supabase/tests/admin_invitations_rails.test.sql. This file covers the checks that exist
 * ONLY here and have no database equivalent:
 *   · the invited address must match the target school's email_domains
 *   · an inactive school cannot be invited into at all
 *   · an existing superadmin is untouchable by a university_admin
 *   · every path that changes anything writes an admin_audit_log row
 * plus the delegation clamps, which are asserted in both places on purpose: this handler runs
 * with the SERVICE ROLE, which bypasses RLS and the protect_profile_role trigger entirely, so
 * for these requests the handler's own checks are the only enforcement there is. A rail that
 * is real in the database is not automatically real here.
 *
 * Before this file the feature had no tests at all (verified 2026-08-06:
 * `git log --all -S'set_admin_role' -- src/test supabase/tests e2e` returned nothing).
 */

// ── a small fake PostgREST client ────────────────────────────────────────────────────────
// Chainable and thenable, because the handler awaits builders directly
// (`await supabase.from('admin_audit_log').insert({...})`) as well as via .maybeSingle().
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const DEFAULTS: Record<string, Row> = { admin_invitations: { status: 'pending' } };

type Result = { data: unknown; error: unknown };

class Builder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row | null = null;
  private wantSingle = false;

  constructor(private table: string) {}

  select(_cols?: string) {
    if (this.op === 'select') this.op = 'select';
    return this;
  }
  insert(row: Row) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push((r) => String(r[col] ?? '').toLowerCase() === val.toLowerCase());
    return this;
  }
  maybeSingle() {
    this.wantSingle = true;
    return this.run();
  }
  single() {
    this.wantSingle = true;
    return this.run();
  }
  then<T1 = Result, T2 = never>(
    onFulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onFulfilled, onRejected);
  }

  private async run() {
    const rows = (db[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === 'insert') {
      // Column DEFAULTS matter to fidelity. `admin_invitations.status` defaults to 'pending'
      // in the migration and the handler never passes it on the invite path, so a fake without
      // defaults makes the resend lookup miss and the handler stack a SECOND invitation row —
      // which is the bug the resend path exists to prevent. A fake that cannot reproduce the
      // bug cannot prove the fix.
      const row = {
        id: `${this.table}-${rows.length + 1}`,
        token: `token-${rows.length + 1}`,
        ...(DEFAULTS[this.table] ?? {}),
        ...this.payload,
      };
      rows.push(row);
      return { data: this.wantSingle ? row : [row], error: null };
    }
    if (this.op === 'update') {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, this.payload));
      return { data: hit, error: null };
    }
    const found = rows.filter(match);
    return { data: this.wantSingle ? (found[0] ?? null) : found, error: null };
  }
}

const fakeSupabase = { from: (t: string) => new Builder(t) };

let authedUser: { id: string; email: string } | null = { id: 'caller', email: 'caller@pitt.edu' };
const sentGranted: string[] = [];
const sentInvites: string[] = [];

vi.mock('../../api/_lib/supabase.js', () => ({ get supabase() { return fakeSupabase; } }));
vi.mock('../../api/_lib/auth.js', () => ({
  getAuthedUser: async () => authedUser,
  getCallerName: async () => 'Caller Name',
}));
vi.mock('../../api/_lib/cors.js', () => ({ applyCors: () => false }));
vi.mock('../../api/_lib/rateLimit.js', () => ({ enforceRateLimit: async () => true }));
vi.mock('../../api/_lib/notifications.js', () => ({
  sendAdminInviteEmail: async (email: string) => { sentInvites.push(email); },
  sendAdminGrantedEmail: async (email: string) => { sentGranted.push(email); },
}));

const { default: handler } = await import('../../api/admin-invite.js');

const PITT = 'uni-pitt';
const OTHER = 'uni-other';
const CLOSED = 'uni-closed';

function reset(callerRole: 'user' | 'university_admin' | 'superadmin', callerUni: string | null = PITT) {
  for (const k of Object.keys(db)) delete db[k];
  sentGranted.length = 0;
  sentInvites.length = 0;
  authedUser = { id: 'caller', email: 'caller@pitt.edu' };
  db.universities = [
    { id: PITT, name: 'University of Pittsburgh', email_domains: ['pitt.edu'], is_active: true },
    { id: OTHER, name: 'Other University', email_domains: ['other.edu'], is_active: true },
    { id: CLOSED, name: 'Not Launched University', email_domains: ['closed.edu'], is_active: false },
  ];
  db.profiles = [{ id: 'caller', role: callerRole, university_id: callerUni, email: 'caller@pitt.edu' }];
  db.admin_invitations = [];
  db.admin_audit_log = [];
}

type Payload = { error?: string; status?: string; ok?: boolean };
interface FakeRes {
  statusCode: number;
  payload: Payload;
  status(code: number): FakeRes;
  json(p: Payload): FakeRes;
}

async function post(body: Record<string, unknown>): Promise<FakeRes> {
  const res: FakeRes = {
    statusCode: 0,
    payload: {},
    status(code: number) { this.statusCode = code; return this; },
    json(p: Payload) { this.payload = p; return this; },
  };
  await handler({ method: 'POST', body, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
}

const auditActions = () => (db.admin_audit_log ?? []).map((r) => r.action);

describe('admin-invite: who the caller is', () => {
  beforeEach(() => reset('university_admin'));

  it('refuses an unauthenticated caller', async () => {
    authedUser = null;
    const res = await post({ email: 'new@pitt.edu' });
    expect(res.statusCode).toBe(401);
    expect(auditActions()).toEqual([]);
  });

  it('refuses a plain user', async () => {
    reset('user');
    const res = await post({ email: 'new@pitt.edu' });
    expect(res.statusCode).toBe(403);
    expect(db.admin_invitations).toEqual([]);
    expect(auditActions()).toEqual([]);
  });
});

describe('admin-invite: what a university_admin may delegate', () => {
  beforeEach(() => reset('university_admin'));

  it('refuses to mint a superadmin', async () => {
    const res = await post({ email: 'new@pitt.edu', role: 'superadmin' });
    expect(res.statusCode).toBe(403);
    expect(res.payload.error ?? '').toMatch(/only invite university admins/i);
    expect(db.admin_invitations).toEqual([]);
  });

  it('refuses to invite into another school', async () => {
    const res = await post({ email: 'new@other.edu', universityId: OTHER });
    expect(res.statusCode).toBe(403);
    expect(res.payload.error ?? '').toMatch(/your own school/i);
    expect(db.admin_invitations).toEqual([]);
  });

  it("refuses an address outside the school's email domains", async () => {
    const res = await post({ email: 'someone@gmail.com' });
    expect(res.statusCode).toBe(400);
    expect(res.payload.error ?? '').toMatch(/school email/i);
    expect(db.admin_invitations).toEqual([]);
  });

  it('refuses a school that is not live yet', async () => {
    reset('superadmin'); // only a superadmin can even name another school
    const res = await post({ email: 'someone@closed.edu', universityId: CLOSED });
    expect(res.statusCode).toBe(400);
    expect(res.payload.error ?? '').toMatch(/unknown or inactive/i);
    expect(db.admin_invitations).toEqual([]);
  });

  it('refuses to touch someone who is already a superadmin', async () => {
    db.profiles.push({ id: 'sa', role: 'superadmin', university_id: PITT, email: 'boss@pitt.edu' });
    const res = await post({ email: 'boss@pitt.edu' });
    expect(res.statusCode).toBe(403);
    expect(res.payload.error ?? '').toMatch(/higher admin role/i);
    expect(db.profiles.find((p) => p.id === 'sa')!.role).toBe('superadmin');
    expect(auditActions()).toEqual([]);
  });
});

describe('admin-invite: the paths that change something all audit', () => {
  beforeEach(() => reset('university_admin'));

  it('grants immediately to an existing account, and audits it', async () => {
    db.profiles.push({ id: 'existing', role: 'user', university_id: PITT, email: 'existing@pitt.edu' });
    const res = await post({ email: 'existing@pitt.edu' });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe('granted');
    expect(db.profiles.find((p) => p.id === 'existing')!.role).toBe('university_admin');
    expect(auditActions()).toEqual(['admin.grant']);
    expect(sentGranted).toEqual(['existing@pitt.edu']);
    // The accepted invitation row is the audit trail's companion: without it the Team page
    // shows a grant that has no invitation history.
    expect(db.admin_invitations).toHaveLength(1);
    expect(db.admin_invitations[0]).toMatchObject({ status: 'accepted', accepted_by: 'existing' });
  });

  it('creates a pending invitation for an address with no account, and audits it', async () => {
    const res = await post({ email: 'newbie@pitt.edu' });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe('invited');
    expect(db.admin_invitations).toHaveLength(1);
    expect(db.admin_invitations[0]).toMatchObject({
      email: 'newbie@pitt.edu',
      role: 'university_admin',
      university_id: PITT,
      invited_by: 'caller',
    });
    expect(auditActions()).toEqual(['admin.invite']);
    expect(sentInvites).toEqual(['newbie@pitt.edu']);
  });

  it('resends on the existing row instead of stacking a second invitation, and audits it', async () => {
    await post({ email: 'newbie@pitt.edu' });
    const res = await post({ email: 'newbie@pitt.edu' });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe('resent');
    expect(db.admin_invitations).toHaveLength(1);
    expect(auditActions()).toEqual(['admin.invite', 'admin.invite_resent']);
  });

  it('normalises the address, so case cannot create a duplicate invitation', async () => {
    await post({ email: 'newbie@pitt.edu' });
    const res = await post({ email: '  NewBie@Pitt.EDU  ' });
    expect(res.payload.status).toBe('resent');
    expect(db.admin_invitations).toHaveLength(1);
    expect(db.admin_invitations[0].email).toBe('newbie@pitt.edu');
  });
});

describe('admin-invite: a superadmin is not clamped', () => {
  beforeEach(() => reset('superadmin'));

  it('may mint a superadmin', async () => {
    const res = await post({ email: 'peer@pitt.edu', role: 'superadmin' });
    expect(res.statusCode).toBe(200);
    expect(db.admin_invitations[0].role).toBe('superadmin');
  });

  it('may invite into another school', async () => {
    const res = await post({ email: 'peer@other.edu', universityId: OTHER });
    expect(res.statusCode).toBe(200);
    expect(db.admin_invitations[0].university_id).toBe(OTHER);
  });
});
