import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAdminEmail,
  buildAdminMailto,
  buildShareUrl,
  classifyWaitlistEmail,
  emailDomain,
  parseWaitlistRank,
  PARTNERSHIP_CC,
  schoolDisplayName,
  submitAdminLead,
} from '@/lib/waitlistGrowth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitAdminLead', () => {
  it('uses the rate-limited server endpoint instead of a direct Supabase insert', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitAdminLead({
      adminName: '  Jane Admin  ',
      adminRole: '  Housing Director ',
      adminEmail: '  jane@rice.edu ',
      schoolDomain: ' Rice.EDU ',
      referredByEmail: ' student@rice.edu ',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/submit-admin-lead');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(options.body))).toEqual({
      adminName: 'Jane Admin',
      adminRole: 'Housing Director',
      adminEmail: 'jane@rice.edu',
      schoolDomain: 'rice.edu',
      referredByEmail: 'student@rice.edu',
    });
  });

  it('returns the existing friendly error when the endpoint rejects the write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(submitAdminLead({
      adminName: 'Jane Admin',
      adminEmail: 'jane@rice.edu',
      schoolDomain: 'rice.edu',
    })).resolves.toEqual({
      ok: false,
      message: 'Something went wrong saving the contact. Please try again.',
    });
  });
});

describe('buildShareUrl', () => {
  it('carries only the school domain, lowercased', () => {
    expect(buildShareUrl('Rice.EDU', 'https://dormcheck.com')).toBe(
      'https://dormcheck.com/waitlist?school=rice.edu',
    );
  });

  it('never contains an @ (no personal emails in share links)', () => {
    expect(buildShareUrl('msu.edu', 'https://dormcheck.com')).not.toContain('@');
  });
});

describe('buildAdminEmail', () => {
  it('personalizes <School> and keeps honest framing', () => {
    const { subject, body } = buildAdminEmail('Rice University');
    expect(subject).toBe(
      'A free move-in platform Rice University students are asking for',
    );
    expect(body).toContain("I'm a student at Rice University");
    expect(body).toContain('systems Rice University already uses, not replace them');
    expect(body).toContain('nothing for your office to run or manage');
    expect(body).toContain('https://dormcheck.com/for-universities');
    // Honesty guardrail: no instant-launch overclaim.
    expect(body.toLowerCase()).not.toContain('immediately');
    expect(body.toLowerCase()).not.toContain('go live on the spot');
    // Copy rules: no em dashes.
    expect(subject).not.toContain('—');
    expect(body).not.toContain('—');
    expect(subject).not.toContain(' - ');
    expect(body).not.toContain(' - ');
    expect(body).not.toContain('$');
  });

  it('adds the live rank line only when rank and total are both known', () => {
    const ranked = buildAdminEmail('Rice University', { rank: 59, totalSchools: 80 });
    expect(ranked.body).toContain(
      "Right now Rice University is #59 of 80 schools on DormCheck's waitlist",
    );

    const preJoin = buildAdminEmail('Rice University', { rank: null, totalSchools: 80 });
    expect(preJoin.body).not.toContain('Right now');
    expect(preJoin.body).toContain("Rice University is on DormCheck's waitlist");

    const noContext = buildAdminEmail('Rice University');
    expect(noContext.body).not.toContain('Right now');
    expect(noContext.body).toContain("Rice University is on DormCheck's waitlist");
  });
});

describe('buildAdminMailto', () => {
  it('targets the admin with the partnership cc and survives decoding', () => {
    const href = buildAdminMailto('jane@rice.edu', 'Rice University');
    expect(href.startsWith('mailto:jane%40rice.edu?')).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('cc')).toBe(PARTNERSHIP_CC);
    expect(query.get('subject')).toContain('Rice University');
    const body = query.get('body') ?? '';
    expect(body.split('\n').length).toBeGreaterThan(5);
    expect(body).toContain('Thanks,');
  });

  it('percent-encodes spaces (no "+" that mail clients render literally)', () => {
    const href = buildAdminMailto('a@b.edu', 'Michigan State');
    expect(href).not.toContain('+');
    expect(href).toContain('%20');
  });
});

