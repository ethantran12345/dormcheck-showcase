import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ListingImage } from '@/components/ui/listing-image';

// Photo treatment contract (identity pass, tell 5).
describe('ListingImage', () => {
  it('renders the designed fallback, named by alt, when there is no photo', () => {
    render(<ListingImage src={null} alt="Mini fridge" />);
    expect(screen.getByRole('img', { name: 'Mini fridge' }).dataset.testid).toBe('listing-image-fallback');
    expect(document.querySelector('img')).toBeNull();
  });

  it('walks thumb -> original, then lands on the fallback instead of a broken image', () => {
    const src = 'https://x.supabase.co/storage/v1/object/public/listings/a.jpg';
    const { container } = render(<ListingImage src={src} alt="Desk lamp" />);
    const real = () => container.querySelector('img:not([aria-hidden])') as HTMLImageElement | null;
    fireEvent.error(real()!);
    expect(real()).not.toBeNull();
    fireEvent.error(real()!);
    expect(real()).toBeNull();
    expect(screen.getByRole('img', { name: 'Desk lamp' })).toBeTruthy();
  });

  it('keeps a decorative photo decorative in its fallback', () => {
    const { container } = render(<ListingImage src="" alt="" kind="business" />);
    expect(container.querySelector('[data-testid="listing-image-fallback"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('crops cover, locks the aspect, and lazy-loads unless priority', () => {
    const { container, rerender } = render(<ListingImage src="/a.jpg" alt="x" aspectClassName="aspect-[4/3]" />);
    const img = container.querySelector('img')!;
    expect(img.className).toContain('object-cover');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(container.firstElementChild!.className).toContain('aspect-[4/3]');
    rerender(<ListingImage src="/a.jpg" alt="x" priority />);
    expect(container.querySelector('img')!.getAttribute('loading')).toBe('eager');
  });

  it('draws a scrim only when asked, and never over the fallback', () => {
    const { container, rerender } = render(<ListingImage src="/a.jpg" alt="x" />);
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
    rerender(<ListingImage src="/a.jpg" alt="x" scrim="bottom" />);
    expect(container.querySelector('.bg-gradient-to-t')).not.toBeNull();
    rerender(<ListingImage src={null} alt="x" scrim="bottom" />);
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
  });
});
