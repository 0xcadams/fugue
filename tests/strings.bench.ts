import { bench, describe } from "vitest";
import { Fugue, SLOT_MAX, formatPosition } from "../src";

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

    run.append();
    run.append();
    run.prepend();
  });

  bench("multiple instances", () => {
    const instances = Array.from({ length: 100 }, () => new Fugue());

    let firstKey: string | null = null;
    let lastKey: string | null = null;

    // Create initial position for first instance
    const firstInstance = instances[0];
    if (firstInstance) {
      firstKey = firstInstance.first();
      lastKey = firstInstance.after(firstKey);
    }

    let previousKey: string | null = firstKey;

    for (let j = 0; j < 10; j++) {
      for (const instance of instances) {
        const newPos = instance.between(previousKey, lastKey);
        previousKey = instance.between(previousKey, newPos);
      }
    }
  });

  bench("same-run escape hatch (adjacent slots)", () => {
    const fugue = new Fugue();

    const left = formatPosition({ anchor: 12n, runId: 34n, slot: 50n });
    const right = formatPosition({ anchor: 12n, runId: 34n, slot: 51n });
    fugue.between(left, right);
  });

  bench("same-run escape hatch (deep level)", () => {
    const fugue = new Fugue();

    const left = formatPosition({
      anchor: 12n,
      runId: 34n,
      slot: 50n,
      subslots: [50n],
    });
    const right = formatPosition({
      anchor: 12n,
      runId: 34n,
      slot: 50n,
      subslots: [51n],
    });
    fugue.between(left, right);
  });

  bench("append boundary uses escape hatch", () => {
    const fugue = new Fugue();

    const left = formatPosition({
      anchor: 7n,
      runId: 9n,
      slot: SLOT_MAX,
    });
    fugue.between(left, null);
  });

  bench("prepend boundary uses escape hatch", () => {
    const fugue = new Fugue();

    const right = formatPosition({
      anchor: 7n,
      runId: 9n,
      slot: 0n,
      subslots: [9n],
    });
    fugue.between(null, right);
  });
});
