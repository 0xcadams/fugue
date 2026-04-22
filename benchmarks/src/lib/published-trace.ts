import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyTextOperations } from "./model.js";
import type { Scale, TextOperation, TextWorkload } from "./types.js";

const TRACE_URL =
  "https://raw.githubusercontent.com/automerge/automerge-perf/master/edit-by-index/editing-trace.js";
const FULL_TRACE_BURST_CHARS = 32;

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const traceCacheFile = resolve(
  workspaceRoot,
  ".cache",
  "automerge-editing-trace.js",
);

type RawEdit = [index: number, deleteCount: number, text?: string];

async function ensureTraceSource() {
  if (existsSync(traceCacheFile)) {
    return readFileSync(traceCacheFile, "utf8");
  }

  mkdirSync(dirname(traceCacheFile), { recursive: true });
  process.stdout.write(
    `Downloading published edit trace to ${traceCacheFile}\n`,
  );
  const response = await fetch(TRACE_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download published edit trace: ${response.status} ${response.statusText}`,
    );
  }

  const source = await response.text();
  writeFileSync(traceCacheFile, source, "utf8");
  return source;
}

function evaluateTraceSource(source: string) {
  const loader = new Function(`${source}\nreturn { edits, finalText };`);
  const loaded = loader() as { edits: RawEdit[]; finalText: string };

  if (!Array.isArray(loaded.edits) || typeof loaded.finalText !== "string") {
    throw new Error("Published edit trace had an unexpected shape");
  }

  return loaded;
}

function coalesceTraceEdits(edits: readonly RawEdit[], maxBurstChars: number) {
  const operations: TextOperation[] = [];
  let pendingInsert: TextOperation | null = null;

  const flushPendingInsert = () => {
    if (pendingInsert !== null) {
      operations.push(pendingInsert);
      pendingInsert = null;
    }
  };

  for (const [index, deleteCount, maybeText] of edits) {
    const text = maybeText ?? "";

    if (deleteCount === 0 && text.length > 0) {
      if (
        pendingInsert !== null &&
        pendingInsert.kind === "insert" &&
        pendingInsert.index + pendingInsert.text.length === index &&
        pendingInsert.text.length < maxBurstChars &&
        !pendingInsert.text.endsWith("\n") &&
        text !== "\n"
      ) {
        pendingInsert = {
          kind: "insert",
          actor: pendingInsert.actor,
          index: pendingInsert.index,
          text: pendingInsert.text + text,
        };
      } else {
        flushPendingInsert();
        pendingInsert = {
          kind: "insert",
          actor: "trace",
          index,
          text,
        };
      }
      continue;
    }

    flushPendingInsert();

    if (deleteCount > 0) {
      operations.push({
        kind: "delete",
        actor: "trace",
        index,
        length: deleteCount,
      });
    }

    if (text.length > 0) {
      operations.push({
        kind: "insert",
        actor: "trace",
        index,
        text,
      });
    }
  }

  flushPendingInsert();
  return operations;
}

export async function createPublishedEditTraceWorkload(
  scale: Scale,
): Promise<TextWorkload> {
  const { edits, finalText } = evaluateTraceSource(await ensureTraceSource());
  const rawEditLimit = scale === "full" ? edits.length : 10_000;
  const trimmedEdits = edits.slice(0, rawEditLimit);
  const maxBurstChars =
    scale === "full" ? FULL_TRACE_BURST_CHARS : Number.MAX_SAFE_INTEGER;
  const operations = coalesceTraceEdits(trimmedEdits, maxBurstChars);
  const expectedText = applyTextOperations("", operations);

  if (rawEditLimit === edits.length && expectedText !== finalText) {
    throw new Error(
      "Published edit trace baseline replay did not match the published final text",
    );
  }

  return {
    name: "published_edit_trace",
    kind: "text",
    description:
      "Replay the published automerge-perf edit-by-index trace, coalescing adjacent inserts into editor-style bursts.",
    initialText: "",
    operations,
    expectedText,
    meta: {
      source: TRACE_URL,
      rawEditCount: trimmedEdits.length,
      coalescedOperationCount: operations.length,
      scale,
      maxBurstChars,
    },
  };
}
