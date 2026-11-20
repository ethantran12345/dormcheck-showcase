import { useEffect, useState } from 'react';

// Resolves the app's active color scheme from the class-based dark mode
// (`<html class="dark">`), reactively. The app toggles dark mode via a class, not
// prefers-color-scheme, so anything that needs an explicit 'light' | 'dark' value
// (e.g. the emoji picker theme) must read the class rather than the OS setting.
export function useResolvedColorScheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';

  const [scheme, setScheme] = useState<'light' | 'dark'>(read);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setScheme(read()));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    setScheme(read());
    return () => observer.disconnect();
  }, []);

  return scheme;
}
