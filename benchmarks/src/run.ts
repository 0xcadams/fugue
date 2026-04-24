import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createCrdtAdapters } from "./adapters/crdt.js";
import { createPositionAdapters } from "./adapters/position.js";
import { createPublishedEditTraceWorkload } from "./lib/published-trace.js";
import { hashBoard, hashText, measure, round } from "./lib/stats.js";
import type {
  BenchmarkAdapter,
  BenchmarkResult,
  BoardWorkload,
  Scale,
  TextWorkload,
  Workload,
} from "./lib/types.js";
import {
  createBoardWorkload,
  createSyntheticTextWorkloads,
} from "./workloads/index.js";

type ParsedArgs = {
  scale: Scale;
  adapterFilter: Set<string> | null;
  workloadFilter: Set<string> | null;
  familyFilter: "all" | "position" | "crdt";
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex >= 0) {
      args.set(token.slice(2, equalsIndex), token.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(token.slice(2), next);
      index++;
      continue;
    }

    args.set(token.slice(2), "true");
  }

  const scaleArg = args.get("scale");
  const scale: Scale = scaleArg === "full" ? "full" : "smoke";
  const familyArg = args.get("family");
  const familyFilter =
    familyArg === "position" || familyArg === "crdt" ? familyArg : "all";

  return {
    scale,
    familyFilter,
    adapterFilter: parseFilter(args.get("adapter")),
    workloadFilter: parseFilter(args.get("workload")),
  };
}

