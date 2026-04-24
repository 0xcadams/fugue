const DEFAULT_SEED = 0x9e3779b9;

export function hashString(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function combineSeed(seed: number, label: string) {
  return (seed ^ hashString(label) ^ DEFAULT_SEED) >>> 0;
}

export function makePRNG(seed: number) {
  let state = seed >>> 0;

  if (state === 0) {
    state = DEFAULT_SEED;
  }

  const nextUint32 = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return {
    nextUint32,
    nextFloat() {
      return nextUint32() / 0x1_0000_0000;
    },
    nextInt(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(
          `maxExclusive must be a positive integer, got ${maxExclusive}`,
        );
      }

      return nextUint32() % maxExclusive;
    },
    nextBoolean() {
      return (nextUint32() & 1) === 1;
    },
    pick<T>(values: readonly T[]) {
      if (values.length === 0) {
        throw new RangeError("cannot pick from an empty array");
      }

      return values[this.nextInt(values.length)]!;
    },
  };
}

export type PRNG = ReturnType<typeof makePRNG>;

export function makeDeterministicRandomBytes(seed: number) {
  const prng = makePRNG(seed);

  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
      out[index] = prng.nextInt(256);
    }
    return out;
  };
}

export function randomAlphaNumeric(prng: PRNG, length: number) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";

  for (let index = 0; index < length; index++) {
    out += alphabet[prng.nextInt(alphabet.length)]!;
  }

  return out;
}

export function randomSignedOffset(prng: PRNG, magnitude: number) {
  if (magnitude <= 0) {
    return 0;
  }

  return prng.nextInt(magnitude * 2 + 1) - magnitude;
}
