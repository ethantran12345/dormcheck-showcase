import { createContext, useContext, useState, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface SetupModeContextType {
  setupModeEnabled: boolean;
  setSetupModeEnabled: (v: boolean) => void;
}

const SetupModeContext = createContext<SetupModeContextType | null>(null);

export function SetupModeProvider({ children }: { children: ReactNode }) {
  // Setup Mode grants edit/delete on ANY marketplace listing, so it is a
  // platform (superadmin) power - never available to university_admins.
  const { isSuperAdmin } = useAuth();
  const [setupModeEnabled, setSetupModeEnabled] = useState(false);

  const value: SetupModeContextType = {
    setupModeEnabled: isSuperAdmin ? setupModeEnabled : false,
    setSetupModeEnabled: isSuperAdmin ? setSetupModeEnabled : () => {},
  };

  return (
    <SetupModeContext.Provider value={value}>
      {children}
    </SetupModeContext.Provider>
  );
}

export function useSetupMode() {
  const ctx = useContext(SetupModeContext);
  return ctx ?? { setupModeEnabled: false, setSetupModeEnabled: () => {} };
}
