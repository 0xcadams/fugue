import { describe, expect, test, vi } from "vitest";
import {
  ANCHOR_WIDTH,
  RUN_WIDTH,
  SLOT_MAX,
  SLOT_MID,
  SLOT_WIDTH,
  Fugue,
  FugueRun,
  RunPrefixExhaustedError,
  SecureRandomUnavailableError,
  SlotExhaustedError,
  decode62,
  encode62,
  formatPosition,
  formatRunPrefix,
  getRunPrefix,
  isFuguePosition,
  parsePosition,
  parseRunPrefix,
  type FugueRandomBytes,
} from "../src";

function makeDeterministicRandomBytes(seed: number): FugueRandomBytes {
  let state = seed >>> 0;

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      out[i] = state & 0xff;
    }
    return out;
  };
}

function hasSingleRunTransition(labels: string[]) {
  if (labels.length <= 1) {
    return true;
  }

  let transitions = 0;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] !== labels[i - 1]) {
      transitions++;
    }
  }

  return transitions <= 1;
}

type FugueInternals = {
  randomBelow(limit: bigint): bigint;
  randomBetween(minInclusive: bigint, maxInclusive: bigint): bigint;
  defaultRandomBytes(byteLength: number): Uint8Array;
};

function withMockedCrypto(value: Crypto | undefined, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  if (descriptor === undefined || descriptor.configurable !== true) {
    return;
  }

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    writable: true,
    value,
  });

  try {
    fn();
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
}

describe("base62", () => {
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
    expect(() => encode62(62n ** 3n, 3)).toThrow();
  });

  test("encode62/decode62 validate inputs", () => {
    expect(() => encode62(10n, 0)).toThrow(RangeError);
    expect(() => encode62(-1n, 2)).toThrow(RangeError);
    expect(() => decode62("A!")).toThrow();
  });
});

describe("position parsing", () => {
  test("formatPosition/parsePosition roundtrip", () => {
    const input = {
      anchor: 123456789n,
      runId: 987654321n,
      slot: SLOT_MID + 123n,
    };

    const position = formatPosition(input);
    expect(position.length).toBe(ANCHOR_WIDTH + RUN_WIDTH + SLOT_WIDTH + 2);
    expect(isFuguePosition(position)).toBe(true);

    const parsed = parsePosition(position);
    expect(parsed).toEqual(input);
  });

  test("formatPosition/parsePosition roundtrip with subslots", () => {
    const input = {
      anchor: 987654321n,
      runId: 123456789n,
      slot: SLOT_MID,
      subslots: [11n, SLOT_MID + 9n],
    };

    const position = formatPosition(input);
    expect(isFuguePosition(position)).toBe(true);
    expect(parsePosition(position)).toEqual(input);
  });

  test("run prefix parsing", () => {
    const prefix = formatRunPrefix(77n, 88n);
    expect(parseRunPrefix(prefix)).toEqual({ anchor: 77n, runId: 88n });
  });

  test("invalid position strings are rejected", () => {
    expect(isFuguePosition("not-a-position")).toBe(false);
    expect(() => parsePosition("not-a-position")).toThrow();
  });

  test("parsePosition validates separators and ranges", () => {
    const validAnchor = encode62(1n, ANCHOR_WIDTH);
    const validRun = encode62(2n, RUN_WIDTH);
    const validSlot = encode62(3n, SLOT_WIDTH);

    const badSeparator = `${validAnchor}.${validRun}!${validSlot}`;
    expect(isFuguePosition(badSeparator)).toBe(false);
    expect(() => parsePosition(badSeparator)).toThrow();

    const tooLargeAnchor = `${encode62(1n << 64n, ANCHOR_WIDTH)}!${validRun}!${validSlot}`;
    expect(isFuguePosition(tooLargeAnchor)).toBe(false);
    expect(() => parsePosition(tooLargeAnchor)).toThrow();

    const badSubslotWidth = `${validAnchor}!${validRun}!${validSlot}!abc`;
    expect(isFuguePosition(badSubslotWidth)).toBe(false);
    expect(() => parsePosition(badSubslotWidth)).toThrow();

    const invalidRunChars = `${validAnchor}!${"@".repeat(RUN_WIDTH)}!${validSlot}`;
    expect(isFuguePosition(invalidRunChars)).toBe(false);
    expect(() => parsePosition(invalidRunChars)).toThrow();

    const invalidSlotChars = `${validAnchor}!${validRun}!${"@".repeat(SLOT_WIDTH)}`;
    expect(isFuguePosition(invalidSlotChars)).toBe(false);
    expect(() => parsePosition(invalidSlotChars)).toThrow();

    const invalidSubslotChars = `${validAnchor}!${validRun}!${validSlot}!${"@".repeat(SLOT_WIDTH)}`;
    expect(isFuguePosition(invalidSubslotChars)).toBe(false);
    expect(() => parsePosition(invalidSubslotChars)).toThrow();
  });

  test("parseRunPrefix validates format", () => {
    expect(() => parseRunPrefix("abc")).toThrow();
    expect(() => parseRunPrefix("abc!!")).toThrow();
    expect(() => parseRunPrefix("a!b!c!")).toThrow();

    const invalidRangePrefix = `${encode62(1n << 64n, ANCHOR_WIDTH)}!${encode62(0n, RUN_WIDTH)}!`;
    expect(() => parseRunPrefix(invalidRangePrefix)).toThrow();
  });

  test("formatPosition validates field ranges", () => {
    expect(() => formatPosition({ anchor: -1n, runId: 0n, slot: 0n })).toThrow(
      RangeError,
    );
    expect(() =>
      formatPosition({ anchor: 0n, runId: 1n << 96n, slot: 0n }),
    ).toThrow(RangeError);
    expect(() => formatPosition({ anchor: 0n, runId: 0n, slot: -1n })).toThrow(
      RangeError,
    );
  });
});

