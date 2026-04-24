import { describe, expect, test } from "vitest";
import { FugueBurst } from "../../src";
import { InvalidPositionError } from "../../src/errors";
import { MAX_BURST_DEPTH, TOP_COORD_MID } from "../../src/position";

describe("fugue-burst", () => {
  test("constructor rejects prefixes deeper than the burst depth cap", () => {
    expect(
      () =>
        new FugueBurst(
          Array.from({ length: MAX_BURST_DEPTH + 1 }, () => TOP_COORD_MID),
          Array.from({ length: MAX_BURST_DEPTH + 1 }, () => 1n),
        ),
    ).toThrow(InvalidPositionError);
  });

  test("prepared-prefix factory validates prefix shape", () => {
    expect(() =>
      FugueBurst.fromPreparedPrefix({
        topCoord: TOP_COORD_MID,
        bursts: [1, 2],
        nestedCoords: [],
      }),
    ).toThrow(InvalidPositionError);
  });
});
