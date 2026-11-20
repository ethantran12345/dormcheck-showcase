import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ConversationListSkeleton,
  HomePageSkeleton,
  ListingTileSkeleton,
  SubleaseListSkeleton,
} from '@/components/skeletons/ContentSkeletons';

describe('content-shaped skeletons (identity pass, tell 4)', () => {
  it('uses the calm token-driven animation, static under Reduce Motion, never the stock pulse', () => {
    const { container } = render(<Skeleton />);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain('animate-skeleton');
    expect(cls).toContain('motion-reduce:animate-none');
    expect(cls).not.toContain('animate-pulse');
  });

  it.each([
    ['conversation list', <ConversationListSkeleton key="c" />],
    ['listing tile', <ListingTileSkeleton key="l" />],
    ['sublease list', <SubleaseListSkeleton key="s" />],
    ['home page', <HomePageSkeleton key="h" />],
  ])('%s is hidden from assistive tech and carries no raw pulse', (_name, node) => {
    const { container } = render(node);
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(container.innerHTML).not.toContain('animate-pulse');
  });

  it('conversation rows mirror the real row: 44px avatar circle, varied preview widths', () => {
    const { container } = render(<ConversationListSkeleton rows={3} />);
    expect(container.querySelectorAll('.h-11.w-11.rounded-full')).toHaveLength(3);
    const previews = [...container.querySelectorAll('.h-3')].map((n) => n.className);
    expect(new Set(previews).size).toBeGreaterThan(1);
  });
});
