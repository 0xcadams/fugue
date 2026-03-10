import { describe, expect, test } from "vitest";
import {
  Fugue,
  FugueRun,
  InvalidBoundsError,
  InvalidPositionError,
  InvalidRandomSourceError,
  InvalidRunPrefixError,
  RunPrefixExhaustedError,
  SecureRandomUnavailableError,
  SlotExhaustedError,
  formatPosition,
  parsePosition,
  type FugueRandomBytes,
} from "../src";
import {
  ANCHOR_MAX,
  ANCHOR_MID,
  RUN_MAX,
  SLOT_MAX,
  SLOT_MID,
} from "../src/position";

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

function makePatternRandomBytes(pattern: readonly number[]): FugueRandomBytes {
  if (pattern.length === 0) {
    throw new RangeError("pattern must not be empty");
  }

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      out[i] = pattern[i % pattern.length]!;
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
  pathBetween(
    left: readonly bigint[],
    right: readonly bigint[],
    minValue: bigint,
    maxValue: bigint,
    maxDepth: number,
  ): bigint[] | null;
  randomPathAfter(
    left: readonly bigint[],
    minValue: bigint,
    maxValue: bigint,
    maxDepth: number,
  ): bigint[] | null;
  randomPathBefore(
    right: readonly bigint[],
    minValue: bigint,
    maxValue: bigint,
  ): bigint[] | null;
  getRunIdCandidate(
    anchorPath: readonly bigint[],
    minRunId: bigint,
    maxRunId: bigint,
  ): {
    anchorPath: readonly bigint[];
    minRunId: bigint;
    maxRunId: bigint;
    span: bigint;
  } | null;
  pickRunIdCandidate(
    candidates: readonly {
      anchorPath: readonly bigint[];
      minRunId: bigint;
      maxRunId: bigint;
      span: bigint;
    }[],
  ): {
    anchorPath: readonly bigint[];
    minRunId: bigint;
    maxRunId: bigint;
    span: bigint;
  };
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

describe("fugue", () => {
  test("basic ordering with before/after/between", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(1) });

    const first = fugue.first();
    const second = fugue.after(first);
    const middle = fugue.between(first, second);
    const beforeFirst = fugue.before(first);

    expect(beforeFirst < first).toBe(true);
    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);

    expect(parsePosition(first)).toEqual({
      anchorPath: [ANCHOR_MID],
      runId: parsePosition(first).runId,
      slotPath: [SLOT_MID],
    });
    expect(parsePosition(second).slotPath).toEqual([SLOT_MID]);
    expect(parsePosition(beforeFirst).slotPath).toEqual([SLOT_MID]);
  });

  test("between in same run picks a randomized slot path inside the gap", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(2) });

    const left = formatPosition({
      anchorPath: [50n],
      runId: 99n,
      slotPath: [1000n],
    });
    const right = formatPosition({
      anchorPath: [50n],
      runId: 99n,
      slotPath: [2000n],
    });
    const middle = fugue.between(left, right);

    const parsed = parsePosition(middle);
    expect(parsed.anchorPath).toEqual([50n]);
    expect(parsed.runId).toBe(99n);
    expect(parsed.slotPath.length).toBe(1);
    expect(parsed.slotPath[0]! > 1000n).toBe(true);
    expect(parsed.slotPath[0]! < 2000n).toBe(true);
  });

  test("same-run inserts with identical bounds vary by RNG stream", () => {
    const left = formatPosition({
      anchorPath: [50n],
      runId: 99n,
      slotPath: [1000n],
    });
    const right = formatPosition({
      anchorPath: [50n],
      runId: 99n,
      slotPath: [2000n],
    });

    const a = new Fugue({ randomBytes: makePatternRandomBytes([0, 0]) });
    const b = new Fugue({ randomBytes: makePatternRandomBytes([0, 1]) });

    const insertedA = a.between(left, right);
    const insertedB = b.between(left, right);

    expect(left < insertedA && insertedA < right).toBe(true);
    expect(left < insertedB && insertedB < right).toBe(true);
    expect(insertedA === insertedB).toBe(false);
  });

  test("same-run adjacent inserts deepen the slot path", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(3) });

    const left = formatPosition({
      anchorPath: [1n],
      runId: 1n,
      slotPath: [10n],
    });
    const right = formatPosition({
      anchorPath: [1n],
      runId: 1n,
      slotPath: [11n],
    });
    const inserted = fugue.between(left, right);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);

    const parsed = parsePosition(inserted);
    expect(parsed.anchorPath).toEqual([1n]);
    expect(parsed.runId).toBe(1n);
    expect(parsed.slotPath[0]).toBe(10n);
    expect(parsed.slotPath.length).toBeGreaterThan(1);
  });

  test("same-run prefix-vs-zero-descendant can be truly exhausted", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(4) });

    const left = formatPosition({
      anchorPath: [1n],
      runId: 1n,
      slotPath: [10n],
    });
    const right = formatPosition({
      anchorPath: [1n],
      runId: 1n,
      slotPath: [10n, 0n],
    });

    expect(() => fugue.between(left, right)).toThrow(SlotExhaustedError);
  });

  test("same-run prefix to deeper zero-tail still has space when tail continues", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(5) });

    const left = formatPosition({
      anchorPath: [3n],
      runId: 4n,
      slotPath: [10n],
    });
    const right = formatPosition({
      anchorPath: [3n],
      runId: 4n,
      slotPath: [10n, 0n, 5n],
    });
    const inserted = fugue.between(left, right);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);
    expect(parsePosition(inserted).slotPath[0]).toBe(10n);
  });

  test("startRun creates contiguous run blocks", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(6) });

    const left = fugue.first();
    const right = fugue.after(left);

    const runA = fugue.startRun(left, right);
    const runB = fugue.startRun(left, right);

    const keys = [
      { key: runA.next(), label: "A" },
      { key: runA.next(), label: "A" },
      { key: runA.next(), label: "A" },
      { key: runB.next(), label: "B" },
      { key: runB.next(), label: "B" },
      { key: runB.next(), label: "B" },
    ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const labels = keys.map((entry) => entry.label);
    expect(hasSingleRunTransition(labels)).toBe(true);
  });

  test("run next keeps shared prefix and deepens after max segment", () => {
    const run = new FugueRun([222n], 333n, [SLOT_MAX - 1n]);

    const first = run.next();
    const second = run.next();
    const third = run.next();

    expect(parsePosition(first)).toMatchObject({
      anchorPath: [222n],
      runId: 333n,
      slotPath: [SLOT_MAX - 1n],
    });
    expect(parsePosition(second)).toMatchObject({
      anchorPath: [222n],
      runId: 333n,
      slotPath: [SLOT_MAX],
    });
    expect(parsePosition(third)).toMatchObject({
      anchorPath: [222n],
      runId: 333n,
      slotPath: [SLOT_MAX, SLOT_MID],
    });
  });

  test("run next still exhausts at the slot-path depth cap", () => {
    const run = new FugueRun(
      [1n],
      2n,
      Array.from({ length: 64 }, () => SLOT_MAX),
    );

    run.next();
    expect(() => run.next()).toThrow(SlotExhaustedError);
  });

  test("startRun rejects same-run boundaries", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(7) });

    const left = formatPosition({
      anchorPath: [8n],
      runId: 9n,
      slotPath: [100n],
    });
    const right = formatPosition({
      anchorPath: [8n],
      runId: 9n,
      slotPath: [200n],
    });

    expect(() => fugue.startRun(left, right)).toThrow(RunPrefixExhaustedError);
  });

  test("custom randomBytes enables deterministic generation", () => {
    const a = new Fugue({ randomBytes: makeDeterministicRandomBytes(8) });
    const b = new Fugue({ randomBytes: makeDeterministicRandomBytes(8) });

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
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(9) });
    const first = fugue.first();
    const second = fugue.after(first);

    const beforeRun = fugue.startRunBefore(first);
    const afterRun = fugue.startRunAfter(second);

    expect(beforeRun.next() < first).toBe(true);
    expect(second < afterRun.next()).toBe(true);
  });

  test("run constructor validates public inputs", () => {
    expect(() => new FugueRun([], 1n)).toThrow(InvalidRunPrefixError);
    expect(() => new FugueRun([1n], -1n)).toThrow(InvalidRunPrefixError);
    expect(() => new FugueRun([1n], 1n, [])).toThrow(InvalidPositionError);
    expect(() => new FugueRun([1n], 1n, [-1n])).toThrow(InvalidPositionError);
  });

  test("between validates ordering across runId and path forms", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(10) });

    const higherRunId = formatPosition({
      anchorPath: [20n],
      runId: 9n,
      slotPath: [1n],
    });
    const lowerRunId = formatPosition({
      anchorPath: [20n],
      runId: 8n,
      slotPath: [9n],
    });
    expect(() => fugue.between(higherRunId, lowerRunId)).toThrow(
      InvalidBoundsError,
    );

    const longerAnchorPath = formatPosition({
      anchorPath: [20n, 1n],
      runId: 7n,
      slotPath: [5n],
    });
    const shorterAnchorPath = formatPosition({
      anchorPath: [20n],
      runId: 8n,
      slotPath: [5n],
    });
    expect(() => fugue.between(longerAnchorPath, shorterAnchorPath)).toThrow(
      InvalidBoundsError,
    );

    const longerSlotPath = formatPosition({
      anchorPath: [20n],
      runId: 7n,
      slotPath: [5n, 1n],
    });
    const shorterSlotPrefix = formatPosition({
      anchorPath: [20n],
      runId: 7n,
      slotPath: [5n],
    });
    expect(() => fugue.between(longerSlotPath, shorterSlotPrefix)).toThrow(
      InvalidBoundsError,
    );

    expect(() => fugue.between(shorterSlotPrefix, shorterSlotPrefix)).toThrow(
      InvalidBoundsError,
    );
  });

  test("same-anchorPath single-candidate runId path is deterministic", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(11) });

    const left = formatPosition({
      anchorPath: [10n],
      runId: 1n,
      slotPath: [100n],
    });
    const right = formatPosition({
      anchorPath: [10n],
      runId: 3n,
      slotPath: [200n],
    });
    const inserted = fugue.between(left, right);

    expect(parsePosition(inserted).runId).toBe(2n);
  });

  test("adjacent anchor paths deepen instead of exhausting", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(12) });

    const left = formatPosition({
      anchorPath: [10n],
      runId: RUN_MAX,
      slotPath: [100n],
    });
    const right = formatPosition({
      anchorPath: [11n],
      runId: 0n,
      slotPath: [200n],
    });
    const inserted = fugue.between(left, right);
    const parsed = parsePosition(inserted);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);
    expect(parsed.anchorPath[0]).toBe(10n);
    expect(parsed.anchorPath.length).toBeGreaterThan(1);
  });

  test("impossible anchor-path gaps can pack under either neighboring path", () => {
    const oneCandidate = new Fugue({
      randomBytes: makeDeterministicRandomBytes(121),
    });

    const leftNoRunSpace = formatPosition({
      anchorPath: [10n],
      runId: RUN_MAX,
      slotPath: [100n],
    });
    const rightHasRunSpace = formatPosition({
      anchorPath: [10n, 0n],
      runId: 5n,
      slotPath: [200n],
    });
    const packedRight = oneCandidate.between(leftNoRunSpace, rightHasRunSpace);
    const parsedPackedRight = parsePosition(packedRight);
    expect(leftNoRunSpace < packedRight).toBe(true);
    expect(packedRight < rightHasRunSpace).toBe(true);
    expect(parsedPackedRight.anchorPath).toEqual([10n, 0n]);
    expect(parsedPackedRight.runId < 5n).toBe(true);

    const twoCandidates = new Fugue({
      randomBytes: makeDeterministicRandomBytes(122),
    });
    const leftHasRunSpace = formatPosition({
      anchorPath: [10n],
      runId: 1n,
      slotPath: [100n],
    });
    const packedEither = twoCandidates.between(
      leftHasRunSpace,
      rightHasRunSpace,
    );
    const parsedPackedEither = parsePosition(packedEither);
    expect(leftHasRunSpace < packedEither).toBe(true);
    expect(packedEither < rightHasRunSpace).toBe(true);
    const packedAnchorPath = parsedPackedEither.anchorPath.join("~");
    expect(packedAnchorPath === "10" || packedAnchorPath === "10~0").toBe(true);
  });

  test("same-anchorPath adjacent runIds can truly exhaust", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(13) });

    const left = formatPosition({
      anchorPath: [10n],
      runId: 1n,
      slotPath: [100n],
    });
    const right = formatPosition({
      anchorPath: [10n],
      runId: 2n,
      slotPath: [200n],
    });

    expect(() => fugue.between(left, right)).toThrow(RunPrefixExhaustedError);
  });

  test("impossible anchor-path gaps can still fully exhaust", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(123) });

    const left = formatPosition({
      anchorPath: [10n],
      runId: RUN_MAX,
      slotPath: [100n],
    });
    const right = formatPosition({
      anchorPath: [10n, 0n],
      runId: 0n,
      slotPath: [200n],
    });

    expect(() => fugue.between(left, right)).toThrow(RunPrefixExhaustedError);
  });

  test("boundary fallback appends and prepends inside an existing run", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(14) });

    const left = formatPosition({
      anchorPath: Array.from({ length: 64 }, () => ANCHOR_MAX),
      runId: RUN_MAX,
      slotPath: [SLOT_MAX - 2n],
    });
    const appended = fugue.between(left, null);
    expect(left < appended).toBe(true);
    expect(parsePosition(appended).anchorPath).toEqual(
      parsePosition(left).anchorPath,
    );
    expect(parsePosition(appended).runId).toBe(RUN_MAX);

    const right = formatPosition({
      anchorPath: [0n],
      runId: 0n,
      slotPath: [2n],
    });
    const prepended = fugue.between(null, right);
    expect(prepended < right).toBe(true);
    expect(parsePosition(prepended).anchorPath).toEqual([0n]);
    expect(parsePosition(prepended).runId).toBe(0n);
  });

  test("open edges can reuse the same anchorPath via runId when path space is exhausted", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(141) });

    const afterLeft = formatPosition({
      anchorPath: Array.from({ length: 64 }, () => ANCHOR_MAX),
      runId: RUN_MAX - 2n,
      slotPath: [10n],
    });
    const insertedAfterLeft = fugue.between(afterLeft, null);
    const parsedAfterLeft = parsePosition(insertedAfterLeft);
    expect(afterLeft < insertedAfterLeft).toBe(true);
    expect(parsedAfterLeft.anchorPath).toEqual(
      parsePosition(afterLeft).anchorPath,
    );
    expect(parsedAfterLeft.runId > RUN_MAX - 2n).toBe(true);

    const beforeRight = formatPosition({
      anchorPath: [0n],
      runId: 2n,
      slotPath: [10n],
    });
    const insertedBeforeRight = fugue.between(null, beforeRight);
    const parsedBeforeRight = parsePosition(insertedBeforeRight);
    expect(insertedBeforeRight < beforeRight).toBe(true);
    expect(parsedBeforeRight.anchorPath).toEqual([0n]);
    expect(parsedBeforeRight.runId < 2n).toBe(true);
  });

  test("boundary fallback can still exhaust when no slot exists", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(15) });

    const right = formatPosition({
      anchorPath: [0n],
      runId: 0n,
      slotPath: [0n],
    });

    expect(() => fugue.between(null, right)).toThrow(SlotExhaustedError);
  });

  test("same-run fallback can exhaust after the maximal slot path", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(151) });

    const left = formatPosition({
      anchorPath: Array.from({ length: 64 }, () => ANCHOR_MAX),
      runId: RUN_MAX,
      slotPath: Array.from({ length: 64 }, () => SLOT_MAX),
    });

    expect(() => fugue.between(left, null)).toThrow(SlotExhaustedError);
  });

  test("prepend fallback handles all-zero deep slot paths", () => {
    const fugue = new Fugue({ randomBytes: makePatternRandomBytes([0]) });

    const right = formatPosition({
      anchorPath: [0n],
      runId: 0n,
      slotPath: [0n, 0n],
    });
    const inserted = fugue.between(null, right);

    expect(inserted < right).toBe(true);
    expect(parsePosition(inserted).slotPath[0]).toBe(0n);
  });

  test("internal path helpers cover packing and exhaustion branches", () => {
    const fugue = new Fugue({ randomBytes: makePatternRandomBytes([0]) });
    const internals = fugue as unknown as FugueInternals;

    expect(internals.pathBetween([1n], [2n], 0n, 10n, 1)).toBeNull();
    expect(internals.pathBetween([5n], [5n, 1n], 0n, 10n, 1)).toBeNull();
    expect(internals.pathBetween([5n], [5n, 0n, 1n], 0n, 10n, 1)).toBeNull();
    expect(internals.pathBetween([5n], [5n, 0n, 1n], 0n, 10n, 2)).toEqual([
      5n,
      0n,
    ]);
    expect(internals.pathBetween([10n, 10n], [11n], 0n, 10n, 1)).toBeNull();
    expect(internals.pathBetween([5n, 5n], [5n, 7n], 0n, 10n, 1)).toBeNull();
    expect(internals.pathBetween([5n, 5n], [5n, 6n], 0n, 10n, 1)).toBeNull();
    expect(
      internals.pathBetween([5n, 5n], [5n, 5n, 1n], 0n, 10n, 1),
    ).toBeNull();
    expect(internals.randomPathAfter([10n, 10n], 0n, 10n, 1)).toBeNull();
    expect(internals.randomPathBefore([], 0n, 10n)).toBeNull();
    expect(internals.randomPathBefore([0n, 0n], 0n, 10n)).toEqual([0n]);

    expect(internals.getRunIdCandidate([1n], 5n, 4n)).toBeNull();
    const singleCandidate = internals.getRunIdCandidate([1n], 5n, 5n);
    expect(singleCandidate).toEqual({
      anchorPath: [1n],
      minRunId: 5n,
      maxRunId: 5n,
      span: 1n,
    });
    expect(internals.pickRunIdCandidate([singleCandidate!])).toEqual(
      singleCandidate,
    );

    const picked = internals.pickRunIdCandidate([
      { anchorPath: [1n], minRunId: 1n, maxRunId: 2n, span: 2n },
      { anchorPath: [2n], minRunId: 1n, maxRunId: 3n, span: 3n },
    ]);
    expect(picked.anchorPath).toEqual([1n]);
  });

  test("random source validation and private error paths", () => {
    const badRandom = new Fugue({
      randomBytes: () => new Uint8Array(0),
    });
    expect(() => badRandom.first()).toThrow(InvalidRandomSourceError);

    const internals = badRandom as unknown as FugueInternals;
    expect(() => internals.randomBelow(0n)).toThrow(InvalidRandomSourceError);
    expect(() => internals.randomBetween(5n, 4n)).toThrow(
      InvalidRandomSourceError,
    );
    expect(() => internals.defaultRandomBytes(0)).toThrow(
      InvalidRandomSourceError,
    );
  });

  test("randomBelow fails fast for pathological rejection patterns", () => {
    const stuckRandom = new Fugue({
      randomBytes: makePatternRandomBytes([0xff]),
    });
    const internals = stuckRandom as unknown as FugueInternals;

    expect(() => internals.randomBelow(3n)).toThrow(InvalidRandomSourceError);
    expect(() => internals.randomBelow(3n)).toThrow(
      /failed to produce a sample < 3 after/i,
    );
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
      const insecure = new Fugue({
        allowInsecureRandom: true,
      });
      const insecureInternals = insecure as unknown as FugueInternals;

      const bytes1 = insecureInternals.defaultRandomBytes(8);
      const bytes2 = insecureInternals.defaultRandomBytes(8);

      expect(bytes1.length).toBe(8);
      expect(bytes2.length).toBe(8);

      const secureRequired = new Fugue();
      const secureInternals = secureRequired as unknown as FugueInternals;
      expect(() => secureInternals.defaultRandomBytes(8)).toThrow(
        SecureRandomUnavailableError,
      );
    });
  });
});
