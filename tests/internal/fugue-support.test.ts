import { describe, expect, test } from "vitest";
import {
  PreparedPositionCache,
  chooseBurstToken,
  defaultRandomBytes,
  midpointPositionAtSameDepth,
  nextSequentialNestedCoordAfter,
  nextSequentialTopCoordAfter,
  nextSequentialTopCoordBefore,
  randomBelow,
  randomBelowNumber,
} from "../../src/internal/fugue-support";
import {
  COORD_STRIDE,
  NESTED_COORD_MAX_RIGHT_NUMBER,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  formatPosition,
  preparePosition,
} from "../../src/position";

describe("fugue-support", () => {
  test("PreparedPositionCache reads through and evicts oldest entries", () => {
    const cache = new PreparedPositionCache();

    expect(cache.get("A!B!C")).toBeNull();

    for (let index = 0; index <= 16_384; index++) {
      cache.set({
        text: `A!B!${index}`,
        topCoord: 0n,
        bursts: [0],
        nestedCoords: [],
        finalCoord: 1,
        depth: 1,
      });
    }

    expect(cache.get("A!B!0")).toBeNull();
    expect(cache.get("A!B!16384")).not.toBeNull();
  });

  test("sequential coord helpers stop cleanly at their bounds", () => {
    expect(nextSequentialTopCoordAfter(1n)).toBe(1n + COORD_STRIDE);
    expect(nextSequentialTopCoordAfter(TOP_COORD_MAX_RIGHT - 2n)).toBe(
      TOP_COORD_MAX_RIGHT,
    );
    expect(nextSequentialTopCoordAfter(TOP_COORD_MAX_RIGHT)).toBeNull();

    expect(nextSequentialTopCoordBefore(TOP_COORD_MAX_RIGHT)).toBe(
      TOP_COORD_MAX_RIGHT - COORD_STRIDE,
    );
    expect(nextSequentialTopCoordBefore(2n)).toBe(1n);
    expect(nextSequentialTopCoordBefore(1n)).toBeNull();

    expect(nextSequentialNestedCoordAfter(1)).toBe(1 + Number(COORD_STRIDE));
    expect(
      nextSequentialNestedCoordAfter(NESTED_COORD_MAX_RIGHT_NUMBER - 2),
    ).toBe(NESTED_COORD_MAX_RIGHT_NUMBER);
    expect(
      nextSequentialNestedCoordAfter(NESTED_COORD_MAX_RIGHT_NUMBER),
    ).toBeNull();
  });

  test("chooseBurstToken keeps picks in-range", () => {
    expect(chooseBurstToken((min) => min, 10, 12)).toBe(10);
    expect(chooseBurstToken((_min, max) => max, 10, 20)).toBe(18);
    expect(() => chooseBurstToken((min) => min, 12, 10)).toThrow();
  });

  test("defaultRandomBytes validates byte lengths", () => {
    expect(() => defaultRandomBytes(0, true)).toThrow();
  });

  test("midpointPositionAtSameDepth returns null for mismatched prepared paths", () => {
    const left = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n], bursts: [5n] }),
    );
    const right = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 303n], bursts: [5n] }),
    );

    expect(midpointPositionAtSameDepth(left, right)?.text).toBe(
      formatPosition({ coords: [TOP_COORD_MID, 203n], bursts: [5n] }),
    );
    expect(
      midpointPositionAtSameDepth(
        { ...left, topCoord: left.topCoord + 2n },
        right,
      ),
    ).toBeNull();
    expect(
      midpointPositionAtSameDepth(
        preparePosition(
          formatPosition({
            coords: [TOP_COORD_MID, 101n, 201n],
            bursts: [5n, 7n],
          }),
        ),
        preparePosition(
          formatPosition({
            coords: [TOP_COORD_MID, 101n, 301n],
            bursts: [5n, 9n],
          }),
        ),
      ),
    ).toBeNull();
    expect(
      midpointPositionAtSameDepth(
        preparePosition(
          formatPosition({ coords: [TOP_COORD_MID, 101n], bursts: [5n] }),
        ),
        preparePosition(
          formatPosition({ coords: [TOP_COORD_MID, 103n], bursts: [5n] }),
        ),
      ),
    ).toBeNull();
  });

  test("random helpers validate limits and random source output", () => {
    expect(() => randomBelow(() => new Uint8Array(1), 0n)).toThrow();
    expect(randomBelow(() => new Uint8Array(1), 1n)).toBe(0n);
    expect(() => randomBelow(() => new Uint8Array(0), 2n)).toThrow();
    expect(() => randomBelow(() => new Uint8Array([0xff]), 200n)).toThrow();

    expect(() => randomBelowNumber(() => new Uint8Array(1), 0)).toThrow();
    expect(randomBelowNumber(() => new Uint8Array(1), 1)).toBe(0);
    expect(() => randomBelowNumber(() => new Uint8Array(0), 2)).toThrow();
    expect(() =>
      randomBelowNumber(() => new Uint8Array([0xff]), 200),
    ).toThrow();
  });
});
