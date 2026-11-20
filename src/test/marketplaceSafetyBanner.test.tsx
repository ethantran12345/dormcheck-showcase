import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MarketplaceSafetyBanner } from '@/components/marketplace/MarketplaceSafetyBanner';

const STORAGE_KEY = 'dc-marketplace-safety-dismissed';

describe('MarketplaceSafetyBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    cleanup();
  });

  it('renders the banner with the safety-tips dialog closed', () => {
    render(<MemoryRouter><MarketplaceSafetyBanner /></MemoryRouter>);
    expect(screen.getByTestId('marketplace-safety-banner')).toBeTruthy();
    expect(screen.queryByTestId('safety-tips-dialog')).toBeNull();
  });

  it('opens the safety-tips dialog from the Safety tips link', () => {
    render(<MemoryRouter><MarketplaceSafetyBanner /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Safety tips' }));
    expect(screen.getByTestId('safety-tips-dialog')).toBeTruthy();
    // Radix wires the dialog's accessible name from DialogTitle.
    expect(screen.getByText('Trading safely on DormCheck')).toBeTruthy();
  });

  it('dismisses the banner and persists the dismissal', () => {
    render(<MemoryRouter><MarketplaceSafetyBanner /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss safety notice' }));
    expect(screen.queryByTestId('marketplace-safety-banner')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('stays dismissed on a fresh render when the flag is stored', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    render(<MemoryRouter><MarketplaceSafetyBanner /></MemoryRouter>);
    expect(screen.queryByTestId('marketplace-safety-banner')).toBeNull();
  });
});
