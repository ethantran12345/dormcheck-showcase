import { describe, expect, it } from 'vitest';
import { toAppNotification, type NotificationRow } from '@/lib/notifications';

const row = (type: string, payload: Record<string, unknown>): NotificationRow => ({
  id: 'n1',
  type,
  payload,
  read_at: null,
  created_at: '2026-07-12T00:00:00Z',
});

describe('toAppNotification report_resolution', () => {
  it('renders the removed-content variant for delete_content', () => {
    const n = toAppNotification(row('report_resolution', { action: 'delete_content' }));
    expect(n).not.toBeNull();
    expect(n?.kind).toBe('report-update');
    expect(n?.title).toBe('Update on your report');
    expect(n?.body).toContain('removed the content');
  });

  it('renders the no-violation variant for dismiss_report', () => {
    const n = toAppNotification(row('report_resolution', { action: 'dismiss_report' }));
    expect(n?.body).toContain('found no violation');
  });

  it('still drops unknown types', () => {
    expect(toAppNotification(row('future_type', {}))).toBeNull();
  });
});
