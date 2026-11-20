import { describe, expect, it } from 'vitest';
import { normalizeHandle } from '@/lib/socialHandles';

describe('normalizeHandle', () => {
  it('strips a leading @, however many', () => {
    expect(normalizeHandle('@ethan')).toBe('ethan');
    expect(normalizeHandle('@@ethan')).toBe('ethan');
  });

  it('trims and removes internal whitespace from a paste', () => {
    expect(normalizeHandle('  ethan tran  ')).toBe('ethantran');
  });

  it('leaves a clean handle untouched and an empty one empty', () => {
    expect(normalizeHandle('ethan.tran_1')).toBe('ethan.tran_1');
    expect(normalizeHandle('   ')).toBe('');
  });
});
