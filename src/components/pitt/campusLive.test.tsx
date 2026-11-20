import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * These pin the honesty rules of the Campus Live surface, which are the part
 * most likely to rot: a stalled ingest must never render as current data, a
 * building with no published feed must never render as "everything is busy",
 * and a location without a menu must say so rather than showing an empty list.
 */
const mocks = vi.hoisted(() => ({
  useLaundryRooms: vi.fn(),
  useDiningToday: vi.fn(),
  useUpcomingAcademicDates: vi.fn(),
  useIngestFreshness: vi.fn(),
}));

vi.mock('@/hooks/usePittCampusLive', () => mocks);

const { FreshnessNote, relativeAge } = await import('./FreshnessNote');
const { LaundryCard } = await import('./LaundryCard');
const { DiningToday, summarizeHours, formatClock } = await import('./DiningToday');
const { KeyDatesCard, formatEventDate } = await import('./KeyDatesCard');
const { CampusLiveWidget } = await import('./CampusLiveWidget');

const idle = { data: undefined, isPending: false, isError: false } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function freshness(value: { lastSuccessAt: string | null; lastError?: string | null }) {
  mocks.useIngestFreshness.mockReturnValue({
    data: { lastAttemptAt: value.lastSuccessAt, lastError: value.lastError ?? null, ...value },
    isPending: false,
  });
}

describe('FreshnessNote', () => {
  it('labels a stale feed instead of presenting it as current', () => {
    freshness({ lastSuccessAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() });
    render(<FreshnessNote source="laundry" />);
    expect(screen.getByText(/Possibly out of date/i)).toBeTruthy();
  });

  it('reads as a plain update time while the feed is healthy', () => {
    freshness({ lastSuccessAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() });
    render(<FreshnessNote source="laundry" />);
    expect(screen.queryByText(/Possibly out of date/i)).toBeNull();
    expect(screen.getByText(/Updated 5 min ago/i)).toBeTruthy();
  });

  it('admits the update time is unknown rather than implying the data is current', () => {
    freshness({ lastSuccessAt: null });
    render(<FreshnessNote source="dining" />);
    expect(screen.getByText(/Update time unknown/i)).toBeTruthy();
  });

  it('formats ages in units a student reads', () => {
    const now = Date.parse('2026-08-27T12:00:00Z');
    expect(relativeAge('2026-08-27T11:59:30Z', now)).toBe('just now');
    expect(relativeAge('2026-08-27T11:20:00Z', now)).toBe('40 min ago');
    expect(relativeAge('2026-08-27T06:00:00Z', now)).toBe('6 hr ago');
    expect(relativeAge('2026-08-26T12:00:00Z', now)).toBe('yesterday');
  });
});

describe('LaundryCard', () => {
  it('says a hall has no published feed instead of rendering zeros', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useLaundryRooms.mockReturnValue({ ...idle, data: [] });
    render(<LaundryCard hallFilter="Nordenberg Hall" />);
    expect(screen.getByText(/does not publish machine status for Nordenberg Hall/i)).toBeTruthy();
    expect(screen.queryByText(/0 of 0 free/i)).toBeNull();
  });

  it('shows availability and names an unmatched room by its provider name', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useLaundryRooms.mockReturnValue({
      ...idle,
      data: [
        {
          id: 'r1',
          upstreamName: 'PANTHER HALL 3RD FLR',
          residenceHall: null,
          freeWashers: 2,
          totalWashers: 7,
          freeDryers: 0,
          totalDryers: 8,
          observedAt: new Date().toISOString(),
          machines: [{ id: 'm1', label: '01', machineType: 'dryer', status: 'in_use', minutesRemaining: 12 }],
        },
      ],
    });
    render(<LaundryCard />);
    expect(screen.getByText('PANTHER HALL 3RD FLR')).toBeTruthy();
    expect(screen.getByText(/Reported by the laundry provider/i)).toBeTruthy();
    expect(screen.getByText(/of 7 free/i)).toBeTruthy();
  });

  it('names the provider room when two rooms map to the same hall', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    const base = { freeWashers: 1, totalWashers: 10, freeDryers: 1, totalDryers: 10, observedAt: new Date().toISOString(), machines: [] };
    mocks.useLaundryRooms.mockReturnValue({
      ...idle,
      data: [
        { id: 'a', upstreamName: 'SUTHERLAND EAST', residenceHall: 'Sutherland Hall', ...base },
        { id: 'b', upstreamName: 'SUTHERLAND WEST', residenceHall: 'Sutherland Hall', ...base },
      ],
    });
    render(<LaundryCard />);
    expect(screen.getAllByText('Sutherland Hall')).toHaveLength(2);
    expect(screen.getByText('SUTHERLAND EAST')).toBeTruthy();
    expect(screen.getByText('SUTHERLAND WEST')).toBeTruthy();
  });
});

describe('DiningToday', () => {
  it('marks a location with no menu as hours only rather than showing an empty menu', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useDiningToday.mockReturnValue({
      ...idle,
      data: [
        {
          id: 'd1',
          name: 'RxPresso',
          isOpen: true,
          hasMenu: false,
          intervals: [{ start: '08:00', end: '16:00' }],
          periods: [],
        },
      ],
    });
    render(<DiningToday />);
    expect(screen.getByText('Hours only')).toBeTruthy();
    expect(screen.getByText(/8:00 AM to 4:00 PM/)).toBeTruthy();
  });

  it('summarizes hours in 12-hour time and names a closed day', () => {
    expect(formatClock('16:30')).toBe('4:30 PM');
    expect(formatClock('00:15')).toBe('12:15 AM');
    expect(summarizeHours([])).toBe('Closed today');
    expect(summarizeHours([{ start: '10:30', end: '21:00' }])).toBe('10:30 AM to 9:00 PM');
  });
});

describe('KeyDatesCard', () => {
  it('renders the calendar date it was given, with no timezone drift', () => {
    // `new Date('2026-09-04')` is UTC midnight and prints as Sep 3 in Eastern time.
    expect(formatEventDate('2026-09-04')).toContain('Sep 4');
  });

  it('prefers the event description over the feed title', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useUpcomingAcademicDates.mockReturnValue({
      ...idle,
      data: [
        {
          id: 'e1',
          calendar: 'academic',
          eventDate: '2026-09-04',
          title: 'Fall Term Add/Drop Period Ends',
          content: 'Fall Term Add/Drop Period Ends',
        },
      ],
    });
    render(<KeyDatesCard />);
    expect(screen.getByText('Fall Term Add/Drop Period Ends')).toBeTruthy();
    expect(screen.getByText('Academic')).toBeTruthy();
  });
});

describe('CampusLiveWidget', () => {
  it('reports no live data rather than zero free machines', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useLaundryRooms.mockReturnValue({ data: [], isPending: false });
    render(
      <MemoryRouter>
        <CampusLiveWidget residenceHall="Holland Hall" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No live laundry data is published/i)).toBeTruthy();
    expect(screen.queryByText(/washers free/i)).toBeNull();
  });

  it('falls back to all buildings when the student\'s hall has no room', () => {
    freshness({ lastSuccessAt: new Date().toISOString() });
    mocks.useLaundryRooms.mockReturnValue({
      data: [
        { id: 'r1', upstreamName: 'LITCHFIELD TOWERS', residenceHall: 'Litchfield Towers', freeWashers: 4, totalWashers: 54, freeDryers: 6, totalDryers: 55, observedAt: new Date().toISOString(), machines: [] },
      ],
      isPending: false,
    });
    render(
      <MemoryRouter>
        <CampusLiveWidget residenceHall="Nordenberg Hall" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Across all buildings')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });
});
