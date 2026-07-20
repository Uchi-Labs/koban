"use client";

// Shared handle on the app-wide sync so surfaces outside the sidebar (e.g. the
// transactions toolbar) can trigger the same run the "Sync now" island does.

import { createContext, useContext } from "react";

const SyncContext = createContext<{ syncNow: () => void; syncing: boolean }>({ syncNow: () => {}, syncing: false });

export const SyncProvider = SyncContext.Provider;

export function useSyncControls() {
  return useContext(SyncContext);
}
