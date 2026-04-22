import { describe, expect, test } from "vitest";
import {
  BurstSpaceExhaustedError,
  CoordSpaceExhaustedError,
  Fugue,
  FugueBurst,
  InvalidBoundsError,
  InvalidPositionError,
  InvalidRandomSourceError,
  SecureRandomUnavailableError,
  type FuguePosition,
  type FugueRandomBytes,
} from "../src";
import {
  MAX_BURST_DEPTH,
  NESTED_COORD_MAX_RIGHT,
  NESTED_COORD_MID,
  NESTED_COORD_WIDTH,
  TOP_BURST_WIDTH,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  TOP_COORD_WIDTH,
  formatPosition,
  parsePosition,
  toLeftCoord,
} from "../src/position";

const FLAT_POSITION_LENGTH =
  TOP_COORD_WIDTH + TOP_BURST_WIDTH + NESTED_COORD_WIDTH + 2;

function makePRNG(seed: number) {
  let state = seed >>> 0;

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return {
    nextInt(max: number) {
      return next() % max;
    },
  };
}

function makeDeterministicRandomBytes(seed: number): FugueRandomBytes {
  const rng = makePRNG(seed);

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
      out[index] = rng.nextInt(256);
    }
    return out;
  };
}

function hasSingleTransition(labels: readonly string[]) {
  let transitions = 0;

  for (let index = 1; index < labels.length; index++) {
    if (labels[index] !== labels[index - 1]) {
      transitions++;
    }
  }

  return transitions <= 1;
}

