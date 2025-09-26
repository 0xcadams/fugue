import { describe, expect, test } from "vitest";
import { Fugue } from "../src";

describe("fuzzing", () => {
  test("random operations maintain ordering invariants", () => {
    const fugue = new Fugue("client1");
    const positions: string[] = [];
    const maxOperations = 10_000;

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
              newPos = fugue.between(null, positions[0]!);

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
