import { createContext, useContext, useState, ReactNode } from 'react';

const STORAGE_KEY = 'dc_sidebar_collapsed';

interface NavShellContextType {
  /** Desktop sidebar collapsed to the icon rail. Persisted across reloads. */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Signed-in web app shell (sidebar present at md+). False on native, marketing, auth. */
  isAppShell: boolean;
}

const NavShellContext = createContext<NavShellContextType | null>(null);

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

/**
 * Persisted sidebar-collapse preference. Owned by LayoutWrapper (which also
 * needs it for the content offset) and shared to the tree via NavShellProvider.
 */
export function useSidebarCollapsedState(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(readStoredCollapsed);

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    writeStoredCollapsed(value);
  };

  return [collapsed, setCollapsed];
}

export function NavShellProvider({
  isAppShell,
  collapsed,
  setCollapsed,
  children,
}: {
  isAppShell: boolean;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <NavShellContext.Provider value={{ collapsed, setCollapsed, isAppShell }}>
      {children}
    </NavShellContext.Provider>
  );
}

/** Safe outside the provider (native / marketing trees): no shell, never collapsed. */
export function useNavShell(): NavShellContextType {
  const ctx = useContext(NavShellContext);
  return ctx ?? { collapsed: false, setCollapsed: () => {}, isAppShell: false };
}
