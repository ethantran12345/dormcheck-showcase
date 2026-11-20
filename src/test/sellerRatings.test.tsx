import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarRatingDisplay, StarRatingInput } from '@/components/marketplace/StarRating';

describe('StarRatingDisplay', () => {
  it('announces the rounded value and count', () => {
    render(<StarRatingDisplay value={4.76} count={12} />);
    expect(
      screen.getByRole('img', { name: 'Rated 4.8 out of 5 stars from 12 ratings' })
    ).toBeTruthy();
    expect(screen.getByText('4.8')).toBeTruthy();
    expect(screen.getByText('(12)')).toBeTruthy();
  });

  it('uses singular wording for one rating and omits the count when not given', () => {
    const { unmount } = render(<StarRatingDisplay value={5} count={1} />);
    expect(
      screen.getByRole('img', { name: 'Rated 5 out of 5 stars from 1 rating' })
    ).toBeTruthy();
    unmount();

    render(<StarRatingDisplay value={3.2} />);
    expect(screen.getByRole('img', { name: 'Rated 3.2 out of 5 stars' })).toBeTruthy();
  });
});

describe('StarRatingInput', () => {
  it('renders a radiogroup of five labeled star radios', () => {
    render(<StarRatingInput value={3} onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Star rating' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 stars' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(screen.getByRole('radio', { name: '1 star' }).getAttribute('aria-checked')).toBe(
      'false'
    );
  });

  it('reports the clicked star and steps with arrow keys', () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    expect(onChange).toHaveBeenLastCalledWith(5);

    fireEvent.keyDown(screen.getByRole('radio', { name: '2 stars' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(3);

    fireEvent.keyDown(screen.getByRole('radio', { name: '2 stars' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps arrow-key stepping to the 1 to 5 range', () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: '5 stars' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});
