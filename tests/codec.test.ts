import { describe, expect, test } from "vitest";
import { decode62, encode62, parseBase62FixedWidth } from "../src/codec";
import { InvalidBase62Error } from "../src/errors";
import { TOP_COORD_WIDTH } from "../src/position";

describe("codec", () => {
  test("encode62/decode62 roundtrip", () => {
    const values = [0n, 1n, 61n, 62n, 123456789n, (1n << 64n) - 1n];

    for (const value of values) {
      const encoded = encode62(value, TOP_COORD_WIDTH);
      expect(encoded.length).toBe(TOP_COORD_WIDTH);
      expect(decode62(encoded)).toBe(value);
    }
  });

  test("encode62 enforces width", () => {
    expect(encode62(0n, 3)).toBe("000");
    expect(() => encode62(62n ** 3n, 3)).toThrow(InvalidBase62Error);
  });

  test("encode62/decode62 validate inputs", () => {
    expect(() => encode62(10n, 0)).toThrow(InvalidBase62Error);
    expect(() => encode62(-1n, 2)).toThrow(InvalidBase62Error);
    expect(() => decode62("A!")).toThrow(InvalidBase62Error);
  });

  test("parseBase62FixedWidth rejects invalid widths, chars, and overflow", () => {
    expect(parseBase62FixedWidth("AA", 3, 999n)).toBeNull();
    expect(parseBase62FixedWidth("A!A", 3, 999n)).toBeNull();
    expect(parseBase62FixedWidth("zzz", 3, 100n)).toBeNull();
    expect(parseBase62FixedWidth("00A", 3, 10n)).toBe(10n);
  });
});
