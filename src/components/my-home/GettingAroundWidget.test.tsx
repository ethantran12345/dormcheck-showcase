import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { GettingAroundWidget } from './GettingAroundWidget';

// Litchfield Towers; the mocked stop/station below are a real-scale walk away.
const HOME = { name: 'Litchfield Towers', lat: 40.4425, lng: -79.9571 };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: () =>
        Promise.resolve(
          table === 'bus_stops'
            ? {
                data: [
                  {
                    objectID: 1,
                    stop_id: 's1',
                    stop_code: '1',
                    stop_name: 'Forbes Ave at Bigelow',
                    stop_lat: 40.4438,
                    stop_lon: -79.9552,
                    routes: '61A, 61B, 71B',
                  },
                ],
                error: null,
              }
            : {
                data: [
                  {
                    Id: 9,
                    Name: 'Schenley Dr & Forbes',
                    'Total Docks': 19,
                    Latitude: 40.4417,
                    Longitude: -79.9527,
                  },
                ],
                error: null,
              },
        ),
    }),
  },
}));

function renderWidget(props?: Partial<Parameters<typeof GettingAroundWidget>[0]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GettingAroundWidget
        home={HOME}
        universitySlug="pitt"
        onSetHome={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('GettingAroundWidget', () => {
  it('nudges to set housing when no home is resolved', async () => {
    const onSetHome = vi.fn();
    renderWidget({ home: null, onSetHome });
    expect(screen.getByText(/set where you live/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(onSetHome).toHaveBeenCalledTimes(1);
  });

  it('lists nearby stops and POGOH with walk estimates and native-maps links', async () => {
    renderWidget();
    expect(await screen.findByText('Forbes Ave at Bigelow')).toBeInTheDocument();
    expect(screen.getByText('Schenley Dr & Forbes')).toBeInTheDocument();
    expect(screen.getByText(/19 docks/)).toBeInTheDocument();
    expect(screen.getAllByText(/~\d+ min walk/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('61A')).toBeInTheDocument();

    const busLink = screen.getByRole('link', {
      name: 'Walking route to the Forbes Ave at Bigelow bus stop',
    });
    // jsdom UA is neither iOS nor Mac, so the web fallback is Google Maps with
    // the home as origin.
    expect(busLink.getAttribute('href')).toContain('google.com/maps/dir');
    expect(busLink.getAttribute('href')).toContain('origin=40.4425%2C-79.9571');
  });

  it('offers the campus-building picker for a surveyed school only', async () => {
    renderWidget();
    expect(
      await screen.findByRole('combobox', { name: 'Choose a campus building' }),
    ).toBeInTheDocument();
  });

  it('hides the building picker when the school has no surveyed buildings', async () => {
    renderWidget({ universitySlug: 'cmu' });
    await screen.findByText('Forbes Ave at Bigelow');
    expect(
      screen.queryByRole('combobox', { name: 'Choose a campus building' }),
    ).not.toBeInTheDocument();
  });
});
