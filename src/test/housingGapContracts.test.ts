import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const read = (path: string) => readRepo(resolve('src', path));

describe('housing gap contracts', () => {
  it('never presents mock room photos as housing evidence', () => {
    for (const path of ['pages/app/Index.tsx', 'pages/app/HousingDetailPage.tsx']) {
      const source = read(path);
      expect(source).not.toContain("from '@/data/mockData'");
      expect(source).not.toContain('roomPhotos.filter');
      expect(source).toContain('photos={[]}');
    }
  });

  it('treats search as an additional predicate instead of bypassing visible filters', () => {
    const source = read('pages/app/Index.tsx');
    expect(source).toContain('if (lowerQuery &&');
    expect(source).toContain("if (audienceFilter !== 'all'");
    expect(source).not.toContain('Bypass filters on search');
    expect(source).not.toMatch(/if \(q\) \{[\s\S]{0,240}return dorms\.filter/);
  });

  it('publishes the saved count while housing explore owns the heart', () => {
    const source = read('pages/app/Index.tsx');
    expect(source).toContain('setSavedCount?.(savedDormIds.size)');
    expect(source).toContain('setSavedCount?.(null)');
  });

  // The obsolete /dorms stub is retired at the EDGE, not in the router. A
  // client-side <Navigate> would boot the SPA on a path outside MARKETING_PATHS
  // and then hand off to an app route — the one-frame marketing->app chrome swap
  // fixed on `/` — and would do it for anonymous visitors, whom `layoutAuthed`
  // cannot distinguish. These four assertions pin every place the path could
  // come back: the router, the chrome list, the pre-paint theme mirror, and the
  // redirect itself.
  it('retires the obsolete /dorms stub at the edge, not in the router', () => {
    const routes = read('routes/MarketingRoutes.tsx');
    expect(routes).not.toContain('path="/dorms"');
    expect(routes).not.toContain('@/pages/marketing/Dorms');

    expect(read('routes/marketingPaths.ts')).not.toContain('"/dorms"');
    expect(readRepo('public/theme-init.js')).not.toContain("'/dorms'");

    const vercel = JSON.parse(readRepo('vercel.json')) as {
      redirects?: { source: string; destination: string; permanent?: boolean }[];
    };
    expect(vercel.redirects).toContainEqual({
      source: '/dorms',
      destination: '/campus',
      permanent: true,
    });
  });
});
