import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarRatingInput } from '@/components/ui/star-rating';

describe('StarRatingInput (half-step)', () => {
  it('exposes slider semantics with the current value', () => {
    render(<StarRatingInput value={3.5} onChange={() => {}} label="Room Quality" />);
    const slider = screen.getByRole('slider', { name: 'Room Quality' });
    expect(slider.getAttribute('aria-valuenow')).toBe('3.5');
    expect(slider.getAttribute('aria-valuetext')).toBe('3.5 out of 5 stars');
    expect(slider.getAttribute('aria-valuemax')).toBe('5');
  });

  it('announces an unrated control rather than defaulting to zero', () => {
    render(<StarRatingInput value={null} onChange={() => {}} label="Community" />);
    const slider = screen.getByRole('slider', { name: 'Community' });
    expect(slider.getAttribute('aria-valuenow')).toBeNull();
    expect(slider.getAttribute('aria-valuetext')).toBe('Not rated');
  });

  it('steps by half a star with the arrow keys', () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={3} onChange={onChange} label="Location" />);
    const slider = screen.getByRole('slider', { name: 'Location' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(3.5);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });

  it('clamps at both ends instead of wrapping or going to zero', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StarRatingInput value={5} onChange={onChange} label="Student Life" />,
    );
    const slider = screen.getByRole('slider', { name: 'Student Life' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(5);

    rerender(<StarRatingInput value={0.5} onChange={onChange} label="Student Life" />);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    // 0.5 is the floor: there is no such thing as a zero-star rating.
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });

  it('offers a half and a whole hit target for every star', () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={null} onChange={onChange} label="Room Quality" />);

    fireEvent.click(screen.getByRole('button', { name: 'Room Quality: 0.5 stars' }));
    expect(onChange).toHaveBeenLastCalledWith(0.5);

    fireEvent.click(screen.getByRole('button', { name: 'Room Quality: 4 stars' }));
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it('keeps the star buttons out of the tab order so one category is one stop', () => {
    render(<StarRatingInput value={2} onChange={() => {}} label="Community" />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('tabindex')).toBe('-1');
    }
    expect(screen.getByRole('slider', { name: 'Community' }).getAttribute('tabindex')).toBe('0');
  });

  it('is not focusable or interactive when disabled', () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={2} onChange={onChange} label="Location" disabled />);
    const slider = screen.getByRole('slider', { name: 'Location' });
    expect(slider.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
