import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

const STORAGE_KEY = 'dc_admin_full_app_preview';

interface AdminPreviewContextType {
  fullAppPreview: boolean;
  setFullAppPreview: (v: boolean) => void;
}

const AdminPreviewContext = createContext<AdminPreviewContextType | null>(null);

function readStoredPreview(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredPreview(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export function AdminPreviewProvider({ children }: { children: ReactNode }) {
  const [fullAppPreview, setFullAppPreviewState] = useState(readStoredPreview);

  const setFullAppPreview = useCallback((value: boolean) => {
    setFullAppPreviewState(value);
    writeStoredPreview(value);
  }, []);

  const value = useMemo(
    () => ({ fullAppPreview, setFullAppPreview }),
    [fullAppPreview, setFullAppPreview]
  );

  return (
    <AdminPreviewContext.Provider value={value}>
      {children}
    </AdminPreviewContext.Provider>
  );
}

export function useAdminFullAppPreview() {
  const ctx = useContext(AdminPreviewContext);
  return ctx ?? { fullAppPreview: false, setFullAppPreview: () => {} };
}