describe("fugue", () => {
  test("first, before, and after stay ordered", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(1) });

    const middle = fugue.first();
    const before = fugue.before(middle);
    const after = fugue.after(middle);
    const parsedMiddle = parsePosition(middle);
    const parsedBefore = parsePosition(before);
    const parsedAfter = parsePosition(after);

    expect(before < middle).toBe(true);
    expect(middle < after).toBe(true);
    expect(parsedMiddle.bursts.length).toBe(1);
    expect(parsedBefore.bursts.length).toBe(1);
    expect(parsedAfter.bursts.length).toBe(1);
    expect(parsedBefore.coords[0]).toBeLessThan(parsedMiddle.coords[0]!);
    expect(parsedMiddle.coords[0]).toBeLessThan(parsedAfter.coords[0]!);
    expect(before.length).toBe(FLAT_POSITION_LENGTH);
    expect(middle.length).toBe(FLAT_POSITION_LENGTH);
    expect(after.length).toBe(FLAT_POSITION_LENGTH);
  });

  test("repeated edge inserts stay flat", () => {
    const appendFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(15),
    });
    let appended = appendFugue.first();

    for (let index = 0; index < 200; index++) {
      appended = appendFugue.after(appended);
      const parsed = parsePosition(appended);

      expect(parsed.bursts.length).toBe(1);
      expect(appended.length).toBe(FLAT_POSITION_LENGTH);
    }

    const prependFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(16),
    });
    let prepended = prependFugue.first();

    for (let index = 0; index < 200; index++) {
      prepended = prependFugue.before(prepended);
      const parsed = parsePosition(prepended);

      expect(parsed.bursts.length).toBe(1);
      expect(prepended.length).toBe(FLAT_POSITION_LENGTH);
    }

    const appendBetweenFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(17),
    });
    let appendedViaBetween = appendBetweenFugue.first();

    for (let index = 0; index < 200; index++) {
      appendedViaBetween = appendBetweenFugue.between(appendedViaBetween, null);
      const parsed = parsePosition(appendedViaBetween);

      expect(parsed.bursts.length).toBe(1);
      expect(appendedViaBetween.length).toBe(FLAT_POSITION_LENGTH);
    }

    const prependBetweenFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(18),
    });
    let prependedViaBetween = prependBetweenFugue.first();

    for (let index = 0; index < 200; index++) {
      prependedViaBetween = prependBetweenFugue.between(
        null,
        prependedViaBetween,
      );
      const parsed = parsePosition(prependedViaBetween);

      expect(parsed.bursts.length).toBe(1);
      expect(prependedViaBetween.length).toBe(FLAT_POSITION_LENGTH);
    }
  });

  test("between delegates edge inserts to the same fast paths as after and before", () => {
    const afterFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(19),
    });
    const betweenAfterFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(19),
    });
    const afterBase = afterFugue.first();
    const betweenAfterBase = betweenAfterFugue.first();

    expect(afterBase).toBe(betweenAfterBase);
    expect(afterFugue.after(afterBase)).toBe(
      betweenAfterFugue.between(betweenAfterBase, null),
    );

    const beforeFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(20),
    });
    const betweenBeforeFugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(20),
    });
    const beforeBase = beforeFugue.first();
    const betweenBeforeBase = betweenBeforeFugue.first();

    expect(beforeBase).toBe(betweenBeforeBase);
    expect(beforeFugue.before(beforeBase)).toBe(
      betweenBeforeFugue.between(null, betweenBeforeBase),
    );
  });

  test("between creates a fresh nested burst inside old text", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(2) });

    const burst = fugue.startBurst(null, null);
    const c = burst.next();
    const a = burst.next();
    const t = burst.next();

    const inserted = fugue.between(c, a);
    const parsedInserted = parsePosition(inserted);
    const parsedC = parsePosition(c);

    expect(c < inserted).toBe(true);
    expect(inserted < a).toBe(true);
    expect(a < t).toBe(true);
    expect(parsedInserted.bursts.length).toBe(parsedC.bursts.length + 1);
    expect(parsedInserted.coords[0]).toBe(parsedC.coords[0]);
  });

  test("startBurst can reopen a shallower middle gap when the left side is already deep", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(22) });
    const sharedBursts = [11n, 12n];
    const right = formatPosition({
      coords: [TOP_COORD_MID, NESTED_COORD_MID, NESTED_COORD_MID],
      bursts: sharedBursts,
    });
    const left = formatPosition({
      coords: [
        TOP_COORD_MID,
        NESTED_COORD_MID,
        toLeftCoord(NESTED_COORD_MID),
        ...Array.from(
          { length: MAX_BURST_DEPTH - sharedBursts.length },
          () => NESTED_COORD_MID,
        ),
      ],
      bursts: [
        ...sharedBursts,
        ...Array.from(
          { length: MAX_BURST_DEPTH - sharedBursts.length },
          (_, index) => BigInt(index + 100),
        ),
      ],
    });

    const inserted = fugue.startBurst(left, right).next();
    const parsedInserted = parsePosition(inserted);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);
    expect(parsedInserted.bursts.length).toBe(sharedBursts.length + 1);
  });

  test("startBurst can reuse a shared ancestor when sibling burst space exists", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(23) });
    const sharedBursts = [21n, 22n];
    const left = formatPosition({
      coords: [
        TOP_COORD_MID,
        NESTED_COORD_MID,
        NESTED_COORD_MID,
        ...Array.from(
          { length: MAX_BURST_DEPTH - sharedBursts.length },
          () => NESTED_COORD_MID,
        ),
      ],
      bursts: [
        ...sharedBursts,
        30n,
        ...Array.from(
          { length: MAX_BURST_DEPTH - sharedBursts.length - 1 },
          (_, index) => BigInt(index + 200),
        ),
      ],
    });
    const right = formatPosition({
      coords: [
        TOP_COORD_MID,
        NESTED_COORD_MID,
        NESTED_COORD_MID,
        NESTED_COORD_MID,
      ],
      bursts: [...sharedBursts, 40n],
    });

    const inserted = fugue.startBurst(left, right).next();
    const parsedInserted = parsePosition(inserted);

    expect(left < inserted).toBe(true);
    expect(inserted < right).toBe(true);
    expect(parsedInserted.bursts.length).toBe(sharedBursts.length + 1);
  });

  test("startBurst creates contiguous burst blocks", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(3) });

    const left = fugue.first();
    const right = fugue.after(left);

    const burstA = fugue.startBurst(left, right);
    const burstB = fugue.startBurst(left, right);

    const keys = [
      { key: burstA.next(), label: "A" },
      { key: burstA.next(), label: "A" },
      { key: burstA.next(), label: "A" },
      { key: burstB.next(), label: "B" },
      { key: burstB.next(), label: "B" },
      { key: burstB.next(), label: "B" },
    ].sort((leftEntry, rightEntry) => {
      return leftEntry.key < rightEntry.key
        ? -1
        : leftEntry.key > rightEntry.key
          ? 1
          : 0;
    });

    expect(hasSingleTransition(keys.map((entry) => entry.label))).toBe(true);
  });

  test("concurrent sibling bursts in the same gap do not braid", () => {
    const left = new Fugue({
      randomBytes: makeDeterministicRandomBytes(4),
    }).first();
    const right = new Fugue({
      randomBytes: makeDeterministicRandomBytes(5),
    }).after(left);

    const alice = new Fugue({ randomBytes: makeDeterministicRandomBytes(6) });
    const bob = new Fugue({ randomBytes: makeDeterministicRandomBytes(7) });

    const burstA = alice.startBurst(left, right);
    const burstB = bob.startBurst(left, right);

    const keys = [
      { key: burstA.next(), label: "A" },
      { key: burstA.next(), label: "A" },
      { key: burstB.next(), label: "B" },
      { key: burstB.next(), label: "B" },
    ].sort((leftEntry, rightEntry) => {
      return leftEntry.key < rightEntry.key
        ? -1
        : leftEntry.key > rightEntry.key
          ? 1
          : 0;
    });

    expect(hasSingleTransition(keys.map((entry) => entry.label))).toBe(true);
  });

  test("burst.next deepens under the same burst when local coord space fills", () => {
    const burst = new FugueBurst([TOP_COORD_MID], [7n]);
    const state = burst as unknown as {
      lastPosition: { coords: bigint[]; bursts: bigint[] };
    };
    state.lastPosition = {
      coords: [TOP_COORD_MID, NESTED_COORD_MAX_RIGHT],
      bursts: [7n],
    };

    const deepened = parsePosition(burst.next());
    expect(deepened.bursts).toEqual([7n, 7n]);
    expect(deepened.coords).toEqual([
      TOP_COORD_MID,
      NESTED_COORD_MAX_RIGHT,
      NESTED_COORD_MID,
    ]);
  });

  test("burst.next still exhausts at the burst depth cap", () => {
    const prefixCoords = [
      TOP_COORD_MID,
      ...Array.from({ length: MAX_BURST_DEPTH - 1 }, () => 1n),
    ];
    const prefixBursts = Array.from({ length: MAX_BURST_DEPTH }, () => 7n);
    const burst = new FugueBurst(prefixCoords, prefixBursts);
    const state = burst as unknown as {
      lastPosition: { coords: bigint[]; bursts: bigint[] };
    };
    state.lastPosition = {
      coords: [
        TOP_COORD_MID,
        ...Array.from(
          { length: MAX_BURST_DEPTH },
          () => NESTED_COORD_MAX_RIGHT,
        ),
      ],
      bursts: Array.from({ length: MAX_BURST_DEPTH }, () => 7n),
    };

    expect(() => burst.next()).toThrow(CoordSpaceExhaustedError);
  });

  test("startBurstAfter exhausts once top-level space is exhausted", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(8) });
    const position = formatPosition({
      coords: [
        TOP_COORD_MAX_RIGHT,
        ...Array.from({ length: MAX_BURST_DEPTH }, () => 1n),
      ],
      bursts: Array.from({ length: MAX_BURST_DEPTH }, () => 7n),
    });

    expect(() => fugue.startBurstAfter(position)).toThrow(
      BurstSpaceExhaustedError,
    );
  });

  test("startBurstBefore and startBurstAfter wrappers work", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(9) });
    const first = fugue.first();
    const second = fugue.after(first);

    const beforeBurst = fugue.startBurstBefore(first);
    const afterBurst = fugue.startBurstAfter(second);
    const beforePosition = beforeBurst.next();
    const afterPosition = afterBurst.next();

    expect(beforePosition < first).toBe(true);
    expect(second < afterPosition).toBe(true);
    expect(parsePosition(beforePosition).bursts.length).toBe(1);
    expect(parsePosition(afterPosition).bursts.length).toBe(1);
  });

  test("edge bursts only nest when top-level coord space is exhausted", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(21) });
    const maxTop = formatPosition({
      coords: [TOP_COORD_MAX_RIGHT, NESTED_COORD_MID],
      bursts: [7n],
    });
    const minTop = formatPosition({
      coords: [1n, NESTED_COORD_MID],
      bursts: [7n],
    });

    const afterMax = fugue.startBurstAfter(maxTop).next();
    const beforeMin = fugue.startBurstBefore(minTop).next();

    expect(maxTop < afterMax).toBe(true);
    expect(beforeMin < minTop).toBe(true);
    expect(parsePosition(afterMax).bursts.length).toBe(2);
    expect(parsePosition(beforeMin).bursts.length).toBe(2);
    expect(parsePosition(afterMax).coords[0]).toBe(TOP_COORD_MAX_RIGHT);
    expect(parsePosition(beforeMin).coords[0]).toBe(1n);
  });

  test("constructor validates burst prefixes", () => {
    expect(() => new FugueBurst([], [1n])).toThrow(InvalidPositionError);
    expect(() => new FugueBurst([TOP_COORD_MID], [])).toThrow(
      InvalidPositionError,
    );
    expect(() => new FugueBurst([], [])).toThrow(InvalidPositionError);
  });

  test("invalid bounds throw", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(10) });
    const first = fugue.first();
    const second = fugue.after(first);

    expect(() => fugue.startBurst(second, first)).toThrow(InvalidBoundsError);
    expect(() => fugue.between(second, first)).toThrow(InvalidBoundsError);
  });

  test("custom randomBytes enables deterministic generation", () => {
    const a = new Fugue({ randomBytes: makeDeterministicRandomBytes(11) });
    const b = new Fugue({ randomBytes: makeDeterministicRandomBytes(11) });

    expect(a.first()).toBe(b.first());
    expect(a.after(a.first())).toBe(b.after(b.first()));
  });

  test("randomBytes validates returned byte lengths", () => {
    const fugue = new Fugue({
      randomBytes: () => new Uint8Array(0),
    });

    expect(() => fugue.first()).toThrow(InvalidRandomSourceError);
  });

  test("random interval validation surfaces invalid RNG ranges", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(12) });
    const internals = fugue as unknown as {
      randomBelow(limit: bigint): bigint;
      randomBetween(minInclusive: bigint, maxInclusive: bigint): bigint;
      defaultRandomBytes(byteLength: number): Uint8Array;
    };

    expect(() => internals.randomBelow(0n)).toThrow(InvalidRandomSourceError);
    expect(internals.randomBelow(1n)).toBe(0n);
    expect(() => internals.randomBetween(2n, 1n)).toThrow(
      InvalidRandomSourceError,
    );
    expect(() => internals.defaultRandomBytes(0)).toThrow(
      InvalidRandomSourceError,
    );
  });

  test("default crypto-backed randomness works when available", () => {
    const position = new Fugue().first();
    expect(typeof position).toBe("string");
  });

  test("random rejection exhaustion surfaces invalid random sources", () => {
    const fugue = new Fugue({
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(0xff),
    });
    const internals = fugue as unknown as {
      randomBelow(limit: bigint): bigint;
    };

    expect(() => internals.randomBelow(3n)).toThrow(InvalidRandomSourceError);
  });

  test("missing crypto throws unless insecure mode is enabled", () => {
    const originalCrypto = globalThis.crypto;

    try {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });

      expect(() => new Fugue().first()).toThrow(SecureRandomUnavailableError);

      const insecure = new Fugue({ allowInsecureRandom: true });
      const position = insecure.first();
      expect(typeof position).toBe("string");
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  test("between returns size-1 bursts", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(13) });
    const first = fugue.first();
    const second = fugue.after(first);
    const inserted = fugue.between(first, second);

    expect(first < inserted).toBe(true);
    expect(inserted < second).toBe(true);
  });

  test("generated values keep the FuguePosition brand shape", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(14) });
    const position: FuguePosition = fugue.first();
    expect(position.includes("!")).toBe(true);
  });
});
