import { describe, expect, test } from "vitest";
import { InvalidPositionError } from "../../src/errors";
import {
  coordMaxNumberAtDepth,
  highestOdd,
  midpointOdd,
  toLeftCoord,
  toSafeInteger,
} from "../../src/internal/position-schema";

describe("position-schema", () => {
  test("safe integer helpers reject oversized values", () => {
    expect(() =>
      toSafeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "boom"),
    ).toThrow(InvalidPositionError);
    expect(() => coordMaxNumberAtDepth(0)).toThrow(InvalidPositionError);
  });

  test("odd helpers normalize upper bounds predictably", () => {
    expect(highestOdd(10n)).toBe(9n);
    expect(highestOdd(11n)).toBe(11n);
    expect(midpointOdd(1n)).toBe(1n);
    expect(midpointOdd(3n)).toBe(1n);
    expect(midpointOdd(8n)).toBe(5n);
  });

  test("toLeftCoord rejects already-left coords", () => {
    expect(() => toLeftCoord(100n)).toThrow(InvalidPositionError);
  });
});
