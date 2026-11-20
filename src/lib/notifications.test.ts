import { describe, it, expect } from 'vitest';
import { toAppNotification, type NotificationRow } from './notifications';

const base: Omit<NotificationRow, 'type' | 'payload'> = {
  id: 'n1',
  read_at: null,
  created_at: '2026-07-07T12:00:00Z',
};

describe('toAppNotification', () => {
  it('maps roommate_invite_accepted with actor and group', () => {
    const n = toAppNotification({
      ...base,
      type: 'roommate_invite_accepted',
      payload: { actor_name: 'Jordan P', group_name: 'Tower A Crew' },
    });
    expect(n).toMatchObject({
      kind: 'roommate-confirmed',
      title: 'Jordan P confirmed you as a roommate',
      body: 'Tower A Crew',
      to: '/my-home',
      read: false,
    });
  });

  it('maps roommate_invited for a roommate group, deep-linking to the accept surface', () => {
    const n = toAppNotification({
      ...base,
      type: 'roommate_invited',
      payload: { actor_name: 'Sam K', group_type: 'roommate', dorm_name: 'Sutherland Hall', group_name: 'Suth 4th' },
    });
    expect(n).toMatchObject({
      kind: 'roommate-invited',
      title: 'Sam K wants to confirm you as a roommate',
      body: 'Sutherland Hall',
      to: '/checklist',
      read: false,
    });
  });

  it('maps roommate_invited for a non-roommate group by name', () => {
    const n = toAppNotification({
      ...base,
      type: 'roommate_invited',
      payload: { actor_name: 'Sam K', group_type: 'checklist', group_name: 'Move-in Crew' },
    });
    expect(n?.title).toBe('Sam K invited you to Move-in Crew');
    expect(n?.body).toBe('Move-in Crew');
  });

  it('falls back to a generic actor when actor_name is missing or blank', () => {
    const n = toAppNotification({
      ...base,
      type: 'roommate_invite_accepted',
      payload: { actor_name: '  ' },
    });
    expect(n?.title).toBe('A roommate confirmed you as a roommate');
  });

  it('pluralizes the building digest by count', () => {
    const one = toAppNotification({
      ...base,
      type: 'building_new_residents',
      payload: { count: 1, building_name: 'Tower A' },
    });
    expect(one?.title).toBe('1 new person joined your building');
    expect(one?.body).toBe('Tower A');

    const three = toAppNotification({
      ...base,
      type: 'building_new_residents',
      payload: { count: 3, building_name: 'Tower A' },
    });
    expect(three?.title).toBe('3 new people joined your building');
  });

  it('treats a missing or invalid count as 1', () => {
    const n = toAppNotification({ ...base, type: 'building_new_residents', payload: {} });
    expect(n?.title).toBe('1 new person joined your building');
    expect(n?.body).toBeUndefined();
  });

  it('maps admin_announcement, honoring a valid payload.route', () => {
    const n = toAppNotification({
      ...base,
      type: 'admin_announcement',
      payload: { title: 'Policy update', body: 'Please review the latest policy.', route: '/checklist' },
    });
    expect(n).toMatchObject({
      kind: 'announcement',
      title: 'Policy update',
      body: 'Please review the latest policy.',
      to: '/checklist',
      read: false,
    });
  });

  it('falls back to /my-home when an admin_announcement route is missing or unsafe', () => {
    const missing = toAppNotification({ ...base, type: 'admin_announcement', payload: {} });
    expect(missing?.title).toBe('Announcement');
    expect(missing?.to).toBe('/my-home');

    const unsafe = toAppNotification({
      ...base,
      type: 'admin_announcement',
      payload: { route: '//evil.example.com' },
    });
    expect(unsafe?.to).toBe('/my-home');
  });

  it('maps listing_freshness with the listing title and expiry window', () => {
    const n = toAppNotification({
      ...base,
      type: 'listing_freshness',
      payload: { title: 'Mini fridge', expires_in_days: 7 },
    });
    expect(n).toMatchObject({
      kind: 'listing-freshness',
      title: 'Still selling "Mini fridge"?',
      body: "It expires in about 7 days unless you confirm it's still available.",
      to: '/marketplace/my-items',
    });
  });

  it('uses generic listing_freshness copy and a 14-day default without payload details', () => {
    const n = toAppNotification({ ...base, type: 'listing_freshness', payload: {} });
    expect(n?.title).toBe('Still selling your listing?');
    expect(n?.body).toContain('about 14 days');
  });

  it('maps marketplace_alert with a listing deep-link and price body', () => {
    const n = toAppNotification({
      ...base,
      type: 'marketplace_alert',
      payload: {
        listing_id: 'abc-123',
        title: 'Mini fridge (3.2 cu ft)',
        price: 45,
        alert_name: 'Furniture under $50',
      },
    });
    expect(n).toMatchObject({
      kind: 'marketplace-alert',
      title: 'New match for "Furniture under $50": Mini fridge (3.2 cu ft)',
      body: 'Listed at $45',
      to: '/marketplace?tab=buy-sell&listing=abc-123',
    });
  });

  it('maps marketplace_alert with a sparse payload to the marketplace feed', () => {
    const n = toAppNotification({ ...base, type: 'marketplace_alert', payload: {} });
    expect(n?.to).toBe('/marketplace?tab=buy-sell');
    expect(n?.title).toBe('New match for "your alert": A new listing');
    expect(n?.body).toBeUndefined();
  });

  it('marks read rows and drops unknown types', () => {
    const read = toAppNotification({
      ...base,
      type: 'roommate_invite_accepted',
      payload: {},
      read_at: '2026-07-07T13:00:00Z',
    });
    expect(read?.read).toBe(true);

    expect(toAppNotification({ ...base, type: 'future_type', payload: {} })).toBeNull();
  });
});
