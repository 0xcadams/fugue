import {
  BurstSpaceExhaustedError,
  CoordSpaceExhaustedError,
  InvalidBoundsError,
  InvalidPositionError,
  InvalidRandomSourceError,
  SecureRandomUnavailableError,
} from "./errors";
import {
  COORD_STRIDE,
  MAX_BURST_DEPTH,
  NESTED_COORD_MAX_RIGHT,
  NESTED_COORD_MID,
  SEPARATOR,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  burstMaxAtDepth,
  comparePositions,
  formatPosition,
  isPositionPrefix,
  parsePosition,
  toLeftAncestor,
  type FuguePosition,
  type ParsedFuguePosition,
} from "./position";

const MAX_RANDOM_REJECTION_ATTEMPTS = 128;

export type FugueRandomBytes = (byteLength: number) => Uint8Array;

export type FugueOptions = {
  randomBytes?: FugueRandomBytes;
  allowInsecureRandom?: boolean;
};

function bitLength(value: bigint) {
  return value.toString(2).length;
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return value;
}

function clonePath(path: readonly bigint[]) {
  return [...path];
}

function prefixAtDepth(position: ParsedFuguePosition, depth: number) {
  return {
    coords: position.coords.slice(0, depth + 1),
    bursts: position.bursts.slice(0, depth),
  } as ParsedFuguePosition;
}

function nextSequentialCoordAfter(coord: bigint, maxRight: bigint) {
  if (coord <= maxRight - COORD_STRIDE) {
    return coord + COORD_STRIDE;
  }

  if (coord < maxRight) {
    return maxRight;
  }

  return null;
}

function nextSequentialCoordBefore(coord: bigint) {
  if (coord >= 1n + COORD_STRIDE) {
    return coord - COORD_STRIDE;
  }

  if (coord > 1n) {
    return 1n;
  }

  return null;
}

export class FugueBurst {
  private readonly prefixCoords: readonly bigint[];
  private readonly prefixBursts: readonly bigint[];
  private readonly continuationBurst: bigint;
  private readonly prefix: string;

  private lastPosition: ParsedFuguePosition | null = null;

  constructor(
    prefixCoords: readonly bigint[],
    prefixBursts: readonly bigint[],
  ) {
    if (prefixCoords.length !== prefixBursts.length) {
      throw new InvalidPositionError(
        `burst prefixes must satisfy coords.length = bursts.length, got ${prefixCoords.length} coords and ${prefixBursts.length} bursts`,
      );
    }

    if (prefixBursts.length === 0) {
      throw new InvalidPositionError(
        "burst prefixes must contain at least 1 burst token",
      );
    }

    if (prefixBursts.length > MAX_BURST_DEPTH) {
      throw new InvalidPositionError(
        `burst depth must be <= ${MAX_BURST_DEPTH}, got ${prefixBursts.length}`,
      );
    }

    const sample = formatPosition({
      coords: [...prefixCoords, NESTED_COORD_MID],
      bursts: prefixBursts,
    });

    this.prefixCoords = clonePath(prefixCoords);
    this.prefixBursts = clonePath(prefixBursts);
    this.continuationBurst = prefixBursts[prefixBursts.length - 1]!;
    this.prefix = sample.slice(0, sample.lastIndexOf(SEPARATOR));
  }

  next(): FuguePosition {
    if (this.lastPosition === null) {
      this.lastPosition = {
        coords: [...this.prefixCoords, NESTED_COORD_MID],
        bursts: clonePath(this.prefixBursts),
      };
      return formatPosition(this.lastPosition);
    }

    const coords = [...this.lastPosition.coords];
    const bursts = [...this.lastPosition.bursts];
    const lastCoordIndex = coords.length - 1;
    const nextCoord = nextSequentialCoordAfter(
      coords[lastCoordIndex]!,
      NESTED_COORD_MAX_RIGHT,
    );

    if (nextCoord !== null) {
      coords[lastCoordIndex] = nextCoord;
      this.lastPosition = { coords, bursts };
      return formatPosition(this.lastPosition);
    }

    if (bursts.length >= MAX_BURST_DEPTH) {
      throw new CoordSpaceExhaustedError(
        `Cannot continue burst ${this.prefix}: burst depth exceeds ${MAX_BURST_DEPTH}`,
      );
    }

    bursts.push(this.continuationBurst);
    coords.push(NESTED_COORD_MID);
    this.lastPosition = { coords, bursts };
    return formatPosition(this.lastPosition);
  }
}

export class Fugue {
  private readonly randomBytes: FugueRandomBytes;
  private readonly allowInsecureRandom: boolean;

  constructor(options: FugueOptions = {}) {
    this.allowInsecureRandom = options.allowInsecureRandom ?? false;

    this.randomBytes =
      options.randomBytes ??
      ((byteLength: number) => {
        return this.defaultRandomBytes(byteLength);
      });
  }

  first(): FuguePosition {
    return this.between(null, null);
  }

  after(position: FuguePosition): FuguePosition {
    return this.startBurstAfter(position).next();
  }

  before(position: FuguePosition): FuguePosition {
    return this.startBurstBefore(position).next();
  }

  between(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): FuguePosition {
    return this.startBurst(left, right).next();
  }

