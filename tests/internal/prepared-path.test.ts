import { describe, expect, test } from "vitest";
import { InvalidPositionError } from "../../src/errors";
import {
  comparePreparedPathSlices,
  formatPreparedPosition,
  isPreparedPathPrefix,
  midpointRightCoordBetween,
  nestedCoordsForBurstDepth,
  toPreparedLeftAncestor,
} from "../../src/internal/prepared-path";
import {
  MAX_BURST_DEPTH,
  NESTED_BURST_MAX_NUMBER,
  NESTED_COORD_MAX_NUMBER,
  TOP_COORD_MID,
  formatPosition,
  preparePosition,
} from "../../src/position";

describe("prepared-path", () => {
  test("compares and prefixes shared prepared slices by explicit depth", () => {
    const left = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 201n], bursts: [5n, 7n] }),
    );
    const right = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 303n], bursts: [5n, 9n] }),
    );

    expect(comparePreparedPathSlices(left, 1, right)).toBe(-1);
    expect(comparePreparedPathSlices(right, 1, left, 1)).toBe(0);
    expect(comparePreparedPathSlices(right, 2, left)).toBe(1);
    expect(isPreparedPathPrefix(left, 1, right)).toBe(true);
    expect(isPreparedPathPrefix(right, 2, left)).toBe(false);
    expect(
      isPreparedPathPrefix({ ...left, topCoord: left.topCoord + 1n }, 1, right),
    ).toBe(false);
  });

  test("extracts nested coords for burst depth and validates depth", () => {
    const prepared = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 303n], bursts: [5n, 7n] }),
    );

    expect(nestedCoordsForBurstDepth(prepared, 0)).toEqual([]);
    expect(nestedCoordsForBurstDepth(prepared, 1)).toEqual([101]);
    expect(nestedCoordsForBurstDepth(prepared, 2)).toEqual([101, 303]);
    expect(() => nestedCoordsForBurstDepth(prepared, 3)).toThrow(
      InvalidPositionError,
    );
  });

  test("midpointRightCoordBetween only returns interior odd coords", () => {
    expect(midpointRightCoordBetween(101, 103)).toBeNull();
    expect(midpointRightCoordBetween(101, 111)).toBe(107);
    expect(midpointRightCoordBetween(100, 108)).toBe(105);
  });

  test("prepared path validation guards invalid ancestors and invalid formatting", () => {
    const prepared = preparePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 303n], bursts: [5n, 7n] }),
    );

    expect(() =>
      toPreparedLeftAncestor({ ...prepared, finalCoord: 302 }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPreparedPosition({
        ...prepared,
        depth: 0,
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        nestedCoords: [],
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        depth: MAX_BURST_DEPTH + 1,
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        topCoord: -1n,
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        finalCoord: 302,
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        bursts: [5, NESTED_BURST_MAX_NUMBER + 1],
      }),
    ).toThrow(InvalidPositionError);
    expect(() =>
      formatPreparedPosition({
        ...prepared,
        finalCoord: NESTED_COORD_MAX_NUMBER + 1,
      }),
    ).toThrow(InvalidPositionError);
  });
});
