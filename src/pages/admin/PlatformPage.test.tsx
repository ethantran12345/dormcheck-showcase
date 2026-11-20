import { describe, expect, it } from 'vitest';
import { countDormsByUniversity } from './PlatformPage';

describe('countDormsByUniversity', () => {
  it('groups housing rows by university and skips unscoped legacy rows', () => {
    expect(
      countDormsByUniversity([
        { university_id: 'pitt' },
        { university_id: 'cmu' },
        { university_id: 'pitt' },
        { university_id: null },
      ]),
    ).toEqual({ pitt: { dorms: 2 }, cmu: { dorms: 1 } });
  });

  it('returns an empty count map when no housing exists', () => {
    expect(countDormsByUniversity([])).toEqual({});
  });
});
