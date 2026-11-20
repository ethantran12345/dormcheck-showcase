import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGAL_NOTICE_VERSION, needsLegalNotice } from '@/lib/legalNotice';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUser = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

/** Captures the last profiles.update payload so the test can assert what was written. */
let updatePayload: Record<string, unknown> | null = null;
let ackVersionInDb: string | null = null;
let updateShouldFail = false;
let readShouldFail = false;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { legal_notice_ack_version: ackVersionInDb },
            error: readShouldFail ? new Error('read failed') : null,
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return {
          eq: async () => ({ error: updateShouldFail ? new Error('write failed') : null }),
        };
      },
    }),
  },
}));

// Imported after the mocks so the component picks them up.
const { LegalUpdateNotice } = await import('@/components/legal/LegalUpdateNotice');

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/my-home']}>
        <LegalUpdateNotice />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('needsLegalNotice', () => {
  it('treats a never-acknowledged profile as needing the notice', () => {
    // Every row that predates the column reads NULL, so this is the case that
    // actually notifies the existing user base.
    expect(needsLegalNotice(null)).toBe(true);
    expect(needsLegalNotice(undefined)).toBe(true);
  });

  it('treats a stale acknowledgement as needing the notice again', () => {
    expect(needsLegalNotice('2026-07-22')).toBe(true);
  });

  it('is satisfied only by the current version', () => {
    expect(needsLegalNotice(LEGAL_NOTICE_VERSION)).toBe(false);
  });
});

describe('LegalUpdateNotice', () => {
  beforeEach(() => {
    updatePayload = null;
    ackVersionInDb = null;
    updateShouldFail = false;
    readShouldFail = false;
  });

  it('shows the notice to a user who has never acknowledged it', async () => {
    renderNotice();
    expect(await screen.findByText('misc:legalNotice.title')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stays hidden for a user already on the current version', async () => {
    ackVersionInDb = LEGAL_NOTICE_VERSION;
    renderNotice();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('records the version and a timestamp when dismissed, and hides immediately', async () => {
    renderNotice();
    fireEvent.click(await screen.findByText('misc:legalNotice.acknowledge'));

    await waitFor(() => expect(updatePayload).not.toBeNull());
    expect(updatePayload).toMatchObject({ legal_notice_ack_version: LEGAL_NOTICE_VERSION });
    expect(typeof updatePayload?.legal_notice_ack_at).toBe('string');
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('the X control dismisses too and carries an accessible name', async () => {
    renderNotice();
    await screen.findByText('misc:legalNotice.title');
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.dismiss' }));
    await waitFor(() => expect(updatePayload).not.toBeNull());
  });

  it('restores the notice if the write fails, rather than silently swallowing it', async () => {
    // Failing toward "show it again" is the safe direction for a legal notice.
    updateShouldFail = true;
    renderNotice();
    fireEvent.click(await screen.findByText('misc:legalNotice.acknowledge'));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('misc:error.sectionBody');
  });

  it('fails open with explicit feedback and a retry when the acknowledgement read fails', async () => {
    readShouldFail = true;
    renderNotice();

    expect(await screen.findByText('misc:legalNotice.title')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('misc:error.sectionBody');
    expect(screen.getByRole('button', { name: 'common:actions.retry' })).toBeInTheDocument();
  });
});
