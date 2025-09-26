import { generateKeyBetween } from "fractional-indexing";
import { describe, expect, test } from "vitest";
import { Fugue } from "../src";
import {
  getPrefix,
  leftVersion,
  nextOddValueSeq,
  parseBase52,
  sanitizeClientID,
  stringifyBase52,
  stringifyShortName,
} from "../src/strings";

describe("fugue", () => {
  test("basic position creation", () => {
    const fugue = new Fugue("client1");

    // Create first position
    const first = fugue.between(null, null);

    // Insert after first
    const second = fugue.between(first, null);

    // Insert after second
    const third = fugue.between(second, null);

    // Insert before first
    const zeroth = fugue.between(null, first);

    // Insert between second and third (midpoint)
    const secondAndHalf = fugue.between(second, third);

    expect(first < second).toBe(true);
    expect(first < third).toBe(true);
    expect(third > second).toBe(true);
    expect(secondAndHalf > second).toBe(true);
    expect(secondAndHalf < third).toBe(true);

    expect(zeroth < first).toBe(true);
    expect(zeroth < second).toBe(true);
    expect(zeroth < third).toBe(true);
    expect(zeroth < secondAndHalf).toBe(true);

    console.log({ first, second, third, zeroth, secondAndHalf });
  });

  test("differing clients with same clientID", () => {
    const fugue1 = new Fugue("server");
    const fugue2 = new Fugue("server");

    const pos1 = fugue1.between(null, null);
    const pos2 = fugue2.between(pos1, null);

    expect(pos1).not.toBe(pos2);
    expect(pos1 < pos2).toBe(true);

    expect(pos1).toContain("server");
    expect(pos2).toContain("server");
  });

  test("handles invalid inputs gracefully", () => {
    const fugue = new Fugue("test");

    // Test when left >= right
    const pos1 = fugue.between("B", "A");
    expect(pos1).toBeTruthy();
    expect(pos1 > Fugue.FIRST).toBe(true);

    // Test when right > LAST
    const pos2 = fugue.between(null, "~~~");
    expect(pos2 < Fugue.LAST).toBe(true);

    // Test with completely invalid position strings
    const pos3 = fugue.between("xyz", null); // No waypoint chars at all
    expect(pos3).toBeTruthy();
    expect(pos3 > Fugue.FIRST).toBe(true);

    const pos4 = fugue.between("", null); // Empty string
    expect(pos4).toBeTruthy();
    expect(pos4 > Fugue.FIRST).toBe(true);
  });

  test("consistent ordering", () => {
    const fugue = new Fugue("consistent");
    const positions: string[] = [];

    // Create a sequence of positions
    let prev = null;
    for (let i = 0; i < 10; i++) {
      const pos = fugue.between(prev, null);
      positions.push(pos);
      prev = pos;
    }

    // Verify they maintain strict ordering
    for (let i = 1; i < positions.length; i++) {
      // These accesses are safe due to our loop bounds
      const current = positions[i]!;
      const previous = positions[i - 1]!;
      expect(previous < current).toBe(true);
    }
  });

  test("existing deterministic positions can be used", () => {
    const internal = new Fugue("test");

    const first = generateKeyBetween(null, null);
    const last = generateKeyBetween(first, null);
    // const third = generateKeyBetween(second, null);

    const middle = internal.between(first, last);
    const middle2 = internal.between(first, middle);

    expect(first < middle).toBe(true);
    expect(middle < last).toBe(true);
    expect(first < middle2).toBe(true);
    expect(middle2 < middle).toBe(true);
  });

  test("multiple clients maintain order", () => {
    const fugue1 = new Fugue("client1");
    const fugue2 = new Fugue("client2");

    const first = fugue1.first();
    const last = fugue1.after(first);

    // simulating these happening in parallel
    const middle1 = fugue1.between(first, last);
    const middle2 = fugue2.between(first, last);

    expect(middle1 < last).toBe(true);
    expect(middle2 < last).toBe(true);
    expect(middle1 > first).toBe(true);
    expect(middle2 > first).toBe(true);
    expect(middle1).not.toBe(middle2);

    console.log({ first, last, middle1, middle2 });
  });

  test("boundary cases", () => {
    const fugue = new Fugue("test");

    // Test insertion at start
    const firstPos = fugue.between(Fugue.FIRST, null);
    expect(firstPos > Fugue.FIRST).toBe(true);

    // Test insertion at end
    const lastPos = fugue.before(Fugue.LAST);
    expect(lastPos < Fugue.LAST).toBe(true);

    // Test insertion between FIRST and LAST
    const middlePos = fugue.between(Fugue.FIRST, Fugue.LAST);
    expect(middlePos > Fugue.FIRST && middlePos < Fugue.LAST).toBe(true);
  });

  test("internal string handling", () => {
    const fugue = new Fugue("test");

    // Create many positions to force creation of positions with index >= 10
    // This will exercise the stringifyShortName function's else branch
    let prev = null;
    let positions: string[] = [];
    for (let i = 0; i < 100; i++) {
      // Increased to ensure we get indices > 52
      const pos = fugue.between(prev, null);
      positions.push(pos);
      prev = pos;
    }

    // Verify we have positions with different lengths (indicating indices > 52)
    const lengths = new Set(positions.map((p) => p.length));
    expect(lengths.size).toBeGreaterThan(1);

    // Test getPrefix edge case with various invalid position strings
    const invalidPositions = [
      "", // Empty string
      "ABC", // No waypoint chars
      "XYZ123", // No valid waypoint chars
      "test", // Just a string without waypoint markers
    ];

    for (const invalidPos of invalidPositions) {
      const nextPos = fugue.between(invalidPos, null);
      expect(nextPos).toBeTruthy();
      expect(nextPos > Fugue.FIRST).toBe(true);
    }
  });

  test("fuzzy ordering with multiple insertions", () => {
    const fugue = new Fugue("test");

    // Create initial positions
    const start = fugue.between(null, null);
    const end = fugue.between(start, null);

    // Create multiple positions between start and end
    const middlePositions: string[] = [];
    for (let i = 0; i < 20; i++) {
      // Randomly choose to insert at beginning, middle, or end of the range
      let insertAfter = start as string;
      if (middlePositions.length > 0 && Math.random() >= 0.5) {
        const randomIndex = Math.floor(Math.random() * middlePositions.length);
        insertAfter = middlePositions[randomIndex]!;
      }

      const pos = fugue.between(insertAfter, end);
      middlePositions.push(pos);
    }

    // Verify all positions maintain strict ordering
    const allPositions = [start, ...middlePositions, end];
    for (let i = 1; i < allPositions.length; i++) {
      const prev = allPositions[i - 1]!;
      const curr = allPositions[i]!;
      expect(prev < curr).toBe(true);
    }

    // Verify we can still insert between any two adjacent positions
    for (let i = 0; i < allPositions.length - 1; i++) {
      const pos1 = allPositions[i]!;
      const pos2 = allPositions[i + 1]!;
      const newPos = fugue.between(pos1, pos2);
      expect(pos1 < newPos).toBe(true);
      expect(newPos < pos2).toBe(true);
    }
  });

  test("basic position creation", () => {
    const fugue = new Fugue("basic");

    const pos = fugue.first();

    // By definition, FIRST < pos < LAST
    expect(pos > Fugue.FIRST).toBe(true);
    expect(pos < Fugue.LAST).toBe(true);
  });

  test("sequential creation", () => {
    const fugue = new Fugue("sequential");

    const pos1 = fugue.between(null, null);
    const pos2 = fugue.between(pos1, null);
    expect(pos1 < pos2).toBe(true);
  });

  test("inserting in the middle", () => {
    const fugue = new Fugue("inserting");

    const pos1 = fugue.first();
    const pos2 = fugue.after(pos1);
    const pos3 = fugue.between(pos1, pos2);

    expect(pos1 < pos3).toBe(true);
    expect(pos3 < pos2).toBe(true);
  });

  test("extensive insertion ordering", () => {
    const fugue = new Fugue("extensive");

    // Insert a sequence of positions in an array, ensuring we always insert
    // a 'middle' position each time to check correctness of ordering
    const positions: string[] = [];
    positions.push(fugue.between(null, null)); // first item
    for (let i = 0; i < 5; i++) {
      const left = positions[Math.floor(positions.length / 2)];
      const right = null; // always append at the end after 'left'
      const newPos = fugue.between(left ?? null, right);
      positions.push(newPos);
    }

    // Sort them
    const sorted = [...positions].sort();
    // They should remain unique
    const uniqueSet = new Set(sorted);

    expect(positions.length).toEqual(uniqueSet.size);
    expect(positions).toEqual(sorted); // they should already be sorted in time
  });

  test("positions from different Fugue instances do not necessarily compare meaningfully", () => {
    // If you have a different client ID, you can still compare
    // them lexicographically, but there is no guarantee they'd
    // interleave in a predictable way with another client's positions
    const fugueA = new Fugue("A");
    const fugueB = new Fugue("B");

    const a1 = fugueA.between(null, null);
    const b1 = fugueB.between(null, null);

    // Lex compare might place a1 < b1 or b1 < a1, depending on the
    // sanitized ID. We can at least ensure they're not equal
    expect(a1).not.toBe(b1);
  });

  test("cache size is limited", () => {
    const fugue = new Fugue("test");
    const cacheSize = fugue.cacheSize;
    expect(cacheSize).toBe(0);

    const first = fugue.between(null, null);

    for (let i = 0; i < 1300; i++) {
      const fugue2 = new Fugue(`other${i}`);

      const newPos = fugue2.between(first, null);

      fugue.between(first, newPos);
    }

    expect(fugue.cacheSize).toBeLessThanOrEqual(1000);
  });

  test("sanitized clientID does not contain '.' or ','", () => {
    // We'll rely on the constructor's behavior:
    const fugueBad = new Fugue("some,bad.id");
    expect(fugueBad.clientID.includes(".")).toBe(false);
    expect(fugueBad.clientID.includes(",")).toBe(false);
  });

  test("same client ID produces deterministic positions", () => {
    const fugue1 = new Fugue("deterministic");
    const fugue2 = new Fugue("deterministic");

    // Create a sequence of positions with first instance
    const pos1_1 = fugue1.between(null, null);
    const pos1_2 = fugue1.after(pos1_1);
    const pos1_3 = fugue1.after(pos1_2);

    // Create the same sequence with second instance
    const pos2_1 = fugue2.between(null, null);
    const pos2_2 = fugue2.after(pos2_1);
    const pos2_3 = fugue2.after(pos2_2);

    // Verify positions are exactly the same
    expect(pos1_1).toBe(pos2_1);
    expect(pos1_2).toBe(pos2_2);
    expect(pos1_3).toBe(pos2_3);
  });
});

