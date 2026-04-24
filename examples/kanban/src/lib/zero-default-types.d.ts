import "@rocicorp/zero";

import type { getZeroDb } from "./db";
import type { ZeroContext } from "./zero";

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    context: ZeroContext;
    dbProvider: ReturnType<typeof getZeroDb>;
  }
}
