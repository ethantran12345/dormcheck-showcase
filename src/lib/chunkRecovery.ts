const RECOVERY_KEY = 'dc:chunk-recovery-at';
const RECOVERY_WINDOW_MS = 15_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /importing a module script failed|failed to fetch dynamically imported module|chunkloaderror|loading chunk .* failed/i.test(message);
}

export function shouldReloadForChunkError(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  now = Date.now(),
): boolean {
  if (!isChunkLoadError(error)) return false;
  const previous = Number(storage.getItem(RECOVERY_KEY) ?? 0);
  if (Number.isFinite(previous) && now - previous < RECOVERY_WINDOW_MS) return false;
  storage.setItem(RECOVERY_KEY, String(now));
  return true;
}

export function installChunkRecovery(): () => void {
  const onPreloadError = (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (!shouldReloadForChunkError(payload)) return;
    event.preventDefault();
    window.location.reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
