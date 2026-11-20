import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ select?: string; filters: Array<[string, unknown]> }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => {
      const call: { select?: string; filters: Array<[string, unknown]> } = { filters: [] };
      calls.push(call);
      const chain = {
        select(columns: string) { call.select = columns; return chain; },
        eq(column: string, value: unknown) { call.filters.push([column, value]); return chain; },
        single: vi.fn(async () => ({
          data: { residence_hall: 'Shared Hall', university_id: 'pitt-id' }, error: null,
        })),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return chain;
    }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/contexts/UniversityContext', () => ({ useUniversity: () => ({ university: { id: 'pitt-id' } }) }));

describe('dorm query scope', () => {
  beforeEach(() => { calls.length = 0; });

  it('keeps the detail lookup inside the dorm university and avoids wildcard payloads', async () => {
    const { DORM_SELECT_COLUMNS, findDormById } = await import('@/hooks/useDorms');
    await findDormById('42');

    expect(DORM_SELECT_COLUMNS).not.toContain('*');
    expect(calls[0]?.select).toBe('residence_hall, university_id');
    expect(calls[1]?.select).toBe(DORM_SELECT_COLUMNS);
    expect(calls[1]?.filters).toContainEqual(['residence_hall', 'Shared Hall']);
    expect(calls[1]?.filters).toContainEqual(['university_id', 'pitt-id']);
  });
});
