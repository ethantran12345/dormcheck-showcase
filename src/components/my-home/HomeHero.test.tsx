import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeHero } from './HomeHero';

describe('HomeHero', () => {
  it('keeps the greeting and removes seasonal move-in content', () => {
    render(<HomeHero firstName="Ethan" />);

    expect(screen.getByRole('heading', { name: 'Hey Ethan' })).toBeInTheDocument();
    expect(screen.queryByText(/move-in/i)).not.toBeInTheDocument();
  });
});
