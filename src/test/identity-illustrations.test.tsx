import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import * as Illos from '@/components/illustrations/DormIllustrations';

// Motif rules (docs/DECISIONS.md, identity pass 2026-10-11) as checks, so the set
// cannot drift one drawing at a time.
const entries = Object.entries(Illos).filter(([name]) => name.endsWith('Illustration')) as [
  string,
  ComponentType<Illos.DormIllustrationProps>,
][];

describe('DormIllustrations motif rules', () => {
  it('ships 6 to 8 drawings', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(entries.length).toBeLessThanOrEqual(8);
  });

  it.each(entries)('%s is decorative by default', (_name, Illo) => {
    const { container } = render(<Illo />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('title')).toBeNull();
  });

  it.each(entries)('%s takes an accessible name when given a title', (_name, Illo) => {
    const { getByRole } = render(<Illo title="Moving day" />);
    expect(getByRole('img', { name: 'Moving day' })).toBeTruthy();
  });

  it.each(entries)('%s spends exactly one malachite accent and no literal colour', (_name, Illo) => {
    const { container } = render(<Illo />);
    const accents = container.querySelectorAll('[class*="malachite"]');
    expect(accents.length).toBe(1);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(container.querySelector('text, image, foreignObject')).toBeNull();
  });
});