describe('parseWaitlistRank', () => {
  it('parses a full payload', () => {
    const parsed = parseWaitlistRank({
      domain: 'rice.edu',
      school_name: 'Rice',
      rank: 2,
      count: 2,
      total_schools: 3,
      nearby: [
        { domain: 'msu.edu', school_name: 'Michigan State', rank: 1, count: 3 },
        { domain: 'rice.edu', school_name: 'Rice', rank: 2, count: 2 },
        { domain: 'cmu.edu', school_name: null, rank: 3, count: 1 },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.rank).toBe(2);
    expect(parsed?.nearby).toHaveLength(3);
    expect(parsed?.nearby[2].school_name).toBeNull();
  });

  it('keeps rank null for a domain with no signups', () => {
    const parsed = parseWaitlistRank({
      domain: 'unknown.edu',
      school_name: null,
      rank: null,
      count: 0,
      total_schools: 3,
      nearby: [],
    });
    expect(parsed?.rank).toBeNull();
    expect(parsed?.count).toBe(0);
  });

  it('returns null for error payloads and junk', () => {
    expect(
      parseWaitlistRank({ domain: 'bad!!', error: 'invalid_domain' }),
    ).toBeNull();
    expect(parseWaitlistRank(null)).toBeNull();
    expect(parseWaitlistRank('nope')).toBeNull();
  });
});

describe('emailDomain', () => {
  it('extracts and lowercases the domain', () => {
    expect(emailDomain('Student@Rice.EDU')).toBe('rice.edu');
  });
  it('rejects non-addresses', () => {
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain('@rice.edu')).toBeNull();
    expect(emailDomain('a@')).toBeNull();
  });
});

describe('classifyWaitlistEmail (cold-start /waitlist)', () => {
  it('rejects non-.edu and malformed addresses', () => {
    expect(classifyWaitlistEmail('foo@gmail.com')).toEqual({ kind: 'invalid' });
    expect(classifyWaitlistEmail('not-an-email')).toEqual({ kind: 'invalid' });
    expect(classifyWaitlistEmail('')).toEqual({ kind: 'invalid' });
    expect(classifyWaitlistEmail('a b@rice.edu')).toEqual({ kind: 'invalid' });
  });

  it('routes active-university (Pitt) emails to sign-in, not the waitlist', () => {
    expect(classifyWaitlistEmail('student@pitt.edu')).toEqual({ kind: 'active' });
    expect(classifyWaitlistEmail('  Student@PITT.EDU ')).toEqual({ kind: 'active' });
  });

  it('extracts the lowercased domain for other .edu emails', () => {
    expect(classifyWaitlistEmail('Student@Rice.EDU')).toEqual({
      kind: 'waitlist',
      domain: 'rice.edu',
    });
    expect(classifyWaitlistEmail('a@mail.school.edu')).toEqual({
      kind: 'waitlist',
      domain: 'mail.school.edu',
    });
  });
});

describe('schoolDisplayName', () => {
  it('prefers the recorded name, falls back to the domain', () => {
    expect(schoolDisplayName('rice.edu', 'Rice University')).toBe('Rice University');
    expect(schoolDisplayName('rice.edu', '  ')).toBe('rice.edu');
    expect(schoolDisplayName('rice.edu', null)).toBe('rice.edu');
  });

  it('passes a directory-resolved name through untouched', () => {
    expect(schoolDisplayName('cmu.edu', 'Carnegie Mellon University')).toBe(
      'Carnegie Mellon University',
    );
  });
});

describe('school directory seed', () => {
  const seedSql = readFileSync(
    resolve(__dirname, '../../supabase/seed/seed_school_directory.sql'),
    'utf8',
  );
  const rows = [...seedSql.matchAll(/\('([^']+)',\s*'((?:[^']|'')+)'\)/g)].map((m) => ({
    domain: m[1],
    name: m[2].replace(/''/g, "'"),
  }));

  it('resolves rice.edu to Rice University (directory-known domain)', () => {
    expect(rows.find((r) => r.domain === 'rice.edu')?.name).toBe('Rice University');
  });

  it('includes the hand-added cmu.edu gap fix', () => {
    expect(rows.find((r) => r.domain === 'cmu.edu')?.name).toBe('Carnegie Mellon University');
  });

  it('has no duplicate email domains (school_directory PK)', () => {
    expect(rows.length).toBeGreaterThan(1500);
    expect(new Set(rows.map((r) => r.domain)).size).toBe(rows.length);
  });

  it('pre-join branch of get_waitlist_rank resolves the name from the directory', () => {
    const migrationSql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260710061422_waitlist_prejoin_name.sql'),
      'utf8',
    );
    const preJoinBranch = migrationSql.slice(
      migrationSql.indexOf('WHEN NOT EXISTS (SELECT 1 FROM self)'),
      migrationSql.indexOf('ELSE'),
    );
    expect(preJoinBranch).toContain(
      'SELECT university_name FROM public.school_directory',
    );
    expect(preJoinBranch).not.toContain("'school_name', NULL");
  });
});

describe('parseWaitlistRank pre-join payload', () => {
  it('keeps a directory-resolved name at zero signups (rank null, count 0)', () => {
    const parsed = parseWaitlistRank({
      domain: 'rice.edu',
      school_name: 'Rice University',
      rank: null,
      count: 0,
      total_schools: 12,
      nearby: [],
    });
    expect(parsed).toEqual({
      domain: 'rice.edu',
      school_name: 'Rice University',
      rank: null,
      count: 0,
      total_schools: 12,
      nearby: [],
    });
  });
});
