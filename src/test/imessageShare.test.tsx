import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// The page imports the real supabase client at module load; mock it so tests
// control auth + the pick-list queries without env/network. vi.hoisted keeps
// these above the hoisted vi.mock factory below.
const { setSession, getSession, TABLE_DATA, makeChain } = vi.hoisted(() => {
  const setSession = vi.fn(async () => ({
    data: { session: { user: { id: 'u1' } } },
    error: null,
  }));
  const getSession = vi.fn(async () => ({ data: { session: null } }));

  const TABLE_DATA: Record<string, unknown[]> = {
    ranking_group_members: [{ group_id: 'g1' }],
    ranking_collaborations: [
      { id: 'g1', group_name: 'Suth 4th', dorm_name: 'Sutherland Hall', invite_code: 'code-xyz' },
    ],
    saved_dorms: [{ dorm_id: 42 }],
    master_housing: [{ id: 42, residence_hall: 'Bouquet Gardens' }],
  };

  function makeChain(result: { data: unknown[]; error: null }) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  return { setSession, getSession, TABLE_DATA, makeChain };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { setSession, getSession },
    from: (table: string) => makeChain({ data: TABLE_DATA[table] ?? [], error: null }),
  },
}));

import IMessageSharePage, {
  normalizeInviteInput,
  normalizeListingInput,
} from '@/pages/IMessageSharePage';

describe('normalizeInviteInput', () => {
  it('accepts a full invite URL', () => {
    expect(normalizeInviteInput('https://dormcheck.com/roommates/invite/abc-123')).toBe(
      'https://dormcheck.com/roommates/invite/abc-123',
    );
  });

  it('accepts a www invite URL and canonicalizes it', () => {
    expect(normalizeInviteInput('https://www.dormcheck.com/roommates/invite/abc-123')).toBe(
      'https://dormcheck.com/roommates/invite/abc-123',
    );
  });

  it('accepts a bare code', () => {
    expect(normalizeInviteInput('  ABCD1234  ')).toBe(
      'https://dormcheck.com/roommates/invite/ABCD1234',
    );
  });

  it('rejects foreign hosts and junk', () => {
    expect(normalizeInviteInput('https://evil.com/roommates/invite/abc')).toBeNull();
    expect(normalizeInviteInput('not a code!!')).toBeNull();
    expect(normalizeInviteInput('')).toBeNull();
  });
});

describe('normalizeListingInput', () => {
  it('accepts dormcheck.com https URLs only', () => {
    expect(normalizeListingInput('https://dormcheck.com/marketplace?item=1')).toBe(
      'https://dormcheck.com/marketplace?item=1',
    );
    expect(normalizeListingInput('http://dormcheck.com/marketplace')).toBeNull();
    expect(normalizeListingInput('https://evil.com/marketplace')).toBeNull();
    expect(normalizeListingInput('marketplace')).toBeNull();
  });
});

describe('IMessageSharePage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
  });
  afterEach(() => {
    delete (window as { webkit?: unknown }).webkit;
    delete (window as { __dcSetSession?: unknown }).__dcSetSession;
    delete (window as { __dcPendingSession?: unknown }).__dcPendingSession;
  });

  it('renders the web fallback when the native bridge is absent', () => {
    render(<IMessageSharePage />);
    expect(screen.getByText('Share on iMessage')).toBeTruthy();
    expect(screen.queryByTestId('imessage-share-input')).toBeNull();
  });

  it('posts a sendMessage payload to the bridge for a valid invite (paste)', () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    render(<IMessageSharePage />);
    fireEvent.change(screen.getByTestId('imessage-share-input'), {
      target: { value: 'abc-123' },
    });
    fireEvent.click(screen.getByTestId('imessage-share-send'));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sendMessage',
        url: 'https://dormcheck.com/roommates/invite/abc-123',
      }),
    );
  });

  it('shows an error and does not post for an invalid input', () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    render(<IMessageSharePage />);
    fireEvent.change(screen.getByTestId('imessage-share-input'), {
      target: { value: 'https://evil.com/x' },
    });
    fireEvent.click(screen.getByTestId('imessage-share-send'));
    expect(postMessage).not.toHaveBeenCalled();
    expect(screen.getByText(/does not look like a DormCheck invite/)).toBeTruthy();
  });

  it('renders pick-lists after __dcSetSession and posts the canonical invite URL', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    render(<IMessageSharePage />);

    await act(async () => {
      window.__dcSetSession!('access-tok', 'refresh-tok');
    });

    expect(setSession).toHaveBeenCalledWith({
      access_token: 'access-tok',
      refresh_token: 'refresh-tok',
    });

    const groupBtn = await screen.findByTestId('imessage-pick-group-g1');
    fireEvent.click(groupBtn);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sendMessage',
        url: 'https://dormcheck.com/roommates/invite/code-xyz',
      }),
    );
  });

  it('renders a saved-dorm pick and posts the canonical /campus URL', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    render(<IMessageSharePage />);

    await act(async () => {
      window.__dcSetSession!('a', 'r');
    });

    const dormBtn = await screen.findByTestId('imessage-pick-dorm-42');
    fireEvent.click(dormBtn);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sendMessage',
        url: 'https://dormcheck.com/campus/bouquet-gardens',
      }),
    );
  });

  it('drains a session injected before mount (window.__dcPendingSession)', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    window.__dcPendingSession = { access: 'a', refresh: 'r' };
    render(<IMessageSharePage />);

    expect(await screen.findByTestId('imessage-pick-group-g1')).toBeTruthy();
    expect(setSession).toHaveBeenCalled();
  });

  it('stays on the paste form when signed out (no picks)', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { dormcheck: { postMessage } } };
    render(<IMessageSharePage />);
    // Let the mount getSession() resolve (no session).
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('imessage-share-input')).toBeTruthy();
    expect(screen.queryByTestId('imessage-pick-group-g1')).toBeNull();
  });
});
