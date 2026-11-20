import { ImageResponse } from '@vercel/og';
import type { ReactElement } from 'react';

// Branded 1200x630 Open Graph card for invite links (referenced by
// api/og-invite.ts). Edge runtime — @vercel/og requires it.
// Uses satori's plain object-element format (Vercel compiles api/ without
// a jsx flag, so no .tsx here).
// Design rules: brand green #03C03C as accent only, dark text on white
// (AA), no private data, no dollar amounts. The "DormCheck" wordmark renders
// in Sora (brand wordmark font), fetched at the edge from our own origin
// (/fonts/Sora-Bold.ttf); everything else uses the system font. If the font
// fetch fails the wordmark degrades to the system font so the card always
// renders.

export const config = { runtime: 'edge' };

const MALACHITE = '#03C03C';
const MAX_DORM_LEN = 80;

type Node = { type: string; props: Record<string, unknown> };

function el(type: string, style: Record<string, unknown>, children?: Node[] | string): Node {
  return { type, props: { style, children } };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const { searchParams } = url;
  const kind = searchParams.get('kind') === 'ranking' ? 'ranking' : 'roommate';
  const dorm = (searchParams.get('dorm') ?? '').slice(0, MAX_DORM_LEN).trim();

  // Load the Sora wordmark font from our own origin. Degrade to the system
  // font if it can't be fetched so the card always renders.
  let soraData: ArrayBuffer | null = null;
  try {
    const fontRes = await fetch(new URL('/fonts/Sora-Bold.ttf', url.origin), {
      signal: AbortSignal.timeout(3000),
    });
    if (fontRes.ok) soraData = await fontRes.arrayBuffer();
  } catch {
    soraData = null;
  }
  const wordmarkFont = soraData ? 'Sora' : 'sans-serif';

  const headline = kind === 'ranking' ? 'Rank dorms with your friends' : 'Join my roommate group';
  const subline = dorm || 'The verified student hub for move-in';

  const accentBar = () => el('div', { display: 'flex', height: 24, backgroundColor: MALACHITE });

  const card = el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#ffffff',
      fontFamily: 'sans-serif',
    },
    [
      accentBar(),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          justifyContent: 'center',
          padding: '0 96px',
        },
        [
          el('div', { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }, [
            el('div', {
              display: 'flex',
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: MALACHITE,
            }),
            el(
              'div',
              {
                display: 'flex',
                fontSize: 40,
                fontWeight: 700,
                color: '#111827',
                fontFamily: wordmarkFont,
              },
              'DormCheck',
            ),
          ]),
          el(
            'div',
            { display: 'flex', fontSize: 76, fontWeight: 800, color: '#111827', lineHeight: 1.1 },
            headline,
          ),
          el('div', { display: 'flex', fontSize: 44, color: '#374151', marginTop: 28 }, subline),
          el(
            'div',
            {
              display: 'flex',
              alignSelf: 'flex-start',
              marginTop: 56,
              padding: '18px 40px',
              borderRadius: 16,
              border: `4px solid ${MALACHITE}`,
              fontSize: 36,
              fontWeight: 700,
              color: '#111827',
            },
            'Tap to join',
          ),
        ],
      ),
      accentBar(),
    ],
  );

  // Satori accepts plain object elements; the ReactElement type is JSX-only.
  return new ImageResponse(card as unknown as ReactElement, {
    width: 1200,
    height: 630,
    headers: { 'Cache-Control': 'public, s-maxage=86400' },
    ...(soraData
      ? { fonts: [{ name: 'Sora', data: soraData, weight: 700 as const, style: 'normal' as const }] }
      : {}),
  });
}
