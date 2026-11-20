import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AppNotification } from '@/lib/notifications';
import { RecentActivityWidget } from './RecentActivityWidget';

const marketplaceNotification: AppNotification = {
  id: 'listing-1',
  kind: 'marketplace-alert',
  title: 'A desk matched your alert',
  to: '/marketplace?listing=listing-1',
  createdAt: new Date().toISOString(),
  read: false,
};

describe('RecentActivityWidget', () => {
  it('collapses completely when there is no personal activity', () => {
    const { container } = render(
      <MemoryRouter>
        <RecentActivityWidget
          notifications={[]}
          unreadMessages={0}
          packedItems={0}
          totalItems={20}
          hasChecklistActivity={false}
          checklistLoading={false}
        />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('summarizes messages, marketplace, and checklist activity', () => {
    render(
      <MemoryRouter>
        <RecentActivityWidget
          notifications={[marketplaceNotification]}
          unreadMessages={2}
          packedItems={4}
          totalItems={20}
          hasChecklistActivity
          checklistLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(screen.getByText('2 unread messages')).toBeInTheDocument();
    expect(screen.getByText('A desk matched your alert')).toBeInTheDocument();
    expect(screen.getByText('4 of 20 checklist items packed')).toBeInTheDocument();
  });
});
