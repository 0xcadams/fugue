import { bench, describe } from "vitest";
import { Fugue, FugueBurst } from "../src";
import { NESTED_COORD_MAX_RIGHT, TOP_COORD_MID } from "../src/position";

function makeDeterministicRandomBytes(seed: number) {
  let state = seed >>> 0;

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      out[index] = state & 0xff;
    }
    return out;
  };
}

describe("fugue", () => {
  bench("flat burst", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(1) });
    const burst = fugue.startBurst(null, null);

    burst.next();
    burst.next();
    burst.next();
  });

  bench("nested burst in old gap", () => {
    const fugue = new Fugue({ randomBytes: makeDeterministicRandomBytes(2) });
    const burst = fugue.startBurst(null, null);
    const left = burst.next();
    const right = burst.next();

    fugue.between(left, right);
  });

  bench("concurrent sibling bursts", () => {
    const seedA = new Fugue({ randomBytes: makeDeterministicRandomBytes(3) });
    const left = seedA.first();
    const right = seedA.after(left);

    const alice = new Fugue({ randomBytes: makeDeterministicRandomBytes(4) });
    const bob = new Fugue({ randomBytes: makeDeterministicRandomBytes(5) });

    alice.startBurst(left, right).next();
    bob.startBurst(left, right).next();
  });

  bench("burst continuation deepens at coord max", () => {
    const burst = new FugueBurst([TOP_COORD_MID], [1n]);
    const state = burst as unknown as {
      lastPosition: { coords: bigint[]; bursts: bigint[] };
    };
    state.lastPosition = {
      coords: [TOP_COORD_MID, NESTED_COORD_MAX_RIGHT],
      bursts: [1n],
    };

    burst.next();
  });
});
