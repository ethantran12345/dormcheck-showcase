import { describe, expect, it } from 'vitest';
import {
  buildInviteDescription,
  buildInviteTitle,
  escapeHtml,
  replaceOgTags,
} from '../../api/_lib/og';

const SHELL = `<!doctype html><html><head>
<meta property="og:title" content="DormCheck | Campus Housing Explorer" />
<meta property="og:description" content="Static description." />
<meta property="og:site_name" content="DormCheck" />
<meta property="og:url" content="https://dormcheck.com" />
<meta property="og:type" content="website" />
<meta property="og:image" content="https://dormcheck.com/dormcheck-logo-new.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://dormcheck.com/dormcheck-logo-new.png" />
</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

describe('escapeHtml', () => {
  it('escapes all HTML-attribute-dangerous characters', () => {
    expect(escapeHtml(`Tom & Jerry's <"dorm">`)).toBe(
      'Tom &amp; Jerry&#39;s &lt;&quot;dorm&quot;&gt;',
    );
  });

  it('escapes & first (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('replaceOgTags', () => {
  const tags = {
    title: 'Join my group at Tower A | DormCheck',
    description: 'Team up with verified students.',
    image: 'https://dormcheck.com/api/og-image?kind=roommate&dorm=Tower+A',
    url: 'https://dormcheck.com/roommates/invite/abc',
  };

  it('replaces og and twitter tags, leaving the rest of the shell intact', () => {
    const out = replaceOgTags(SHELL, tags);
    expect(out).toContain('<meta property="og:title" content="Join my group at Tower A | DormCheck" />');
    expect(out).toContain('<meta property="og:description" content="Team up with verified students." />');
    expect(out).toContain('content="https://dormcheck.com/api/og-image?kind=roommate&amp;dorm=Tower+A"');
    expect(out).toContain('<meta property="og:url" content="https://dormcheck.com/roommates/invite/abc" />');
    expect(out).not.toContain('dormcheck-logo-new.png');
    // SPA shell untouched
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(out).toContain('<meta property="og:site_name" content="DormCheck" />');
  });

  it('escapes injected values so user data cannot break out of the attribute', () => {
    const out = replaceOgTags(SHELL, {
      ...tags,
      title: '"/><script>alert(1)</script>',
    });
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&quot;/&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('title/description builders', () => {
  it('uses the dorm name for roommate invites when present', () => {
    expect(buildInviteTitle('roommate', 'Tower A')).toBe('Join my group at Tower A | DormCheck');
    expect(buildInviteTitle('roommate', null)).toBe('Join my roommate group | DormCheck');
    expect(buildInviteTitle('roommate', '  ')).toBe('Join my roommate group | DormCheck');
  });

  it('ranking invites are always generic', () => {
    expect(buildInviteTitle('ranking', 'Tower A')).toBe('Join my dorm-ranking group | DormCheck');
    expect(buildInviteDescription('ranking')).toContain('Rank dorms');
    expect(buildInviteDescription('roommate')).toContain('verified students');
  });
});
