import { describe, expect, test } from "vitest";
import {
  BurstSpaceExhaustedError,
  CoordSpaceExhaustedError,
  Fugue,
  isFuguePosition,
  type FuguePosition,
  type FugueRandomBytes,
} from "../src";

function makePRNG(seed: number) {
  let state = seed >>> 0;

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };

  const nextInt = (max: number) => Math.floor(next() * max);

  return {
    nextInt,
    pick<T>(items: readonly T[]) {
      return items[nextInt(items.length)]!;
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

function sortedInsert(values: FuguePosition[], value: FuguePosition) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid]! < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  values.splice(low, 0, value);
}

function verifySorted(values: readonly FuguePosition[]) {
  for (let index = 1; index < values.length; index++) {
    expect(values[index - 1]! < values[index]!).toBe(true);
  }
}

describe("fuzzing", () => {
  test("repeated concurrent inserts into one gap stay ordered and unique", () => {
    const base = new Fugue({
      randomBytes: makeDeterministicRandomBytes(0xabc000),
    });
    const left = base.first();
    const right = base.after(left);

    const clients = [
      new Fugue({ randomBytes: makeDeterministicRandomBytes(0xabc001) }),
      new Fugue({ randomBytes: makeDeterministicRandomBytes(0xabc002) }),
      new Fugue({ randomBytes: makeDeterministicRandomBytes(0xabc003) }),
      new Fugue({ randomBytes: makeDeterministicRandomBytes(0xabc004) }),
    ];

    const inserted: FuguePosition[] = [];

    for (let round = 0; round < 200; round++) {
      for (const client of clients) {
        const key = client.between(left, right);
        expect(left < key).toBe(true);
        expect(key < right).toBe(true);
        inserted.push(key);
      }
    }

    const sorted = [...inserted].sort();
    verifySorted(sorted);
    expect(new Set(inserted).size).toBe(inserted.length);
  });

  test("repeated inserts into one gap stay unique at 100k scale", () => {
    const fugue = new Fugue({
      randomBytes: makeDeterministicRandomBytes(0x7002),
    });
    const left = fugue.first();
    const right = fugue.after(left);
    const inserted: FuguePosition[] = [];

    for (let index = 0; index < 100_000; index++) {
      inserted.push(fugue.between(left, right));
    }

    expect(new Set(inserted).size).toBe(inserted.length);
  });

  test("mixed operations keep ordering and uniqueness", () => {
    const seeds = [0x1, 0x2a2a2a2a, 0x12345678, 0x7fffffff, 0xdeadbeef];
    const opsPerSeed = 2500;
    const maxPositions = 1500;

    for (const seed of seeds) {
      const opRng = makePRNG(seed);
      const clients = [
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x11) }),
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x22) }),
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x33) }),
      ];

      const positions: FuguePosition[] = [];
      const unique = new Set<FuguePosition>();

      const insert = (value: FuguePosition) => {
        expect(isFuguePosition(value)).toBe(true);
        expect(unique.has(value)).toBe(false);

        sortedInsert(positions, value);
        unique.add(value);
      };

      for (const client of clients) {
        const base = client.first();
        insert(base);
        insert(client.after(base));
        insert(client.before(base));
      }

      for (let index = 0; index < opsPerSeed; index++) {
        const client = opRng.pick(clients);
        const op = opRng.nextInt(5);

        try {
          switch (op) {
            case 0: {
              if (positions.length < 2) {
                break;
              }

              const gapIndex = opRng.nextInt(positions.length - 1);
              const left = positions[gapIndex]!;
              const right = positions[gapIndex + 1]!;
              insert(client.between(left, right));
              break;
            }

            case 1: {
              const first = positions[0]!;
              insert(client.before(first));
              break;
            }

            case 2: {
              const last = positions[positions.length - 1]!;
              insert(client.after(last));
              break;
            }

            case 3: {
              const last = positions[positions.length - 1]!;
              const burst = client.startBurst(last, null);
              insert(burst.next());
              insert(burst.next());
              insert(burst.next());
              break;
            }

            case 4: {
              if (positions.length < 2) {
                break;
              }

              const gapIndex = opRng.nextInt(positions.length - 1);
              const left = positions[gapIndex]!;
              const right = positions[gapIndex + 1]!;
              const burst = client.startBurst(left, right);
              insert(burst.next());
              insert(burst.next());
              break;
            }
          }
        } catch (error) {
          if (
            !(error instanceof BurstSpaceExhaustedError) &&
            !(error instanceof CoordSpaceExhaustedError)
          ) {
            throw error;
          }
        }

        if ((index & 63) === 63) {
          verifySorted(positions);
          expect(unique.size).toBe(positions.length);
        }

        if (positions.length > maxPositions) {
          const removeCount = Math.floor(positions.length * 0.25);
          for (let removeIndex = 0; removeIndex < removeCount; removeIndex++) {
            const indexToRemove = opRng.nextInt(positions.length);
            const removed = positions.splice(indexToRemove, 1)[0];
            if (removed !== undefined) {
              unique.delete(removed);
            }
          }
          verifySorted(positions);
          expect(unique.size).toBe(positions.length);
        }
      }

      verifySorted(positions);
      expect(unique.size).toBe(positions.length);
    }
  });
});
