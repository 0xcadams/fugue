import {
  InvalidRandomSourceError,
  SecureRandomUnavailableError,
} from "../errors";
import {
  COORD_STRIDE,
  MAX_BURST_DEPTH,
  NESTED_COORD_MAX_RIGHT_NUMBER,
  TOP_COORD_MAX_RIGHT,
} from "./position-schema";
import {
  formatPreparedPositionUnchecked,
  midpointRightCoordBetween,
  type PreparedPositionSnapshot,
} from "./prepared-path";

const MAX_RANDOM_REJECTION_ATTEMPTS = 128;
const PREPARED_POSITION_CACHE_LIMIT = 16_384;

export const BURST_DEPTH_EXCEEDED_MESSAGE = `Cannot open another nested burst: burst depth exceeds ${MAX_BURST_DEPTH}`;

export type FuguePositionText = `${string}!${string}!${string}`;
export type FugueRandomBytes = (byteLength: number) => Uint8Array;

export class PreparedPositionCache {
  private readonly entries = new Map<
    FuguePositionText,
    PreparedPositionSnapshot
  >();

  get(text: FuguePositionText) {
    const cached = this.entries.get(text);
    if (cached === undefined) {
      return null;
    }

    this.entries.delete(text);
    this.entries.set(text, cached);
    return cached;
  }

  set(position: PreparedPositionSnapshot) {
    const text = position.text as FuguePositionText;
    this.entries.delete(text);
    this.entries.set(text, position);

    if (this.entries.size > PREPARED_POSITION_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value as
        | FuguePositionText
        | undefined;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    return position;
  }
}

function bitLength(value: bigint) {
  return value.toString(2).length;
}

function bitLengthNumber(value: number) {
  return Math.floor(Math.log2(value)) + 1;
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return value;
}

export function nextSequentialTopCoordAfter(coord: bigint) {
  if (coord <= TOP_COORD_MAX_RIGHT - COORD_STRIDE) {
    return coord + COORD_STRIDE;
  }

  if (coord < TOP_COORD_MAX_RIGHT) {
    return TOP_COORD_MAX_RIGHT;
  }

  return null;
}

export function nextSequentialTopCoordBefore(coord: bigint) {
  if (coord >= 1n + COORD_STRIDE) {
    return coord - COORD_STRIDE;
  }

  if (coord > 1n) {
    return 1n;
  }

  return null;
}

export function nextSequentialNestedCoordAfter(coord: number) {
  const stride = Number(COORD_STRIDE);
  if (coord <= NESTED_COORD_MAX_RIGHT_NUMBER - stride) {
    return coord + stride;
  }

  if (coord < NESTED_COORD_MAX_RIGHT_NUMBER) {
    return NESTED_COORD_MAX_RIGHT_NUMBER;
  }

  return null;
}

export function midpointPositionAtSameDepth(
  left: PreparedPositionSnapshot,
  right: PreparedPositionSnapshot,
): PreparedPositionSnapshot | null {
  if (left.topCoord !== right.topCoord || left.depth !== right.depth) {
    return null;
  }

  for (let depth = 0; depth < left.depth; depth++) {
    if (
      left.bursts[depth] !== right.bursts[depth] ||
      (depth < left.depth - 1 &&
        left.nestedCoords[depth] !== right.nestedCoords[depth])
    ) {
      return null;
    }
  }

  const midpoint = midpointRightCoordBetween(left.finalCoord, right.finalCoord);
  if (midpoint === null) {
    return null;
  }

  const position = {
    topCoord: left.topCoord,
    bursts: left.bursts,
    nestedCoords: left.nestedCoords,
    finalCoord: midpoint,
    depth: left.depth,
  };

  return {
    ...position,
    text: formatPreparedPositionUnchecked(position),
  };
}

export function chooseBurstToken(
  randomBetweenNumber: (minInclusive: number, maxInclusive: number) => number,
  minInclusive: number,
  maxInclusive: number,
) {
  if (maxInclusive < minInclusive) {
    throw new InvalidRandomSourceError(
      `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
    );
  }

  const span = maxInclusive - minInclusive;
  if (span < 4) {
    return randomBetweenNumber(minInclusive, maxInclusive);
  }

  const slack = Math.floor(span / 4);
  const innerMin = minInclusive + slack;
  const innerMax = maxInclusive - slack;

  return randomBetweenNumber(innerMin, innerMax);
}

export function randomBelow(randomBytes: FugueRandomBytes, limit: bigint) {
  if (limit <= 0n) {
    throw new InvalidRandomSourceError(`limit must be > 0, got ${limit}`);
  }

  if (limit === 1n) {
    return 0n;
  }

  const bits = bitLength(limit - 1n);
  const byteLength = Math.ceil(bits / 8);
  const extraBits = byteLength * 8 - bits;
  const mask = 0xff >>> extraBits;

  for (let attempt = 0; attempt < MAX_RANDOM_REJECTION_ATTEMPTS; attempt++) {
    const bytes = randomBytes(byteLength);
    if (bytes.length !== byteLength) {
      throw new InvalidRandomSourceError(
        `randomBytes must return exactly ${byteLength} bytes, got ${bytes.length}`,
      );
    }

    const sample = bytes.slice();
    sample[0] = sample[0]! & mask;
    const value = bytesToBigInt(sample);

    if (value < limit) {
      return value;
    }
  }

  throw new InvalidRandomSourceError(
    `randomBytes failed to produce a sample < ${limit} after ${MAX_RANDOM_REJECTION_ATTEMPTS} attempts`,
  );
}

export function randomBelowNumber(
  randomBytes: FugueRandomBytes,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new InvalidRandomSourceError(
      `limit must be a safe integer > 0, got ${limit}`,
    );
  }

  if (limit === 1) {
    return 0;
  }

  const bits = bitLengthNumber(limit - 1);
  const byteLength = Math.ceil(bits / 8);
  const extraBits = byteLength * 8 - bits;
  const mask = 0xff >>> extraBits;

  for (let attempt = 0; attempt < MAX_RANDOM_REJECTION_ATTEMPTS; attempt++) {
    const bytes = randomBytes(byteLength);
    if (bytes.length !== byteLength) {
      throw new InvalidRandomSourceError(
        `randomBytes must return exactly ${byteLength} bytes, got ${bytes.length}`,
      );
    }

    let value = bytes[0]! & mask;
    for (let index = 1; index < byteLength; index++) {
      value = value * 256 + bytes[index]!;
    }

    if (value < limit) {
      return value;
    }
  }

  throw new InvalidRandomSourceError(
    `randomBytes failed to produce a sample < ${limit} after ${MAX_RANDOM_REJECTION_ATTEMPTS} attempts`,
  );
}

export function defaultRandomBytes(
  byteLength: number,
  allowInsecureRandom: boolean,
): Uint8Array {
  if (byteLength <= 0) {
    throw new InvalidRandomSourceError(
      `byteLength must be > 0, got ${byteLength}`,
    );
  }

  const cryptoObject = globalThis?.crypto;
  if (
    cryptoObject !== undefined &&
    "getRandomValues" in cryptoObject &&
    cryptoObject.getRandomValues !== undefined
  ) {
    const bytes = new Uint8Array(byteLength);
    cryptoObject.getRandomValues(bytes);
    return bytes;
  }

  if (allowInsecureRandom) {
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }

  throw new SecureRandomUnavailableError(
    "No secure random source found. Provide options.randomBytes, enable globalThis.crypto.getRandomValues, or set allowInsecureRandom: true.",
  );
}
