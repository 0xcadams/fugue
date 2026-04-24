import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { BoardState, PositionStats } from "./types.js";

const textEncoder = new TextEncoder();

export function average(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction)),
  );
  return sorted[index]!;
}

export function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function jsonByteLength(value: unknown) {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

function serializedByteLength(value: unknown) {
  if (typeof value === "string") {
    return textEncoder.encode(value).byteLength;
  }

  return jsonByteLength(value);
}

export function summarizePositions(values: readonly unknown[]): PositionStats {
  const byteLengths = values.map((value) => serializedByteLength(value));
  const totalBytes = byteLengths.reduce((sum, value) => sum + value, 0);
  const maxBytes = byteLengths.reduce((max, value) => {
    return value > max ? value : max;
  }, 0);

  return {
    count: values.length,
    totalBytes,
    avgBytes: round(average(byteLengths), 2),
    p95Bytes: percentile(byteLengths, 0.95),
    maxBytes,
  };
}

export function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function hashBoard(board: BoardState) {
  return createHash("sha256")
    .update(JSON.stringify(board))
    .digest("hex")
    .slice(0, 16);
}

export function measure<T>(fn: () => T) {
  const startedAt = performance.now();
  const value = fn();
  const finishedAt = performance.now();

  return {
    value,
    durationMs: round(finishedAt - startedAt),
  };
}
