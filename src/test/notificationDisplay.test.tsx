import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Bell } from 'lucide-react';
import { notificationIcon } from '@/components/notifications/notificationDisplay';
import { NotificationsWidget } from '@/components/my-home/NotificationsWidget';
import type { AppNotification, NotificationKind } from '@/lib/notifications';

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: overrides.id ?? 'n1',
    kind: overrides.kind ?? 'announcement',
    title: overrides.title ?? 'Something happened',
    body: overrides.body,
    to: overrides.to ?? '/my-home',
    createdAt: overrides.createdAt ?? '2026-07-15T00:00:00.000Z',
    read: overrides.read ?? false,
  };
}

describe('notificationIcon', () => {
  it('maps a known kind to a specific icon', () => {
    expect(notificationIcon('message')).toBeTypeOf('object');
  });

  it('falls back to the bell for an unknown kind', () => {
    // A newer server could ship a kind this client does not know yet.
    expect(notificationIcon('totally-new-kind' as NotificationKind)).toBe(Bell);
  });
});

describe('NotificationsWidget', () => {
  afterEach(() => cleanup());

  it('previews at most three notifications, newest first', () => {
    const notifications = [
      makeNotification({ id: '1', title: 'First' }),
      makeNotification({ id: '2', title: 'Second' }),
      makeNotification({ id: '3', title: 'Third' }),
      makeNotification({ id: '4', title: 'Fourth' }),
    ];
    render(
      <MemoryRouter>
        <NotificationsWidget notifications={notifications} unreadCount={4} />
      </MemoryRouter>,
    );
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Third')).toBeTruthy();
    expect(screen.queryByText('Fourth')).toBeNull();
  });

  it('shows the unread count badge and links to the full center', () => {
    render(
      <MemoryRouter>
        <NotificationsWidget
          notifications={[makeNotification({ title: 'Hi' })]}
          unreadCount={2}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('2')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /see all/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/notifications');
  });
});
