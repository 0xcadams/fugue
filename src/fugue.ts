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
  NESTED_COORD_MAX_RIGHT_NUMBER,
  NESTED_COORD_MID,
  NESTED_COORD_MID_NUMBER,
  SEPARATOR,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  burstMaxNumberAtDepth,
  comparePreparedPositions,
  formatPosition,
  formatPreparedPositionUnchecked,
  isPreparedPositionPrefix,
  preparePosition,
  toPreparedLeftAncestor,
  type FuguePosition,
  type PreparedFuguePath,
  type PreparedFuguePosition,
} from "./position";

const MAX_RANDOM_REJECTION_ATTEMPTS = 128;
const BURST_DEPTH_EXCEEDED_MESSAGE = `Cannot open another nested burst: burst depth exceeds ${MAX_BURST_DEPTH}`;
const PREPARED_POSITION_CACHE_LIMIT = 16_384;

export type FugueRandomBytes = (byteLength: number) => Uint8Array;

export type FugueOptions = {
  randomBytes?: FugueRandomBytes;
  allowInsecureRandom?: boolean;
};

type PreparedBurstPrefix = Readonly<{
  topCoord: bigint;
  bursts: readonly number[];
  nestedCoords: readonly number[];
}>;

type RememberPreparedPosition = (position: PreparedFuguePosition) => void;

class PreparedPositionCache {
  private readonly entries = new Map<FuguePosition, PreparedFuguePosition>();

  get(text: FuguePosition) {
    const cached = this.entries.get(text);
    if (cached === undefined) {
      return null;
    }

    this.entries.delete(text);
    this.entries.set(text, cached);
    return cached;
  }

