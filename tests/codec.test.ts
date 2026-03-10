import { describe, expect, test } from "vitest";
import { decode62, encode62 } from "../src/codec";
import { InvalidBase62Error } from "../src/errors";
import { ANCHOR_WIDTH } from "../src/position";

describe("codec", () => {
  test("encode62/decode62 roundtrip", () => {
    const values = [0n, 1n, 61n, 62n, 123456789n, (1n << 64n) - 1n];

    for (const value of values) {
      const encoded = encode62(value, ANCHOR_WIDTH);
      expect(encoded.length).toBe(ANCHOR_WIDTH);
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
});