  startBurst(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): FugueBurst {
    const [parsedLeft, parsedRight] = this.parseBounds(left, right);

    if (parsedLeft === null && parsedRight === null) {
      return new FugueBurst([TOP_COORD_MID], [this.randomBurstToken(0)]);
    }

    if (parsedLeft !== null && parsedRight === null) {
      return this.startBurstAfterParsed(parsedLeft);
    }

    if (parsedLeft === null && parsedRight !== null) {
      return this.startBurstBeforeParsed(parsedRight);
    }

    if (
      parsedRight !== null &&
      (parsedLeft === null || isPositionPrefix(parsedLeft, parsedRight))
    ) {
      return this.startBurstFromAncestor(toLeftAncestor(parsedRight));
    }

    if (parsedRight !== null) {
      const shallower = this.tryStartAfterLeftWithinGap(
        parsedLeft!,
        parsedRight,
      );
      if (shallower !== null) {
        return shallower;
      }
    }

    return this.startBurstFromAncestor(parsedLeft!);
  }

  startBurstAfter(position: FuguePosition): FugueBurst {
    return this.startBurstAfterParsed(parsePosition(position));
  }

  startBurstBefore(position: FuguePosition): FugueBurst {
    return this.startBurstBeforeParsed(parsePosition(position));
  }

  private startBurstFromAncestor(
    ancestor: ParsedFuguePosition,
    minBurstExclusive?: bigint,
    maxBurstInclusive?: bigint,
  ) {
    if (ancestor.bursts.length >= MAX_BURST_DEPTH) {
      throw new BurstSpaceExhaustedError(
        `Cannot open another nested burst: burst depth exceeds ${MAX_BURST_DEPTH}`,
      );
    }

    const depth = ancestor.bursts.length;
    const minBurst =
      minBurstExclusive === undefined ? 0n : minBurstExclusive + 1n;
    const maxBurst = maxBurstInclusive ?? burstMaxAtDepth(depth);

    if (minBurst > maxBurst) {
      throw new BurstSpaceExhaustedError(
        `Cannot open another nested burst: burst space exhausted at depth ${depth}`,
      );
    }

    return new FugueBurst(ancestor.coords, [
      ...ancestor.bursts,
      this.chooseBurstToken(minBurst, maxBurst),
    ]);
  }

  private tryStartAfterLeftWithinGap(
    left: ParsedFuguePosition,
    right: ParsedFuguePosition,
  ) {
    for (let depth = 0; depth <= left.bursts.length; depth++) {
      const ancestor = prefixAtDepth(left, depth);

      if (depth === left.bursts.length) {
        if (comparePositions(ancestor, right) < 0) {
          return this.startBurstFromAncestor(ancestor);
        }
        continue;
      }

      const upper = this.maxBurstBeforeRight(ancestor, depth, right);
      if (upper === null) {
        continue;
      }

      const lower = left.bursts[depth]!;
      if (lower < upper) {
        return this.startBurstFromAncestor(ancestor, lower, upper);
      }
    }

    return null;
  }

  private maxBurstBeforeRight(
    ancestor: ParsedFuguePosition,
    depth: number,
    right: ParsedFuguePosition,
  ) {
    if (isPositionPrefix(ancestor, right)) {
      const rightBurst = right.bursts[depth];
      if (rightBurst === undefined) {
        return null;
      }

      return rightBurst - 1n;
    }

    if (comparePositions(ancestor, right) < 0) {
      return burstMaxAtDepth(depth);
    }

    return null;
  }

  private chooseBurstToken(minInclusive: bigint, maxInclusive: bigint) {
    if (maxInclusive < minInclusive) {
      throw new InvalidRandomSourceError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive;
    if (span < 4n) {
      return this.randomBetween(minInclusive, maxInclusive);
    }

    const slack = span / 4n;
    const innerMin = minInclusive + slack;
    const innerMax = maxInclusive - slack;

    return this.randomBetween(innerMin, innerMax);
  }

  private startBurstAfterParsed(position: ParsedFuguePosition) {
    const nextTopCoord = nextSequentialCoordAfter(
      position.coords[0]!,
      TOP_COORD_MAX_RIGHT,
    );

    if (nextTopCoord !== null) {
      return new FugueBurst([nextTopCoord], [this.randomBurstToken(0)]);
    }

    return this.startBurstFromAncestor(position);
  }

  private startBurstBeforeParsed(position: ParsedFuguePosition) {
    const previousTopCoord = nextSequentialCoordBefore(position.coords[0]!);

    if (previousTopCoord !== null) {
      return new FugueBurst([previousTopCoord], [this.randomBurstToken(0)]);
    }

    return this.startBurstFromAncestor(toLeftAncestor(position));
  }

  private parseBounds(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): [ParsedFuguePosition | null, ParsedFuguePosition | null] {
    const parsedLeft = this.parseBound(left);
    const parsedRight = this.parseBound(right);

    if (
      parsedLeft !== null &&
      parsedRight !== null &&
      comparePositions(parsedLeft, parsedRight) >= 0
    ) {
      throw new InvalidBoundsError(
        `Expected left < right, got ${left} >= ${right}`,
      );
    }

    return [parsedLeft, parsedRight];
  }

  private parseBound(value: FuguePosition | null): ParsedFuguePosition | null {
    if (value === null) {
      return null;
    }

    return parsePosition(value);
  }

  private randomBurstToken(depth: number) {
    return this.randomBetween(0n, burstMaxAtDepth(depth));
  }

  private randomBelow(limit: bigint) {
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
      const bytes = this.randomBytes(byteLength);
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

  private randomBetween(minInclusive: bigint, maxInclusive: bigint) {
    if (maxInclusive < minInclusive) {
      throw new InvalidRandomSourceError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive + 1n;
    const offset = this.randomBelow(span);
    return minInclusive + offset;
  }

  private defaultRandomBytes(byteLength: number): Uint8Array {
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

    if (this.allowInsecureRandom) {
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return bytes;
    }

    throw new SecureRandomUnavailableError(
      "No secure random source found. Provide options.randomBytes, enable globalThis.crypto.getRandomValues, or set allowInsecureRandom: true.",
    );
  }
}
