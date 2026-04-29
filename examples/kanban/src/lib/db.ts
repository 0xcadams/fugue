import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as drizzleSchema from "./schema";
import { schema as zeroSchema } from "./zero-schema.gen";

function getDatabaseUrl() {
  const value = process.env.ZERO_UPSTREAM_DB;

  if (!value) {
    throw new Error("Set ZERO_UPSTREAM_DB before starting the kanban example.");
  }

  return value;
}

function createPool() {
  return new Pool({
    connectionString: getDatabaseUrl(),
  });
}

function createDrizzleDb() {
  return drizzle(getPool(), { schema: drizzleSchema });
}

function createZeroDb() {
  return zeroDrizzle(zeroSchema, getDrizzleDb());
}

const globalForKanban = globalThis as typeof globalThis & {
  kanbanPool?: Pool;
  kanbanDrizzle?: ReturnType<typeof createDrizzleDb>;
  kanbanZero?: ReturnType<typeof createZeroDb>;
};

export function getPool() {
  globalForKanban.kanbanPool ??= createPool();
  return globalForKanban.kanbanPool;
}

export function getDrizzleDb() {
  globalForKanban.kanbanDrizzle ??= createDrizzleDb();
  return globalForKanban.kanbanDrizzle;
}

export function getZeroDb() {
  globalForKanban.kanbanZero ??= createZeroDb();
  return globalForKanban.kanbanZero;
}