function parseFilter(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function filterAdapters(adapters: BenchmarkAdapter[], args: ParsedArgs) {
  return adapters.filter((adapter) => {
    if (args.familyFilter !== "all" && adapter.family !== args.familyFilter) {
      return false;
    }

    if (args.adapterFilter !== null && !args.adapterFilter.has(adapter.name)) {
      return false;
    }

    return true;
  });
}

function filterWorkloads(workloads: Workload[], args: ParsedArgs) {
  if (args.workloadFilter === null) {
    return workloads;
  }

  return workloads.filter((workload) =>
    args.workloadFilter!.has(workload.name),
  );
}

function runTextWorkload(
  adapter: BenchmarkAdapter,
  workload: TextWorkload,
): BenchmarkResult {
  if (adapter.createTextSession === undefined) {
    throw new Error(`${adapter.name} does not support text workloads`);
  }

  const session = adapter.createTextSession(workload.initialText);
  const startedAt = performance.now();

  for (const operation of workload.operations) {
    if (operation.kind === "insert") {
      session.insert(operation.index, operation.text, operation.actor);
    } else {
      session.delete(operation.index, operation.length, operation.actor);
    }
  }

  const applyMs = round(performance.now() - startedAt);
  const materialized = measure(() => session.materialize());
  const success = materialized.value === workload.expectedText;

  return {
    adapter: adapter.name,
    family: adapter.family,
    workload: workload.name,
    kind: workload.kind,
    operationCount: workload.operations.length,
    applyMs,
    materializeMs: materialized.durationMs,
    opsPerSec:
      applyMs === 0
        ? Infinity
        : round((workload.operations.length / applyMs) * 1000, 2),
    finalHash: hashText(materialized.value),
    success,
    finalSize: materialized.value.length,
    metrics: session.metrics(),
  };
}

function runBoardWorkload(
  adapter: BenchmarkAdapter,
  workload: BoardWorkload,
): BenchmarkResult {
  if (adapter.createBoardSession === undefined) {
    throw new Error(`${adapter.name} does not support board workloads`);
  }

  const session = adapter.createBoardSession(workload.initialBoard);
  const startedAt = performance.now();

  for (const operation of workload.operations) {
    switch (operation.kind) {
      case "insert":
        session.insert(
          operation.columnId,
          operation.index,
          operation.items,
          operation.actor,
        );
        break;
      case "delete":
        session.delete(
          operation.columnId,
          operation.index,
          operation.count,
          operation.actor,
        );
        break;
      case "move":
        session.move(
          operation.fromColumnId,
          operation.fromIndex,
          operation.toColumnId,
          operation.toIndex,
          operation.count,
          operation.actor,
        );
        break;
    }
  }

  const applyMs = round(performance.now() - startedAt);
  const materialized = measure(() => session.materialize());
  const success =
    JSON.stringify(materialized.value) ===
    JSON.stringify(workload.expectedBoard);
  const finalSize = Object.values(materialized.value).reduce(
    (sum, items) => sum + items.length,
    0,
  );

  return {
    adapter: adapter.name,
    family: adapter.family,
    workload: workload.name,
    kind: workload.kind,
    operationCount: workload.operations.length,
    applyMs,
    materializeMs: materialized.durationMs,
    opsPerSec:
      applyMs === 0
        ? Infinity
        : round((workload.operations.length / applyMs) * 1000, 2),
    finalHash: hashBoard(materialized.value),
    success,
    finalSize,
    metrics: session.metrics(),
  };
}

function runWorkload(
  adapter: BenchmarkAdapter,
  workload: Workload,
): BenchmarkResult | null {
  if (workload.kind === "text") {
    if (!adapter.support.text) {
      return null;
    }

    return runTextWorkload(adapter, workload);
  }

  if (!adapter.support.board) {
    return null;
  }

  return runBoardWorkload(adapter, workload);
}

function formatSummary(result: BenchmarkResult) {
  const base = `${result.adapter.padEnd(28)} ${String(result.applyMs).padStart(8)} ms  ${String(result.opsPerSec).padStart(10)} ops/s`;
  const status = result.success ? "ok" : "FAIL";
  return `${base}  ${status}  hash=${result.finalHash}`;
}

async function buildWorkloads(scale: Scale): Promise<Workload[]> {
  return [
    await createPublishedEditTraceWorkload(scale),
    ...createSyntheticTextWorkloads(scale),
    createBoardWorkload(scale),
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workloads = filterWorkloads(await buildWorkloads(args.scale), args);
  const adapters = filterAdapters(
    [...createPositionAdapters(), ...createCrdtAdapters()],
    args,
  );

  if (adapters.length === 0) {
    throw new Error("No adapters matched the provided filters");
  }

  if (workloads.length === 0) {
    throw new Error("No workloads matched the provided filters");
  }

  const results: BenchmarkResult[] = [];

  for (const workload of workloads) {
    process.stdout.write(`\n[${workload.name}] ${workload.description}\n`);

    for (const adapter of adapters) {
      try {
        const result = runWorkload(adapter, workload);
        if (result === null) {
          process.stdout.write(`${adapter.name.padEnd(28)} skipped\n`);
          continue;
        }

        results.push(result);
        process.stdout.write(`${formatSummary(result)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedResult: BenchmarkResult = {
          adapter: adapter.name,
          family: adapter.family,
          workload: workload.name,
          kind: workload.kind,
          operationCount: workload.operations.length,
          applyMs: 0,
          materializeMs: 0,
          opsPerSec: 0,
          finalHash: "error",
          success: false,
          finalSize: 0,
          metrics: {},
          error: message,
        };
        results.push(failedResult);
        process.stdout.write(`${adapter.name.padEnd(28)} ERROR  ${message}\n`);
      }
    }
  }

  const reportsDir = resolve(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = {
    generatedAt: new Date().toISOString(),
    scale: args.scale,
    environment: {
      node: process.version,
    },
    adapters: adapters.map((adapter) => ({
      name: adapter.name,
      family: adapter.family,
      support: adapter.support,
    })),
    workloads: workloads.map((workload) => ({
      name: workload.name,
      kind: workload.kind,
      description: workload.description,
      operationCount: workload.operations.length,
      meta: workload.meta ?? null,
    })),
    results,
  };
  const latestPath = resolve(reportsDir, `latest-${args.scale}.json`);
  const datedPath = resolve(reportsDir, `${timestamp}-${args.scale}.json`);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(latestPath, json, "utf8");
  writeFileSync(datedPath, json, "utf8");

  process.stdout.write(`\nWrote reports to ${latestPath} and ${datedPath}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