  set(position: PreparedFuguePosition) {
    this.entries.delete(position.text);
    this.entries.set(position.text, position);

    if (this.entries.size > PREPARED_POSITION_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value as
        | FuguePosition
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

function cloneNumberPath(path: readonly number[]) {
  return [...path];
}

function toSafeInteger(value: bigint, label: string) {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new InvalidPositionError(
      `${label} must fit in a safe integer, got ${value}`,
    );
  }

  return converted;
}

function toPreparedBurstPrefix(
  prefixCoords: readonly bigint[],
  prefixBursts: readonly bigint[],
): PreparedBurstPrefix {
  return {
    topCoord: prefixCoords[0]!,
    bursts: prefixBursts.map((burst, depth) => {
      return toSafeInteger(burst, `burst at depth ${depth}`);
    }),
    nestedCoords: prefixCoords.slice(1).map((coord, index) => {
      return toSafeInteger(coord, `coord at depth ${index + 1}`);
    }),
  };
}

function prefixAtDepth(
  position: PreparedFuguePath,
  depth: number,
): PreparedFuguePath {
  return {
    topCoord: position.topCoord,
    bursts: position.bursts.slice(0, depth),
    nestedCoords: position.nestedCoords.slice(0, depth),
  };
}

function nextSequentialTopCoordAfter(coord: bigint, maxRight: bigint) {
  if (coord <= maxRight - COORD_STRIDE) {
    return coord + COORD_STRIDE;
  }

  if (coord < maxRight) {
    return maxRight;
  }

  return null;
}

function nextSequentialTopCoordBefore(coord: bigint) {
  if (coord >= 1n + COORD_STRIDE) {
    return coord - COORD_STRIDE;
  }

  if (coord > 1n) {
    return 1n;
  }

  return null;
}

function nextSequentialNestedCoordAfter(coord: number) {
  if (coord <= NESTED_COORD_MAX_RIGHT_NUMBER - Number(COORD_STRIDE)) {
    return coord + Number(COORD_STRIDE);
  }

  if (coord < NESTED_COORD_MAX_RIGHT_NUMBER) {
    return NESTED_COORD_MAX_RIGHT_NUMBER;
  }

  return null;
}

function midpointRightCoordBetween(left: number, right: number) {
  if (right - left <= 2) {
    return null;
  }

  let candidate = Math.floor((left + right) / 2);
  if (candidate % 2 === 0) {
    candidate += 1;
  }

  if (candidate >= right) {
    candidate -= 2;
  }

  if (candidate <= left || candidate >= right) {
    return null;
  }

  return candidate;
}

function midpointPositionAtSameDepth(
  left: PreparedFuguePosition,
  right: PreparedFuguePosition,
): PreparedFuguePosition | null {
  if (
    left.topCoord !== right.topCoord ||
    left.bursts.length !== right.bursts.length ||
    left.nestedCoords.length !== right.nestedCoords.length
  ) {
    return null;
  }

  for (let depth = 0; depth < left.bursts.length; depth++) {
    if (
      left.bursts[depth] !== right.bursts[depth] ||
      (depth < left.bursts.length - 1 &&
        left.nestedCoords[depth] !== right.nestedCoords[depth])
    ) {
      return null;
    }
  }

  const midpoint = midpointRightCoordBetween(
    left.nestedCoords[left.nestedCoords.length - 1]!,
    right.nestedCoords[right.nestedCoords.length - 1]!,
  );
  if (midpoint === null) {
    return null;
  }

  const nestedCoords = [...left.nestedCoords];
  nestedCoords[nestedCoords.length - 1] = midpoint;
  const prepared: PreparedFuguePosition = {
    topCoord: left.topCoord,
    bursts: [...left.bursts],
    nestedCoords,
    text: "" as FuguePosition,
  };
  const text = formatPreparedPositionUnchecked(prepared);
  return {
    ...prepared,
    text,
  };
}

export class FugueBurst {
  private readonly prefixTopCoord: bigint;
  private readonly prefixNestedCoords: readonly number[];
  private readonly prefixBursts: readonly number[];
  private readonly continuationBurst: number;
  private readonly prefix: string;
  private readonly rememberPosition: RememberPreparedPosition | undefined;

  private currentNestedCoords: number[] | null = null;
  private currentBursts: number[] | null = null;

  constructor(
    prefixCoords: readonly bigint[],
    prefixBursts: readonly bigint[],
    rememberPosition?: RememberPreparedPosition,
    preparedPrefix?: PreparedBurstPrefix,
  ) {
    if (preparedPrefix === undefined) {
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

      const prepared = toPreparedBurstPrefix(prefixCoords, prefixBursts);
      this.prefixTopCoord = prepared.topCoord;
      this.prefixNestedCoords = prepared.nestedCoords;
      this.prefixBursts = prepared.bursts;
      this.continuationBurst = prepared.bursts[prepared.bursts.length - 1]!;
      this.prefix = sample.slice(0, sample.lastIndexOf(SEPARATOR));
      this.rememberPosition = rememberPosition;
      return;
    }

    this.prefixTopCoord = preparedPrefix.topCoord;
    this.prefixNestedCoords = cloneNumberPath(preparedPrefix.nestedCoords);
    this.prefixBursts = cloneNumberPath(preparedPrefix.bursts);
    this.continuationBurst =
      preparedPrefix.bursts[preparedPrefix.bursts.length - 1]!;
    const sample = formatPreparedPositionUnchecked({
      topCoord: preparedPrefix.topCoord,
      bursts: preparedPrefix.bursts,
      nestedCoords: [...preparedPrefix.nestedCoords, NESTED_COORD_MID_NUMBER],
    });
    this.prefix = sample.slice(0, sample.lastIndexOf(SEPARATOR));
    this.rememberPosition = rememberPosition;
  }

  static fromPreparedPrefix(
    prefix: PreparedBurstPrefix,
    rememberPosition?: RememberPreparedPosition,
  ) {
    return new FugueBurst([prefix.topCoord], [1n], rememberPosition, prefix);
  }

  next(): FuguePosition {
    if (this.currentNestedCoords === null || this.currentBursts === null) {
      this.currentBursts = cloneNumberPath(this.prefixBursts);
      this.currentNestedCoords = [
        ...this.prefixNestedCoords,
        NESTED_COORD_MID_NUMBER,
      ];
      return this.emitCurrentPosition();
    }

    const lastCoordIndex = this.currentNestedCoords.length - 1;
    const nextCoord = nextSequentialNestedCoordAfter(
      this.currentNestedCoords[lastCoordIndex]!,
    );

    if (nextCoord !== null) {
      this.currentNestedCoords[lastCoordIndex] = nextCoord;
      return this.emitCurrentPosition();
    }

    if (this.currentBursts.length >= MAX_BURST_DEPTH) {
      throw new CoordSpaceExhaustedError(
        `Cannot continue burst ${this.prefix}: burst depth exceeds ${MAX_BURST_DEPTH}`,
      );
    }

    this.currentBursts.push(this.continuationBurst);
    this.currentNestedCoords.push(NESTED_COORD_MID_NUMBER);
    return this.emitCurrentPosition();
  }

  private emitCurrentPosition() {
    const prepared: PreparedFuguePosition = {
      topCoord: this.prefixTopCoord,
      bursts: this.currentBursts!,
      nestedCoords: this.currentNestedCoords!,
      text: "" as FuguePosition,
    };
    const text = formatPreparedPositionUnchecked(prepared);

    if (this.rememberPosition === undefined) {
      return text;
    }

    this.rememberPosition({
      topCoord: this.prefixTopCoord,
      bursts: [...this.currentBursts!],
      nestedCoords: [...this.currentNestedCoords!],
      text,
    });
    return text;
  }
}

export class Fugue {
  private readonly randomBytes: FugueRandomBytes;
  private readonly allowInsecureRandom: boolean;
  private readonly preparedCache = new PreparedPositionCache();

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
    const [preparedLeft, preparedRight] = this.prepareBounds(left, right);

    try {
      return this.startBurstFromPreparedBounds(
        preparedLeft,
        preparedRight,
      ).next();
    } catch (error) {
      if (
        !(error instanceof BurstSpaceExhaustedError) ||
        preparedLeft === null ||
        preparedRight === null
      ) {
        throw error;
      }

      const fallback = midpointPositionAtSameDepth(preparedLeft, preparedRight);
      if (fallback !== null) {
        return this.rememberPreparedPosition(fallback).text;
      }

      throw error;
    }
  }

  startBurst(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): FugueBurst {
    const [preparedLeft, preparedRight] = this.prepareBounds(left, right);
    return this.startBurstFromPreparedBounds(preparedLeft, preparedRight);
  }

  startBurstAfter(position: FuguePosition): FugueBurst {
    return this.startBurstAfterPrepared(this.preparePosition(position));
  }

  startBurstBefore(position: FuguePosition): FugueBurst {
    return this.startBurstBeforePrepared(this.preparePosition(position));
  }

  private startBurstFromPreparedBounds(
    preparedLeft: PreparedFuguePosition | null,
    preparedRight: PreparedFuguePosition | null,
  ) {
    if (preparedLeft === null && preparedRight === null) {
      return FugueBurst.fromPreparedPrefix({
        topCoord: TOP_COORD_MID,
        bursts: [this.randomBurstToken(0)],
        nestedCoords: [],
      });
    }

    if (preparedLeft !== null && preparedRight === null) {
      return this.startBurstAfterPrepared(preparedLeft);
    }

    if (preparedLeft === null && preparedRight !== null) {
      return this.startBurstBeforePrepared(preparedRight);
    }

    if (
      preparedRight !== null &&
      isPreparedPositionPrefix(preparedLeft!, preparedRight)
    ) {
      const shallower = this.tryStartWithinPrefixGap(
        preparedLeft!,
        preparedRight,
      );
      if (shallower !== null) {
        return shallower;
      }

      return this.startBurstFromAncestor(toPreparedLeftAncestor(preparedRight));
    }

    if (preparedRight !== null) {
      const shallower = this.tryStartAfterLeftWithinGap(
        preparedLeft!,
        preparedRight,
      );
      if (shallower !== null) {
        return shallower;
      }
    }

    return this.startBurstFromAncestor(preparedLeft!);
  }

  private startBurstFromAncestor(
    ancestor: PreparedFuguePath,
    minBurstExclusive?: number,
    maxBurstInclusive?: number,
  ) {
    if (ancestor.bursts.length >= MAX_BURST_DEPTH) {
      throw new BurstSpaceExhaustedError(BURST_DEPTH_EXCEEDED_MESSAGE);
    }

    const depth = ancestor.bursts.length;
    const minBurst =
      minBurstExclusive === undefined ? 0 : minBurstExclusive + 1;
    const maxBurst = maxBurstInclusive ?? burstMaxNumberAtDepth(depth);

    if (minBurst > maxBurst) {
      throw new BurstSpaceExhaustedError(
        `Cannot open another nested burst: burst space exhausted at depth ${depth}`,
      );
    }

    return FugueBurst.fromPreparedPrefix({
      topCoord: ancestor.topCoord,
      bursts: [...ancestor.bursts, this.chooseBurstToken(minBurst, maxBurst)],
      nestedCoords: [...ancestor.nestedCoords],
    });
  }

  private tryStartAfterLeftWithinGap(
    left: PreparedFuguePosition,
    right: PreparedFuguePosition,
  ) {
    for (let depth = 0; depth <= left.bursts.length; depth++) {
      const ancestor = prefixAtDepth(left, depth);

      if (depth === left.bursts.length) {
        if (comparePreparedPositions(ancestor, right) < 0) {
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

  private tryStartWithinPrefixGap(
    left: PreparedFuguePosition,
    right: PreparedFuguePosition,
  ) {
    const depth = left.bursts.length;
    const upper = this.maxBurstBeforeRight(left, depth, right);

    if (upper === null || upper < 0) {
      return null;
    }

    return this.startBurstFromAncestor(left, undefined, upper);
  }

  private maxBurstBeforeRight(
    ancestor: PreparedFuguePath,
    depth: number,
    right: PreparedFuguePosition,
  ) {
    if (isPreparedPositionPrefix(ancestor, right)) {
      const rightBurst = right.bursts[depth];
      if (rightBurst === undefined) {
        return null;
      }

      return rightBurst - 1;
    }

    if (comparePreparedPositions(ancestor, right) < 0) {
      return burstMaxNumberAtDepth(depth);
    }

    return null;
  }

  private chooseBurstToken(minInclusive: number, maxInclusive: number) {
    if (maxInclusive < minInclusive) {
      throw new InvalidRandomSourceError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive;
    if (span < 4) {
      return this.randomBetweenNumber(minInclusive, maxInclusive);
    }

    const slack = Math.floor(span / 4);
    const innerMin = minInclusive + slack;
    const innerMax = maxInclusive - slack;

    return this.randomBetweenNumber(innerMin, innerMax);
  }

  private startBurstAfterPrepared(position: PreparedFuguePosition) {
    const nextTopCoord = nextSequentialTopCoordAfter(
      position.topCoord,
      TOP_COORD_MAX_RIGHT,
    );

    if (nextTopCoord !== null) {
      return FugueBurst.fromPreparedPrefix({
        topCoord: nextTopCoord,
        bursts: [this.randomBurstToken(0)],
        nestedCoords: [],
      });
    }

    if (position.bursts.length < MAX_BURST_DEPTH) {
      return this.startBurstFromAncestor(position);
    }

    const sameTopCoord = this.tryStartAtSameTopCoord(
      position.topCoord,
      position.bursts[0]! + 1,
      burstMaxNumberAtDepth(0),
    );
    if (sameTopCoord !== null) {
      return sameTopCoord;
    }

    throw new BurstSpaceExhaustedError(BURST_DEPTH_EXCEEDED_MESSAGE);
  }

  private startBurstBeforePrepared(position: PreparedFuguePosition) {
    const previousTopCoord = nextSequentialTopCoordBefore(position.topCoord);

    if (previousTopCoord !== null) {
      return FugueBurst.fromPreparedPrefix({
        topCoord: previousTopCoord,
        bursts: [this.randomBurstToken(0)],
        nestedCoords: [],
      });
    }

    if (position.bursts.length < MAX_BURST_DEPTH) {
      return this.startBurstFromAncestor(toPreparedLeftAncestor(position));
    }

    const sameTopCoord = this.tryStartAtSameTopCoord(
      position.topCoord,
      0,
      position.bursts[0]! - 1,
    );
    if (sameTopCoord !== null) {
      return sameTopCoord;
    }

    throw new BurstSpaceExhaustedError(BURST_DEPTH_EXCEEDED_MESSAGE);
  }

  private tryStartAtSameTopCoord(
    topCoord: bigint,
    minBurstInclusive: number,
    maxBurstInclusive: number,
  ) {
    if (minBurstInclusive > maxBurstInclusive) {
      return null;
    }

    return FugueBurst.fromPreparedPrefix({
      topCoord,
      bursts: [this.chooseBurstToken(minBurstInclusive, maxBurstInclusive)],
      nestedCoords: [],
    });
  }

  private prepareBounds(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): [PreparedFuguePosition | null, PreparedFuguePosition | null] {
    const preparedLeft = this.prepareBound(left);
    const preparedRight = this.prepareBound(right);

    if (
      preparedLeft !== null &&
      preparedRight !== null &&
      comparePreparedPositions(preparedLeft, preparedRight) >= 0
    ) {
      throw new InvalidBoundsError(
        `Expected left < right, got ${left} >= ${right}`,
      );
    }

    return [preparedLeft, preparedRight];
  }

  private prepareBound(
    value: FuguePosition | null,
  ): PreparedFuguePosition | null {
    if (value === null) {
      return null;
    }

    return this.preparePosition(value);
  }

  private preparePosition(value: FuguePosition) {
    const cached = this.preparedCache.get(value);
    if (cached !== null) {
      return cached;
    }

    return this.rememberPreparedPosition(preparePosition(value));
  }

  private readonly rememberPreparedPosition = (
    position: PreparedFuguePosition,
  ) => {
    return this.preparedCache.set(position);
  };

  private randomBurstToken(depth: number) {
    return this.randomBetweenNumber(0, burstMaxNumberAtDepth(depth));
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

  private randomBelowNumber(limit: number) {
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
      const bytes = this.randomBytes(byteLength);
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

  randomBetween(minInclusive: bigint, maxInclusive: bigint) {
    if (maxInclusive < minInclusive) {
      throw new InvalidRandomSourceError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive + 1n;
    const offset = this.randomBelow(span);
    return minInclusive + offset;
  }

  private randomBetweenNumber(minInclusive: number, maxInclusive: number) {
    if (maxInclusive < minInclusive) {
      throw new InvalidRandomSourceError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive + 1;
    const offset = this.randomBelowNumber(span);
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
      for (let index = 0; index < byteLength; index++) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      return bytes;
    }

    throw new SecureRandomUnavailableError(
      "No secure random source found. Provide options.randomBytes, enable globalThis.crypto.getRandomValues, or set allowInsecureRandom: true.",
    );
  }
}
