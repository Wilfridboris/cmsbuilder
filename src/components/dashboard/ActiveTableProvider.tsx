"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * ActiveTableProvider (Story 5.1) — the tiny client context that lets the floating
 * AI Assistant chat know which logical table the Admin is currently viewing, so an
 * add-column request without an explicit table ("add a price field") can be
 * resolved against the current table when unambiguous.
 *
 * It is a one-value context: `activeTableKey` (the currently-selected table's key,
 * or null) plus `setActiveTableKey`. `RecordsView` publishes its selected table key
 * into it; `ChatAssistant` reads it and forwards it to the endpoint as
 * `currentTableKey`.
 *
 * `useActiveTable()` has a SAFE no-provider default (null key + no-op setter) so a
 * component that renders `RecordsView` outside the provider (e.g. the Story 3.1
 * unit test, or any surface that does not mount the chat) keeps working unchanged —
 * publishing the active table simply becomes a no-op there.
 */

type ActiveTableContextValue = {
  activeTableKey: string | null;
  setActiveTableKey: (key: string | null) => void;
};

const noopContext: ActiveTableContextValue = {
  activeTableKey: null,
  setActiveTableKey: () => {},
};

const ActiveTableContext = createContext<ActiveTableContextValue>(noopContext);

export function ActiveTableProvider({ children }: { children: ReactNode }) {
  const [activeTableKey, setActiveTableKey] = useState<string | null>(null);
  const value = useMemo(
    () => ({ activeTableKey, setActiveTableKey }),
    [activeTableKey],
  );
  return (
    <ActiveTableContext.Provider value={value}>
      {children}
    </ActiveTableContext.Provider>
  );
}

/** Read the active table key + setter. Safe (no-op) when no provider is mounted. */
export function useActiveTable(): ActiveTableContextValue {
  return useContext(ActiveTableContext);
}
