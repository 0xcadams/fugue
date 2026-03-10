import { bench, describe } from "vitest";
import { Fugue, formatPosition, type FuguePosition } from "../src";
import { ANCHOR_MAX, SLOT_MAX } from "../src/position";

describe("benchmarks", () => {
  bench("single", () => {
    const fugue = new Fugue();
    const first = fugue.first();
    const second = fugue.after(first);
    fugue.between(first, second);
  });

  bench("run burst", () => {
    const fugue = new Fugue();

    const left = fugue.first();
    const right = fugue.after(left);
    const run = fugue.startRun(left, right);

    run.next();
    run.next();
    run.next();
  });

  bench("multiple instances", () => {
    const instances = Array.from({ length: 100 }, () => new Fugue());

    let firstKey: FuguePosition | null = null;
    let lastKey: FuguePosition | null = null;

    const firstInstance = instances[0];
    if (firstInstance) {
      firstKey = firstInstance.first();
      lastKey = firstInstance.after(firstKey);
    }

    let previousKey: FuguePosition | null = firstKey;

    for (let j = 0; j < 10; j++) {
      for (const instance of instances) {
        const newPos = instance.between(previousKey, lastKey);
        previousKey = instance.between(previousKey, newPos);
      }
    }
  });

  bench("same-run deepens for adjacent slots", () => {
    const fugue = new Fugue();

    const left = formatPosition({
      anchorPath: [12n],
      runId: 34n,
      slotPath: [50n],
    });
    const right = formatPosition({
      anchorPath: [12n],
      runId: 34n,
      slotPath: [51n],
    });
    fugue.between(left, right);
  });

  bench("same-run deep zero-tail case", () => {
    const fugue = new Fugue();

    const left = formatPosition({
      anchorPath: [12n],
      runId: 34n,
      slotPath: [50n],
    });
    const right = formatPosition({
      anchorPath: [12n],
      runId: 34n,
      slotPath: [50n, 0n, 51n],
    });
    fugue.between(left, right);
  });

  bench("append boundary uses same-run fallback", () => {
    const fugue = new Fugue();

    const left = formatPosition({
      anchorPath: Array.from({ length: 64 }, () => ANCHOR_MAX),
      runId: (1n << 96n) - 1n,
      slotPath: [SLOT_MAX - 2n],
    });
    fugue.between(left, null);
  });

  bench("prepend boundary uses same-run fallback", () => {
    const fugue = new Fugue();

    const right = formatPosition({
      anchorPath: [0n],
      runId: 0n,
      slotPath: [2n],
    });
    fugue.between(null, right);
  });
});