describe("functions", () => {
  test("stringifyShortName", () => {
    expect(stringifyShortName(-1)).toBe("A");
    expect(stringifyShortName(0)).toBe("0");
    expect(stringifyShortName(1)).toBe("1");
    expect(stringifyShortName(10)).toBe("B0");
    expect(stringifyShortName(11)).toBe("B1");
    expect(stringifyShortName(15)).toBe("B5");
    expect(stringifyShortName(100)).toBe("K0");
    expect(stringifyShortName(101)).toBe("K1");
    expect(stringifyShortName(2222)).toBe("EO2");
  });

  test("stringifyBase52", () => {
    expect(stringifyBase52(0)).toBe("A");
    expect(stringifyBase52(1)).toBe("B");
    expect(stringifyBase52(10)).toBe("K");
    expect(stringifyBase52(100)).toBe("Bw");
    expect(stringifyBase52(101)).toBe("Bx");
    expect(stringifyBase52(2222)).toBe("qm");
    expect(stringifyBase52(55555555)).toBe("HfFkD");
  });

  test("nextOddValueSeq", () => {
    expect(nextOddValueSeq(0)).toBe(2);
    expect(nextOddValueSeq(1)).toBe(3);
    expect(nextOddValueSeq(2)).toBe(4);
    expect(nextOddValueSeq(3)).toBe(5);
    expect(nextOddValueSeq(4)).toBe(6);
    expect(nextOddValueSeq(5)).toBe(7);
    expect(nextOddValueSeq(52)).toBe(54);
    expect(nextOddValueSeq(52 * 52)).toBe(52 * 52 + 2);
    expect(nextOddValueSeq(Math.pow(52, 800))).toBe(Math.pow(52, 800) + 2);
  });

  test("parseBase52", () => {
    expect(parseBase52("A")).toBe(0);
    expect(parseBase52("B")).toBe(1);
    expect(parseBase52("K")).toBe(10);
    expect(parseBase52("B0")).toBe(35);
    expect(parseBase52("B1")).toBe(36);
    expect(parseBase52("B5")).toBe(40);
    expect(parseBase52("K0")).toBe(503);
    expect(parseBase52("K1")).toBe(504);
    expect(parseBase52("HfFkD")).toBe(55555555);
  });

  test("getPrefix", () => {
    expect(getPrefix("A")).toBe(null);
    expect(getPrefix(".C")).toBe(".");
    expect(getPrefix(".0")).toBe(".");
    expect(getPrefix(".00000")).toBe(".0000");
    expect(getPrefix(".999")).toBe(".99");
    expect(getPrefix("A.000")).toBe("A.00");
    expect(getPrefix("A.0.000")).toBe("A.0.00");
    expect(getPrefix("A.0.0")).toBe("A.0.");

    expect(getPrefix("longid.otherid")).toBe("longid.");
    expect(getPrefix("longid.otherid1.otherid2")).toBe("longid.otherid1.");
  });

  test("leftVersion", () => {
    expect(leftVersion("")).toBe("");
    expect(leftVersion("id.P")).toBe("id.O");
    expect(leftVersion("longid.otherid.H")).toBe("longid.otherid.G");
  });

  test("sanitizeClientID", () => {
    expect(sanitizeClientID("test")).toBe("test");
    expect(sanitizeClientID("test,bad.id")).toBe("testbadid");

    expect(sanitizeClientID("abcd123")).toBe("abcd123");

    expect(() => sanitizeClientID("")).toThrow();
    expect(() => sanitizeClientID(",")).toThrow();
    expect(() => sanitizeClientID("~~~~")).toThrow();
  });
});
