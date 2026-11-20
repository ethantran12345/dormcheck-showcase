import { createContext, useContext, useMemo, useState } from "react";

export type CollaborateModalTab = "invite" | "sent";

interface CollaborationContextValue {
  /** Checklist page: which collaboration group is currently being viewed */
  activeChecklistGroupId: string | null;
  setActiveChecklistGroupId: (groupId: string | null) => void;

  /** Collaborate modal: persist last-selected tab across close/open */
  collaborateModalTab: CollaborateModalTab;
  setCollaborateModalTab: (tab: CollaborateModalTab) => void;
}

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export function CollaborationProvider({ children }: { children: React.ReactNode }) {
  const [activeChecklistGroupId, setActiveChecklistGroupId] = useState<string | null>(null);
  const [collaborateModalTab, setCollaborateModalTab] = useState<CollaborateModalTab>("invite");

  const value = useMemo<CollaborationContextValue>(
    () => ({
      activeChecklistGroupId,
      setActiveChecklistGroupId,
      collaborateModalTab,
      setCollaborateModalTab,
    }),
    [activeChecklistGroupId, collaborateModalTab]
  );

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>;
}

export function useCollaborationContext(): CollaborationContextValue {
  const ctx = useContext(CollaborationContext);
  if (!ctx) throw new Error("useCollaborationContext must be used within CollaborationProvider");
  return ctx;
}

