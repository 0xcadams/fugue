import { describe, expect, test } from "vitest";
import { encode62 } from "../src/codec";
import { InvalidPositionError } from "../src/errors";
import {
  ANCHOR_WIDTH,
  comparePaths,
  formatPosition,
  isFuguePosition,
  MAX_ANCHOR_PATH_DEPTH,
  MAX_SLOT_PATH_DEPTH,
  parsePosition,
  RUN_WIDTH,
  SLOT_MID,
  SLOT_WIDTH,
  tryParsePosition,
} from "../src/position";

describe("position", () => {
  test("formatPosition/parsePosition roundtrip for simple keys", () => {
    const input = {
      anchorPath: [123456789n],
      runId: 987654321n,
      slotPath: [SLOT_MID + 123n],
    };

    const position = formatPosition(input);
    expect(isFuguePosition(position)).toBe(true);
    expect(parsePosition(position)).toEqual(input);
  });

  test("formatPosition/parsePosition roundtrip for deep paths", () => {
    const input = {
      anchorPath: [7n, 8n, 9n],
      runId: 123456789n,
      slotPath: [11n, SLOT_MID, 99n],
    };

    const position = formatPosition(input);
    expect(isFuguePosition(position)).toBe(true);
    expect(parsePosition(position)).toEqual(input);
  });

  test("non-throwing parse helpers are symmetric", () => {
    const position = formatPosition({
      anchorPath: [7n, 8n],
      runId: 9n,
      slotPath: [10n, 11n],
    });

    expect(tryParsePosition(position)).toEqual({
      anchorPath: [7n, 8n],
      runId: 9n,
      slotPath: [10n, 11n],
    });
    expect(tryParsePosition("not-a-position")).toBeNull();
  });

  test("string order matches path-prefix order", () => {
    const plain = formatPosition({
      anchorPath: [1n],
      runId: 2n,
      slotPath: [3n],
    });
    const deeperAnchor = formatPosition({
      anchorPath: [1n, 0n],
      runId: 2n,
      slotPath: [3n],
    });
    const deeperSlot = formatPosition({
      anchorPath: [1n],
      runId: 2n,
      slotPath: [3n, 0n],
    });
    const nextAnchor = formatPosition({
      anchorPath: [2n],
      runId: 0n,
      slotPath: [0n],
    });

    expect(plain < deeperAnchor).toBe(true);
    expect(plain < deeperSlot).toBe(true);
    expect(deeperAnchor < nextAnchor).toBe(true);
    expect(comparePaths([2n], [1n])).toBe(1);
  });

  test("invalid position strings are rejected", () => {
    expect(isFuguePosition("not-a-position")).toBe(false);
    expect(() => parsePosition("not-a-position")).toThrow(InvalidPositionError);
  });

  test("parsePosition validates separators, widths, and ranges", () => {
    const validAnchor = encode62(1n, ANCHOR_WIDTH);
    const validSubanchor = encode62(2n, ANCHOR_WIDTH);
    const validRun = encode62(3n, RUN_WIDTH);
    const validSlot = encode62(4n, SLOT_WIDTH);

    const badFieldSeparator = `${validAnchor}.${validRun}!${validSlot}`;
    expect(isFuguePosition(badFieldSeparator)).toBe(false);
    expect(() => parsePosition(badFieldSeparator)).toThrow(
      InvalidPositionError,
    );

    const badPathSeparator = `${validAnchor}~~${validSubanchor}!${validRun}!${validSlot}`;
    expect(isFuguePosition(badPathSeparator)).toBe(false);
    expect(() => parsePosition(badPathSeparator)).toThrow(InvalidPositionError);

    const tooLargeAnchor = `${encode62(1n << 64n, ANCHOR_WIDTH)}!${validRun}!${validSlot}`;
    expect(isFuguePosition(tooLargeAnchor)).toBe(false);
    expect(() => parsePosition(tooLargeAnchor)).toThrow(InvalidPositionError);

    const badSlotWidth = `${validAnchor}!${validRun}!abc`;
    expect(isFuguePosition(badSlotWidth)).toBe(false);
    expect(() => parsePosition(badSlotWidth)).toThrow(InvalidPositionError);

    const invalidRunChars = `${validAnchor}!${"@".repeat(RUN_WIDTH)}!${validSlot}`;
    expect(isFuguePosition(invalidRunChars)).toBe(false);
    expect(() => parsePosition(invalidRunChars)).toThrow(InvalidPositionError);

    const invalidSlotChars = `${validAnchor}!${validRun}!${validSlot}~${"@".repeat(SLOT_WIDTH)}`;
    expect(isFuguePosition(invalidSlotChars)).toBe(false);
    expect(() => parsePosition(invalidSlotChars)).toThrow(InvalidPositionError);

    const tooDeepAnchorPath = `${Array.from(
      { length: MAX_ANCHOR_PATH_DEPTH + 1 },
      () => validAnchor,
    ).join("~")}!${validRun}!${validSlot}`;
    expect(isFuguePosition(tooDeepAnchorPath)).toBe(false);
    expect(() => parsePosition(tooDeepAnchorPath)).toThrow(
      InvalidPositionError,
    );
  });

  test("formatPosition validates field ranges and depth caps", () => {
    expect(() =>
      formatPosition({ anchorPath: [], runId: 0n, slotPath: [0n] }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPosition({ anchorPath: [0n], runId: 1n << 96n, slotPath: [0n] }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPosition({ anchorPath: [0n], runId: 0n, slotPath: [] }),
    ).toThrow(InvalidPositionError);

    const tooDeepAnchorPath = Array.from(
      { length: MAX_ANCHOR_PATH_DEPTH + 1 },
      () => 0n,
    );
    expect(() =>
      formatPosition({
        anchorPath: tooDeepAnchorPath,
        runId: 0n,
        slotPath: [0n],
      }),
    ).toThrow(InvalidPositionError);

    const tooDeepSlotPath = Array.from(
      { length: MAX_SLOT_PATH_DEPTH + 1 },
      () => 0n,
    );
    expect(() =>
      formatPosition({
        anchorPath: [0n],
        runId: 0n,
        slotPath: tooDeepSlotPath,
      }),
    ).toThrow(InvalidPositionError);
  });
});
