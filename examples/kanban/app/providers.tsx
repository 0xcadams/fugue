"use client";

import type { ReactNode } from "react";
import { ZeroProvider } from "@rocicorp/zero/react";

import { demoUserID } from "../src/lib/kanban";
import { getZeroContext, mutators } from "../src/lib/zero";
import { schema } from "../src/lib/zero-schema.gen";

const cacheURL =
  process.env.NEXT_PUBLIC_ZERO_CACHE_URL ?? "http://127.0.0.1:4848";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ZeroProvider
      cacheURL={cacheURL}
      context={getZeroContext()}
      mutators={mutators}
      schema={schema}
      userID={demoUserID}
    >
      {children}
    </ZeroProvider>
  );
}
