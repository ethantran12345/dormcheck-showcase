import { describe, expect, it } from 'vitest';
import { isChunkLoadError, shouldReloadForChunkError } from '@/lib/chunkRecovery';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('lazy chunk recovery', () => {
  it('recognizes browser and bundler chunk failures', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/Page-old.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('ordinary render failure'))).toBe(false);
  });

  it('allows one reload and blocks a reload loop during the recovery window', () => {
    const storage = memoryStorage();
    const error = new Error('Importing a module script failed.');
    expect(shouldReloadForChunkError(error, storage, 20_000)).toBe(true);
    expect(shouldReloadForChunkError(error, storage, 20_100)).toBe(false);
    expect(shouldReloadForChunkError(error, storage, 35_001)).toBe(true);
  });

  it('never marks or reloads an ordinary render error', () => {
    expect(shouldReloadForChunkError(new Error('render failed'), memoryStorage(), 20_000)).toBe(false);
  });
});
