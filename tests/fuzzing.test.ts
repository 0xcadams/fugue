import { describe, expect, test } from "vitest";
import {
  Fugue,
  RunPrefixExhaustedError,
  SlotExhaustedError,
  getRunPrefix,
  isFuguePosition,
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
    next,
    nextInt,
    pick<T>(items: T[]): T {
      return items[nextInt(items.length)]!;
    },
  };
}

function makeDeterministicRandomBytes(seed: number): FugueRandomBytes {
  const rng = makePRNG(seed);

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      out[i] = rng.nextInt(256);
    }
    return out;
  };
}

function sortedInsert(values: string[], value: string) {
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

function verifySorted(values: string[]) {
  for (let i = 1; i < values.length; i++) {
    expect(values[i - 1]! < values[i]!).toBe(true);
  }
}

describe("fuzzing", () => {
  test("mixed operations keep ordering and uniqueness", () => {
    const seeds = [0x1, 0x2a2a2a2a, 0x12345678, 0x7fffffff, 0xdeadbeef];
    const opsPerSeed = 4000;
    const maxPositions = 2500;

    for (const seed of seeds) {
      const opRng = makePRNG(seed);
      const clients = [
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x11) }),
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x22) }),
        new Fugue({ randomBytes: makeDeterministicRandomBytes(seed ^ 0x33) }),
      ];

      const positions: string[] = [];
      const unique = new Set<string>();

      const insert = (value: string) => {
        expect(isFuguePosition(value)).toBe(true);
        expect(value > Fugue.FIRST).toBe(true);
        expect(value < Fugue.LAST).toBe(true);
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

      for (let i = 0; i < opsPerSeed; i++) {
        const client = opRng.pick(clients);
        const op = opRng.nextInt(5);

        try {
          switch (op) {
            case 0: {
              if (positions.length < 2) {
                break;
              }

              const index = opRng.nextInt(positions.length - 1);
              const left = positions[index]!;
              const right = positions[index + 1]!;
              const inserted = client.between(left, right);

              expect(left < inserted).toBe(true);
              expect(inserted < right).toBe(true);
              insert(inserted);
              break;
            }

            case 1: {
              const first = positions[0]!;
              const inserted = client.before(first);

              expect(inserted < first).toBe(true);
              insert(inserted);
              break;
            }

            case 2: {
              const last = positions[positions.length - 1]!;
              const inserted = client.after(last);

              expect(last < inserted).toBe(true);
              insert(inserted);
              break;
            }

            case 3: {
              const last = positions[positions.length - 1]!;
              try {
                const run = client.startRun(last, null);

                const k1 = run.first;
                const k2 = run.append();
                const k3 = run.append();

                expect(last < k1).toBe(true);
                expect(k1 < k2).toBe(true);
                expect(k2 < k3).toBe(true);

                insert(k1);
                insert(k2);
                insert(k3);
              } catch (error) {
                if (!(error instanceof RunPrefixExhaustedError)) {
                  throw error;
                }

                const inserted = client.after(last);
                expect(last < inserted).toBe(true);
                insert(inserted);
              }
              break;
            }

            case 4: {
              if (positions.length < 2) {
                break;
              }

              const leftIndex = opRng.nextInt(positions.length - 1);
              const left = positions[leftIndex]!;
              const right = positions[leftIndex + 1]!;

              if (getRunPrefix(left) === getRunPrefix(right)) {
                const inserted = client.between(left, right);
                expect(left < inserted).toBe(true);
                expect(inserted < right).toBe(true);
                insert(inserted);
              } else {
                try {
                  const run = client.startRun(left, right);
                  const k1 = run.first;
                  const k2 = run.append();

                  expect(left < k1).toBe(true);
                  expect(k1 < k2).toBe(true);
                  expect(k2 < right).toBe(true);

                  insert(k1);
                  insert(k2);
                } catch (error) {
                  if (!(error instanceof RunPrefixExhaustedError)) {
                    throw error;
                  }

                  const inserted = client.between(left, right);
                  expect(left < inserted).toBe(true);
                  expect(inserted < right).toBe(true);
                  insert(inserted);
                }
              }
              break;
            }
          }
        } catch (error) {
          if (
            !(error instanceof RunPrefixExhaustedError) &&
            !(error instanceof SlotExhaustedError)
          ) {
            throw error;
          }
        }

        if ((i & 63) === 63) {
          verifySorted(positions);
          expect(unique.size).toBe(positions.length);
        }

        if (positions.length > maxPositions) {
          const removeCount = Math.floor(positions.length * 0.25);
          for (let j = 0; j < removeCount; j++) {
            const removeIndex = opRng.nextInt(positions.length);
            const removed = positions.splice(removeIndex, 1)[0];
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
