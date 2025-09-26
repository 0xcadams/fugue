import { describe, expect, test } from "vitest";
import { Fugue } from "../src";

describe("fuzzing", () => {
  test("random operations maintain ordering invariants", () => {
    const fugue = new Fugue("client1");
    const positions: string[] = [];
    const maxOperations = 30_000;

    // Helper to verify all positions are in sorted order
    const verifyOrdering = () => {
      for (let i = 0; i < positions.length - 1; i++) {
        expect(positions[i]! < positions[i + 1]!).toBe(true);
      }
    };

    // Helper to insert a position and maintain sorted order
    const insertPosition = (pos: string) => {
      // Find correct insertion point
      let insertIndex = 0;
      while (insertIndex < positions.length && positions[insertIndex]! < pos) {
        insertIndex++;
      }
      positions.splice(insertIndex, 0, pos);
    };

    // Start with a few initial positions
    positions.push(fugue.first());
    positions.push(fugue.after(positions[0]!));
    positions.push(fugue.before(positions[0]!));
    positions.sort(); // Ensure initial positions are sorted

    for (let i = 0; i < maxOperations; i++) {
      const operation = Math.floor(Math.random() * 4);

      try {
        let newPos: string;

        switch (operation) {
          case 0: {
            // Insert between two random positions
            if (positions.length >= 2) {
              const idx1 = Math.floor(Math.random() * positions.length);
              const idx2 = Math.floor(Math.random() * positions.length);
              const leftIdx = Math.min(idx1, idx2);
              const rightIdx = Math.max(idx1, idx2);

              if (leftIdx !== rightIdx) {
                const left = positions[leftIdx]!;
                const right = positions[rightIdx]!;
                newPos = fugue.between(left, right);

                // Verify the new position is correctly ordered
                expect(newPos > left).toBe(true);
                expect(newPos < right).toBe(true);

                insertPosition(newPos);
              }
            }
            break;
          }

          case 1: {
            // Insert after a random position
            if (positions.length > 0) {
              const randomPos =
                positions[Math.floor(Math.random() * positions.length)]!;
              newPos = fugue.after(randomPos);

              // Verify the new position is greater than the reference
              expect(newPos > randomPos).toBe(true);

              insertPosition(newPos);
            }
            break;
          }

          case 2: {
            // Insert before a random position
            if (positions.length > 0) {
              const randomPos =
                positions[Math.floor(Math.random() * positions.length)]!;
              newPos = fugue.before(randomPos);

              // Verify the new position is less than the reference
              expect(newPos < randomPos).toBe(true);

              insertPosition(newPos);
            }
            break;
          }

          case 3: {
            // Insert at beginning with between(null, first)
            if (positions.length > 0) {
              newPos = fugue.before(positions[0]!);

              // Verify the new position is less than the first position
              expect(newPos < positions[0]!).toBe(true);

              insertPosition(newPos);
            }
            break;
          }
        }

        // Verify ordering is maintained after each operation
        if (positions.length > 1) {
          verifyOrdering();
        }

        // Limit array size to prevent memory issues
        if (positions.length > 100) {
          // Remove some positions randomly while maintaining order
          const toRemove = Math.floor(positions.length * 0.3);
          for (let j = 0; j < toRemove; j++) {
            const removeIdx = Math.floor(Math.random() * positions.length);
            positions.splice(removeIdx, 1);
          }
        }
      } catch (error) {
        console.error(`Error in operation ${i}, type ${operation}:`, error);
        console.error(`Positions at time of error:`, positions);
        throw error;
      }
    }

    // Final verification
    verifyOrdering();
  });

  test("random operations across seeds and clients maintain stronger invariants", () => {
    // Simple xorshift32 PRNG to make fuzzing deterministic by seed
    const makePRNG = (seed: number) => {
      let x = seed | 0;
      const next = () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return ((x >>> 0) / 0x100000000);
      };
      const nextInt = (n: number) => Math.floor(next() * n);
      const pick = <T,>(arr: T[]) => arr[nextInt(arr.length)]!;
      return { next, nextInt, pick };
    };

    const seeds = [0x1, 0x2a2a2a2a, 0x12345678, 0x7fffffff, 0xdeadbeef];
    const opsPerSeed = 4_000; // Keep total runtime reasonable
    const maxPositions = 2_000;

    for (const seed of seeds) {
      const rng = makePRNG(seed);
      const clients = [new Fugue("client1"), new Fugue("client2"), new Fugue("client3")];
      const positions: string[] = [];

      const insertPosition = (pos: string) => {
        let insertIndex = 0;
        while (insertIndex < positions.length && positions[insertIndex]! < pos) insertIndex++;
        positions.splice(insertIndex, 0, pos);
      };

      const verifyOrdering = () => {
        for (let i = 0; i < positions.length - 1; i++) {
          expect(positions[i]! < positions[i + 1]!).toBe(true);
        }
      };

      const verifyBounds = () => {
        for (const p of positions) {
          expect(p > Fugue.FIRST).toBe(true);
          expect(p < Fugue.LAST).toBe(true);
        }
      };

      const verifyUnique = () => {
        const set = new Set(positions);
        expect(set.size).toBe(positions.length);
      };

      // Initialize with a few positions from different clients
      for (const f of clients) {
        const a = f.first();
        insertPosition(a);
        insertPosition(f.after(a));
        insertPosition(f.before(a));
      }

      positions.sort();

      for (let i = 0; i < opsPerSeed; i++) {
        const f = rng.pick(clients);
        const op = rng.nextInt(8);
        try {
          let newPos: string | null = null;
          switch (op) {
            case 0: { // Insert between two random positions
              if (positions.length >= 2) {
                const i1 = rng.nextInt(positions.length);
                const i2 = rng.nextInt(positions.length);
                if (i1 !== i2) {
                  const left = positions[Math.min(i1, i2)]!;
                  const right = positions[Math.max(i1, i2)]!;
                  newPos = f.between(left, right);
                  expect(newPos > left).toBe(true);
                  expect(newPos < right).toBe(true);
                }
              }
              break;
            }
            case 1: { // Insert after random
              if (positions.length > 0) {
                const ref = positions[rng.nextInt(positions.length)]!;
                newPos = f.after(ref);
                expect(newPos > ref).toBe(true);
              }
              break;
            }
            case 2: { // Insert before random
              if (positions.length > 0) {
                const ref = positions[rng.nextInt(positions.length)]!;
                newPos = f.before(ref);
                expect(newPos < ref).toBe(true);
              }
              break;
            }
            case 3: { // Insert at beginning
              if (positions.length > 0) {
                const first = positions[0]!;
                newPos = f.between(null, first);
                expect(newPos < first).toBe(true);
              }
              break;
            }
            case 4: { // Insert at end
              if (positions.length > 0) {
                const last = positions[positions.length - 1]!;
                newPos = f.between(last, null);
                expect(newPos > last).toBe(true);
              }
              break;
            }
            case 5: { // Insert between neighbors
              if (positions.length >= 2) {
                const idx = rng.nextInt(positions.length - 1);
                const left = positions[idx]!;
                const right = positions[idx + 1]!;
                newPos = f.between(left, right);
                expect(newPos > left).toBe(true);
                expect(newPos < right).toBe(true);
              }
              break;
            }
            case 6: { // Invalid: swapped order (left >= right)
              if (positions.length >= 2) {
                const i1 = rng.nextInt(positions.length - 1);
                const left = positions[i1 + 1]!;
                const right = positions[i1]!;
                // Should not throw; implementation adjusts inputs
                newPos = f.between(left, right);
                // Not asserting specific position, rely on global invariants afterwards
              }
              break;
            }
            case 7: { // Boundary: right > LAST
              // Should clamp internally; result must be < Fugue.LAST
              newPos = f.between(null, "~~~");
              expect(newPos < Fugue.LAST).toBe(true);
              break;
            }
          }

          if (newPos !== null) insertPosition(newPos);

          // Periodically verify invariants to keep cost reasonable
          if ((i & 63) === 63) {
            verifyOrdering();
            verifyBounds();
            verifyUnique();
          }

          // Control growth
          if (positions.length > maxPositions) {
            const toRemove = Math.floor(positions.length * 0.3);
            for (let r = 0; r < toRemove; r++) {
              positions.splice(rng.nextInt(positions.length), 1);
            }
          }
        } catch (err) {
          // Include seed in error context for reproducibility
          console.error(`Seed ${seed} failed at op ${i} (type ${op})`);
          throw err;
        }
      }

      // Final verification per seed
      verifyOrdering();
      verifyBounds();
      verifyUnique();
    }
  });

  test("edge cases and boundary conditions", () => {
    const fugue = new Fugue("client1");

    // Test with FIRST and LAST constants
    const firstPos = fugue.between(Fugue.FIRST, null);
    const lastPos = fugue.between(null, Fugue.LAST);
    const betweenFirstLast = fugue.between(Fugue.FIRST, Fugue.LAST);

    expect(Fugue.FIRST < firstPos).toBe(true);
    expect(lastPos < Fugue.LAST).toBe(true);
    expect(Fugue.FIRST < betweenFirstLast).toBe(true);
    expect(betweenFirstLast < Fugue.LAST).toBe(true);

    // Test creating many positions in rapid succession
    const rapidPositions: string[] = [];
    const basePos = fugue.first();

    for (let i = 0; i < 50; i++) {
      rapidPositions.push(fugue.after(basePos));
    }

    // All should be greater than base and maintain order
    for (const pos of rapidPositions) {
      expect(pos > basePos).toBe(true);
    }

    // Test interleaving positions
    let left = fugue.first();
    let right = fugue.after(left);

    for (let i = 0; i < 20; i++) {
      const middle = fugue.between(left, right);
      expect(left < middle).toBe(true);
      expect(middle < right).toBe(true);

      // Randomly choose which side to continue from
      if (Math.random() < 0.5) {
        right = middle;
      } else {
        left = middle;
      }
    }
  });
});
