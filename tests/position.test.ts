import { describe, expect, test } from "vitest";
import { encode62 } from "../src/codec";
import { InvalidPositionError } from "../src/errors";
import {
  MAX_BURST_DEPTH,
  NESTED_BURST_WIDTH,
  NESTED_COORD_MAX,
  NESTED_COORD_MID,
  NESTED_COORD_WIDTH,
  TOP_BURST_MAX,
  TOP_BURST_WIDTH,
  TOP_COORD_MID,
  TOP_COORD_WIDTH,
  comparePositions,
  formatPosition,
  isFuguePosition,
  isPositionPrefix,
  isRightCoord,
  parsePosition,
  toLeftAncestor,
  toLeftCoord,
  tryParsePosition,
} from "../src/position";

describe("position", () => {
  test("formats and parses flat positions", () => {
    const position = formatPosition({
      coords: [TOP_COORD_MID, NESTED_COORD_MID],
      bursts: [12345n],
    });

    expect(position.split("!")).toHaveLength(3);
    expect(parsePosition(position)).toEqual({
      coords: [TOP_COORD_MID, NESTED_COORD_MID],
      bursts: [12345n],
    });
    expect(isFuguePosition(position)).toBe(true);
  });

  test("formats and parses nested positions", () => {
    const position = formatPosition({
      coords: [TOP_COORD_MID, 101n, 303n],
      bursts: [456n, 789n],
    });

    expect(parsePosition(position)).toEqual({
      coords: [TOP_COORD_MID, 101n, 303n],
      bursts: [456n, 789n],
    });
    expect(position).toBe(
      [
        encode62(TOP_COORD_MID, TOP_COORD_WIDTH),
        encode62(456n, TOP_BURST_WIDTH),
        encode62(101n, NESTED_COORD_WIDTH),
        encode62(789n, NESTED_BURST_WIDTH),
        encode62(303n, NESTED_COORD_WIDTH),
      ].join("!"),
    );
  });

  test("comparePositions matches raw string order", () => {
    const positions = [
      formatPosition({ coords: [TOP_COORD_MID, 101n], bursts: [5n] }),
      formatPosition({ coords: [TOP_COORD_MID, 101n, 201n], bursts: [5n, 3n] }),
      formatPosition({ coords: [TOP_COORD_MID, 101n, 201n], bursts: [5n, 9n] }),
      formatPosition({ coords: [TOP_COORD_MID, 303n], bursts: [5n] }),
    ];

    const byString = [...positions].sort();
    const byParsed = [...positions].sort((left, right) => {
      return comparePositions(parsePosition(left), parsePosition(right));
    });

    expect(byParsed).toEqual(byString);
    expect(
      comparePositions(
        parsePosition(byParsed[0]!),
        parsePosition(byParsed[0]!),
      ),
    ).toBe(0);
  });

  test("prefix detection works across nested paths", () => {
    const prefix = parsePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n], bursts: [5n] }),
    );
    const descendant = parsePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 201n], bursts: [5n, 9n] }),
    );
    const sibling = parsePosition(
      formatPosition({ coords: [TOP_COORD_MID, 303n], bursts: [5n] }),
    );

    expect(isPositionPrefix(prefix, descendant)).toBe(true);
    expect(isPositionPrefix(prefix, prefix)).toBe(true);
    expect(isPositionPrefix(prefix, sibling)).toBe(false);
    expect(isPositionPrefix(descendant, prefix)).toBe(false);
  });

  test("left ancestors flip the final coord to the hidden left side", () => {
    const parsed = parsePosition(
      formatPosition({ coords: [TOP_COORD_MID, 101n, 303n], bursts: [5n, 9n] }),
    );
    const ancestor = toLeftAncestor(parsed);

    expect(ancestor.coords.slice(0, -1)).toEqual(parsed.coords.slice(0, -1));
    expect(ancestor.bursts).toEqual(parsed.bursts);
    expect(ancestor.coords[ancestor.coords.length - 1]).toBe(302n);
    expect(isRightCoord(parsed.coords[parsed.coords.length - 1]!)).toBe(true);
    expect(isRightCoord(ancestor.coords[ancestor.coords.length - 1]!)).toBe(
      false,
    );
  });

  test("parse rejects malformed positions", () => {
    expect(tryParsePosition("not-a-position")).toBeNull();
    expect(tryParsePosition("abc!def")).toBeNull();

    const evenFinalCoord = [
      encode62(TOP_COORD_MID, TOP_COORD_WIDTH),
      encode62(5n, TOP_BURST_WIDTH),
      encode62(100n, NESTED_COORD_WIDTH),
    ].join("!");
    expect(tryParsePosition(evenFinalCoord)).toBeNull();

    const wrongNestedBurstWidth = [
      encode62(TOP_COORD_MID, TOP_COORD_WIDTH),
      encode62(5n, TOP_BURST_WIDTH),
      encode62(101n, NESTED_COORD_WIDTH),
      encode62(9n, NESTED_BURST_WIDTH + 1),
      encode62(303n, NESTED_COORD_WIDTH),
    ].join("!");
    expect(tryParsePosition(wrongNestedBurstWidth)).toBeNull();

    const badTopCoord = [
      `${"0".repeat(TOP_COORD_WIDTH - 1)}@`,
      encode62(5n, TOP_BURST_WIDTH),
      encode62(101n, NESTED_COORD_WIDTH),
    ].join("!");
    expect(tryParsePosition(badTopCoord)).toBeNull();

    const badNestedCoord = [
      encode62(TOP_COORD_MID, TOP_COORD_WIDTH),
      encode62(5n, TOP_BURST_WIDTH),
      `${"0".repeat(NESTED_COORD_WIDTH - 1)}@`,
    ].join("!");
    expect(tryParsePosition(badNestedCoord)).toBeNull();
  });

  test("format validates position shape and ranges", () => {
    expect(() =>
      formatPosition({ coords: [TOP_COORD_MID], bursts: [] }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPosition({
        coords: [TOP_COORD_MID, NESTED_COORD_MID],
        bursts: [1n, 2n],
      }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPosition({ coords: [TOP_COORD_MID, 100n], bursts: [1n] }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPosition({
        coords: [TOP_COORD_MID, NESTED_COORD_MID],
        bursts: [TOP_BURST_MAX + 1n],
      }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPosition({
        coords: [TOP_COORD_MID, NESTED_COORD_MAX + 1n],
        bursts: [1n],
      }),
    ).toThrow(InvalidPositionError);

    expect(() =>
      formatPosition({
        coords: Array.from({ length: MAX_BURST_DEPTH + 2 }, () => 1n),
        bursts: Array.from({ length: MAX_BURST_DEPTH + 1 }, () => 1n),
      }),
    ).toThrow(InvalidPositionError);
  });

  test("parsePosition throws on invalid values", () => {
    expect(() => parsePosition("still-not-a-position")).toThrow(
      InvalidPositionError,
    );
  });

  test("toLeftCoord rejects already-left coords", () => {
    expect(() => toLeftCoord(100n)).toThrow(InvalidPositionError);
    expect(toLeftCoord(101n)).toBe(100n);
  });
});
