import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QuickLinksRow } from './QuickLinksRow';

describe('QuickLinksRow', () => {
  it('keeps current actions and omits the deferred move-in link', () => {
    render(
      <MemoryRouter>
        <QuickLinksRow showRoommates showSchedule />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Schedule/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Roommates/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sell an item/ })).toBeInTheDocument();
    expect(screen.queryByText(/Move-in plan/i)).not.toBeInTheDocument();
  });

  it('drops the Schedule tile for a school that has switched it off', () => {
    render(
      <MemoryRouter>
        <QuickLinksRow showRoommates showSchedule={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /Schedule/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Roommates/ })).toBeInTheDocument();
  });
});