describe("fugue", () => {
  test("basic ordering with before/after/between", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(1) });

    const first = fugue.first();
    const second = fugue.after(first);
    const middle = fugue.between(first, second);
    const beforeFirst = fugue.before(first);

    expect(Fugue.FIRST < beforeFirst).toBe(true);
    expect(beforeFirst < first).toBe(true);
    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
    expect(second < Fugue.LAST).toBe(true);

    expect(first).toMatchInlineSnapshot(
      `"AzL8n0Y58m7!0DHgRSMYf32zxWYdj!AzL8n0Y58m8"`,
    );
    expect(second).toMatchInlineSnapshot(
      `"GU0iBVp7iAB!0topbVAhDosEujAgZ!AzL8n0Y58m8"`,
    );
    expect(middle).toMatchInlineSnapshot(
      `"DjfvUGBbQT9!1ZT98vOleX0RHtryW!AzL8n0Y58m8"`,
    );
    expect(beforeFirst).toMatchInlineSnapshot(
      `"5UfZOVH2ZO3!1cynvthfN0t8wKym4!AzL8n0Y58m8"`,
    );
  });

  test("between in same run uses slot midpoint", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(2) });

    const left = formatPosition({ anchor: 50n, runId: 99n, slot: 1000n });
    const right = formatPosition({ anchor: 50n, runId: 99n, slot: 2000n });
    const middle = fugue.between(left, right);

    const parsed = parsePosition(middle);
    expect(parsed.anchor).toBe(50n);
    expect(parsed.runId).toBe(99n);
    expect(parsed.slot).toBe(1500n);
  });

  test("same-run adjacent slots use escape-hatch subslot", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(3) });

    const left = formatPosition({ anchor: 1n, runId: 1n, slot: 10n });
    const right = formatPosition({ anchor: 1n, runId: 1n, slot: 11n });
    const inserted = fugue.between(left, right);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);

    const parsed = parsePosition(inserted);
    expect(parsed.anchor).toBe(1n);
    expect(parsed.runId).toBe(1n);
    expect(parsed.slot).toBe(10n);
    expect(parsed.subslots).toEqual([SLOT_MID]);
  });

  test("same-run escape-hatch can recurse deeper", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(13) });

    const left = formatPosition({
      anchor: 1n,
      runId: 1n,
      slot: 10n,
      subslots: [50n],
    });
    const right = formatPosition({
      anchor: 1n,
      runId: 1n,
      slot: 10n,
      subslots: [51n],
    });
    const inserted = fugue.between(left, right);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);

    const parsed = parsePosition(inserted);
    expect(parsed.slot).toBe(10n);
    expect(parsed.subslots).toEqual([50n, SLOT_MID]);
  });

  test("same-run prefix-vs-zero-descendant can be truly exhausted", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(14) });

    const left = formatPosition({ anchor: 1n, runId: 1n, slot: 10n });
    const right = formatPosition({
      anchor: 1n,
      runId: 1n,
      slot: 10n,
      subslots: [0n],
    });

    expect(() => fugue.between(left, right)).toThrow(SlotExhaustedError);
  });

  test("startRun creates contiguous run blocks", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(4) });

    const left = fugue.first();
    const right = fugue.after(left);

    const runA = fugue.startRun(left, right);
    const runB = fugue.startRun(left, right);

    const keys = [
      { key: runA.first, label: "A" },
      { key: runA.append(), label: "A" },
      { key: runA.append(), label: "A" },
      { key: runB.first, label: "B" },
      { key: runB.append(), label: "B" },
      { key: runB.append(), label: "B" },
    ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const labels = keys.map((entry) => entry.label);
    expect(hasSingleRunTransition(labels)).toBe(true);
  });

  test("run append/prepend keep shared prefix", () => {
    const run = new FugueRun(222n, 333n, 10n);

    const first = run.first;
    const next = run.append();
    const prev = run.prepend();

    expect(getRunPrefix(first)).toBe(getRunPrefix(next));
    expect(getRunPrefix(first)).toBe(getRunPrefix(prev));

    expect(parsePosition(next).slot).toBe(parsePosition(first).slot + 10n);
    expect(parsePosition(prev).slot).toBe(parsePosition(first).slot - 10n);
  });

  test("startRun rejects same-run boundaries", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(5) });

    const left = formatPosition({ anchor: 8n, runId: 9n, slot: 100n });
    const right = formatPosition({ anchor: 8n, runId: 9n, slot: 200n });

    expect(() => fugue.startRun(left, right)).toThrow(RunPrefixExhaustedError);
  });

  test("legacy constructor signature is accepted", () => {
    const warnings: string[] = [];

    const fugue = new Fugue("legacy-client", {
      randomBytes: makeDeterministicRandomBytes(6),
      onWarning: (message: string) => {
        warnings.push(message);
      },
    });

    expect(fugue.first()).toBeTruthy();
    expect(warnings.length).toBe(1);
  });

  test("custom randomBytes enables deterministic generation", () => {
    const a = new Fugue({ randomBytes: makeDeterministicRandomBytes(7) });
    const b = new Fugue({ randomBytes: makeDeterministicRandomBytes(7) });

    const a1 = a.first();
    const a2 = a.after(a1);
    const a3 = a.after(a2);

    const b1 = b.first();
    const b2 = b.after(b1);
    const b3 = b.after(b2);

    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
    expect(a3).toBe(b3);
  });

  test("startRunAfter/startRunBefore wrappers work", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(8) });
    const first = fugue.first();
    const second = fugue.after(first);

    const beforeRun = fugue.startRunBefore(first);
    const afterRun = fugue.startRunAfter(second);

    expect(beforeRun.first < first).toBe(true);
    expect(second < afterRun.first).toBe(true);
  });

  test("default warning path is used for legacy constructor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      new Fugue("legacy-with-default-warning");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("constructor and run validate slot step", () => {
    expect(() => new Fugue({ slotStep: 0n })).toThrow(RangeError);
    expect(() => new Fugue({ slotStep: SLOT_MAX + 1n })).toThrow(RangeError);
    expect(() => new FugueRun(1n, 1n, 0n)).toThrow(RangeError);
  });

  test("run append/prepend exhaustion paths", () => {
    const appendRun = new FugueRun(1n, 1n, SLOT_MAX, SLOT_MAX);
    expect(() => appendRun.append()).toThrow(SlotExhaustedError);

    const prependRun = new FugueRun(1n, 1n, SLOT_MAX, 0n);
    expect(() => prependRun.prepend()).toThrow(SlotExhaustedError);
  });

  test("between validates bound ordering and special sentinels", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(9) });

    const first = fugue.first();
    const second = fugue.after(first);

    expect(() => fugue.between(second, first)).toThrow(RangeError);
    expect(() => fugue.between(Fugue.LAST, null)).toThrow();
    expect(() => fugue.between(null, Fugue.FIRST)).toThrow();

    const inBounds = fugue.between(Fugue.FIRST, Fugue.LAST);
    expect(inBounds > Fugue.FIRST && inBounds < Fugue.LAST).toBe(true);
  });

  test("between validates ordering across runId and slot-path forms", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(15) });

    const higherRunId = formatPosition({ anchor: 20n, runId: 9n, slot: 1n });
    const lowerRunId = formatPosition({ anchor: 20n, runId: 8n, slot: 9n });
    expect(() => fugue.between(higherRunId, lowerRunId)).toThrow(RangeError);

    const higherSlot = formatPosition({ anchor: 20n, runId: 7n, slot: 6n });
    const lowerSlot = formatPosition({ anchor: 20n, runId: 7n, slot: 5n });
    expect(() => fugue.between(higherSlot, lowerSlot)).toThrow(RangeError);

    const longerPath = formatPosition({
      anchor: 20n,
      runId: 7n,
      slot: 5n,
      subslots: [1n],
    });
    const shorterPrefix = formatPosition({ anchor: 20n, runId: 7n, slot: 5n });
    expect(() => fugue.between(longerPath, shorterPrefix)).toThrow(RangeError);

    expect(() => fugue.between(shorterPrefix, shorterPrefix)).toThrow(
      RangeError,
    );
  });

  test("deterministic single-candidate runId path", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(10) });

    const left = formatPosition({ anchor: 10n, runId: 1n, slot: 100n });
    const right = formatPosition({ anchor: 10n, runId: 3n, slot: 200n });
    const inserted = fugue.between(left, right);

    expect(parsePosition(inserted).runId).toBe(2n);
  });

  test("run-prefix exhaustion paths", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(11) });
    const anchorMax = (1n << 64n) - 1n;
    const runMax = (1n << 96n) - 1n;

    const leftNoSpace = formatPosition({ anchor: 0n, runId: 1n, slot: 100n });
    const rightNoSpace = formatPosition({ anchor: 0n, runId: 2n, slot: 200n });
    expect(() => fugue.between(leftNoSpace, rightNoSpace)).toThrow(
      RunPrefixExhaustedError,
    );

    const rightSentinelEqual = formatPosition({
      anchor: 0n,
      runId: 0n,
      slot: 5n,
    });
    const before = fugue.between(null, rightSentinelEqual);
    expect(before < rightSentinelEqual).toBe(true);

    const leftBoundaryExhausted = formatPosition({
      anchor: anchorMax - 1n,
      runId: runMax,
      slot: SLOT_MAX,
    });
    const afterLeftBoundary = fugue.between(leftBoundaryExhausted, null);
    expect(leftBoundaryExhausted < afterLeftBoundary).toBe(true);
    expect(parsePosition(afterLeftBoundary)).toEqual({
      anchor: anchorMax - 1n,
      runId: runMax,
      slot: SLOT_MAX,
      subslots: [SLOT_MID],
    });

    const rightBoundaryExhausted = formatPosition({
      anchor: 0n,
      runId: 1n,
      slot: 0n,
    });
    expect(() => fugue.between(null, rightBoundaryExhausted)).toThrow(
      SlotExhaustedError,
    );

    const rightBoundaryWithTail = formatPosition({
      anchor: 0n,
      runId: 1n,
      slot: 0n,
      subslots: [9n],
    });
    const beforeTail = fugue.between(null, rightBoundaryWithTail);
    expect(beforeTail < rightBoundaryWithTail).toBe(true);
    expect(parsePosition(beforeTail)).toEqual({
      anchor: 0n,
      runId: 1n,
      slot: 0n,
    });

    const leftBoundaryWithTail = formatPosition({
      anchor: anchorMax - 1n,
      runId: runMax,
      slot: SLOT_MAX,
      subslots: [9n],
    });
    const afterTail = fugue.between(leftBoundaryWithTail, null);
    expect(leftBoundaryWithTail < afterTail).toBe(true);
  });

  test("same-run between handles prefix and exhausted-level cases", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(16) });

    const leftPrefix = formatPosition({ anchor: 3n, runId: 4n, slot: 10n });
    const rightWithPositive = formatPosition({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [5n],
    });
    const betweenPositive = fugue.between(leftPrefix, rightWithPositive);
    expect(parsePosition(betweenPositive)).toEqual({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [2n],
    });

    const rightWithZeroTail = formatPosition({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [0n, 5n],
    });
    const betweenZeroTail = fugue.between(leftPrefix, rightWithZeroTail);
    expect(parsePosition(betweenZeroTail)).toEqual({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [0n],
    });

    const leftWithTail = formatPosition({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [9n],
    });
    const rightNextSlot = formatPosition({ anchor: 3n, runId: 4n, slot: 11n });
    const betweenTailAndNext = fugue.between(leftWithTail, rightNextSlot);
    expect(leftWithTail < betweenTailAndNext).toBe(true);
    expect(betweenTailAndNext < rightNextSlot).toBe(true);

    const leftWithMaxTail = formatPosition({
      anchor: 3n,
      runId: 4n,
      slot: 10n,
      subslots: [SLOT_MAX],
    });
    const betweenMaxTailAndNext = fugue.between(leftWithMaxTail, rightNextSlot);
    expect(leftWithMaxTail < betweenMaxTailAndNext).toBe(true);
    expect(betweenMaxTailAndNext < rightNextSlot).toBe(true);
  });

  test("boundary fallback appends/prepends inside existing run", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(12) });
    const anchorMax = (1n << 64n) - 1n;
    const runMax = (1n << 96n) - 1n;

    const left = formatPosition({
      anchor: anchorMax - 1n,
      runId: runMax,
      slot: SLOT_MAX - 2n,
    });
    const appended = fugue.between(left, null);
    expect(parsePosition(appended).slot).toBe(SLOT_MAX);

    const right = formatPosition({ anchor: 0n, runId: 1n, slot: 2n });
    const prepended = fugue.between(null, right);
    expect(parsePosition(prepended).slot).toBe(0n);
  });

  test("random source validation and private error paths", () => {
    const badRandom = new Fugue({
      randomBytes: () => new Uint8Array(0),
    });
    expect(() => badRandom.first()).toThrow(RangeError);

    const internals = badRandom as unknown as FugueInternals;
    expect(() => internals.randomBelow(0n)).toThrow(RangeError);
    expect(() => internals.randomBetween(5n, 4n)).toThrow(RangeError);
    expect(() => internals.defaultRandomBytes(0)).toThrow(RangeError);
  });

  test("default random bytes use crypto when available", () => {
    const fugue = new Fugue();
    const internals = fugue as unknown as FugueInternals;

    const bytes = internals.defaultRandomBytes(8);
    expect(bytes.length).toBe(8);
    expect(fugue.first()).toBeTruthy();
  });

  test("insecure random fallback and secure-random error", () => {
    withMockedCrypto(undefined, () => {
      const warnings: string[] = [];

      const insecure = new Fugue({
        allowInsecureRandom: true,
        onWarning: (message: string) => {
          warnings.push(message);
        },
      });
      const insecureInternals = insecure as unknown as FugueInternals;

      const bytes1 = insecureInternals.defaultRandomBytes(8);
      const bytes2 = insecureInternals.defaultRandomBytes(8);

      expect(bytes1.length).toBe(8);
      expect(bytes2.length).toBe(8);
      expect(warnings.length).toBe(1);

      const secureRequired = new Fugue();
      const secureInternals = secureRequired as unknown as FugueInternals;
      expect(() => secureInternals.defaultRandomBytes(8)).toThrow(
        SecureRandomUnavailableError,
      );
    });
  });
});
