"use client";

import { ZeroProvider } from "@rocicorp/zero/react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { demoUserID } from "../src/lib/kanban";
import { getZeroContext, mutators } from "../src/lib/zero";
import { schema } from "../src/lib/zero-schema.gen";

const defaultCacheURL =
  process.env.NEXT_PUBLIC_ZERO_CACHE_URL ?? "http://127.0.0.1:4848";

type OfflineMode = {
  isOffline: boolean;
  toggleOffline: () => void;
};

const OfflineModeContext = createContext<OfflineMode | undefined>(undefined);

export function useOfflineMode() {
  const value = useContext(OfflineModeContext);

  if (!value) {
    throw new Error("useOfflineMode must be used within Providers");
  }

  return value;
}

export function Providers({ children }: { children: ReactNode }) {
  const [isOffline, setIsOffline] = useState(false);
  const cacheURL = isOffline ? null : defaultCacheURL;

  return (
    <OfflineModeContext.Provider
      value={{
        isOffline,
        toggleOffline() {
          setIsOffline((current) => !current);
        },
      }}
    >
      <ZeroProvider
        cacheURL={cacheURL}
        context={getZeroContext()}
        mutators={mutators}
        schema={schema}
        userID={demoUserID}
        disconnectTimeoutMs={1000 * 60 * 60} // 1 hour (we don't make any schema changes :)
      >
        {children}
      </ZeroProvider>
    </OfflineModeContext.Provider>
  );
}
