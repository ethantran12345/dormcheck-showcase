import "@testing-library/jest-dom";

// jsdom in this config does not expose localStorage; provide a minimal
// in-memory Storage polyfill so code that persists to localStorage is testable.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Initialize the shared i18next instance so components migrated to t() render
// real (English, the default/fallback language) copy in tests instead of raw
// key strings. Deferred to a dynamic import so it runs AFTER the localStorage
// polyfill above - the language detector binds to localStorage at init time and
// must see the polyfill to persist/cache the language. See src/i18n/index.ts.
await import("@/i18n");
