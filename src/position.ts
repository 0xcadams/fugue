import {
  encode62,
  encode62Number,
  parseBase62FixedWidthAt,
  parseBase62FixedWidthNumberAt,
} from "./codec";
import { InvalidPositionError } from "./errors";

export const SEPARATOR = "!";

export const TOP_COORD_WIDTH = 11;
export const TOP_BURST_WIDTH = 7;
export const NESTED_COORD_WIDTH = 6;
export const NESTED_BURST_WIDTH = 7;

export const MAX_BURST_DEPTH = 64;

const BASE62 = 62n;

function maxForWidth(width: number) {
  let value = 1n;
  for (let index = 0; index < width; index++) {
    value *= BASE62;
  }

  return value - 1n;
}

export const TOP_COORD_MAX = maxForWidth(TOP_COORD_WIDTH);
export const TOP_BURST_MAX = maxForWidth(TOP_BURST_WIDTH);
export const NESTED_COORD_MAX = maxForWidth(NESTED_COORD_WIDTH);
export const NESTED_BURST_MAX = maxForWidth(NESTED_BURST_WIDTH);

function toSafeNumber(value: bigint, label: string) {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new InvalidPositionError(
      `${label} must fit in a safe integer, got ${value}`,
    );
  }

  return converted;
}

export const TOP_BURST_MAX_NUMBER = toSafeNumber(
  TOP_BURST_MAX,
  "TOP_BURST_MAX",
);
export const NESTED_COORD_MAX_NUMBER = toSafeNumber(
  NESTED_COORD_MAX,
  "NESTED_COORD_MAX",
);
export const NESTED_BURST_MAX_NUMBER = toSafeNumber(
  NESTED_BURST_MAX,
  "NESTED_BURST_MAX",
);

export const COORD_STRIDE = 1n << 16n;

function highestOdd(maxValue: bigint) {
  return maxValue % 2n === 1n ? maxValue : maxValue - 1n;
}

function midpointOdd(maxValue: bigint) {
  let value = maxValue / 2n;
  if (value % 2n === 0n) {
    value += 1n;
  }

  if (value > maxValue) {
    value = highestOdd(maxValue);
  }

  if (value % 2n === 0n) {
    value -= 1n;
  }

  return value;
}

export const TOP_COORD_MAX_RIGHT = highestOdd(TOP_COORD_MAX);
export const NESTED_COORD_MAX_RIGHT = highestOdd(NESTED_COORD_MAX);
export const TOP_COORD_MID = midpointOdd(TOP_COORD_MAX);
export const NESTED_COORD_MID = midpointOdd(NESTED_COORD_MAX);
export const NESTED_COORD_MAX_RIGHT_NUMBER = toSafeNumber(
  NESTED_COORD_MAX_RIGHT,
  "NESTED_COORD_MAX_RIGHT",
);
export const NESTED_COORD_MID_NUMBER = toSafeNumber(
  NESTED_COORD_MID,
  "NESTED_COORD_MID",
);

export type FuguePosition =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;

export type ParsedFuguePosition = Readonly<{
  coords: readonly bigint[];
  bursts: readonly bigint[];
}>;

export type PreparedFuguePath = Readonly<{
  topCoord: bigint;
  bursts: readonly number[];
  nestedCoords: readonly number[];
  finalCoord: number;
  depth: number;
}>;

export type PreparedFuguePosition = Readonly<
  PreparedFuguePath & {
    text: FuguePosition;
  }
>;

function assertRange(value: bigint, min: bigint, max: bigint, message: string) {
  if (value < min || value > max) {
    throw new InvalidPositionError(message);
  }
}

function assertNumberRange(
  value: number,
  min: number,
  max: number,
  message: string,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidPositionError(message);
  }
}

function preparedCoordAt(position: PreparedFuguePath, depthIndex: number) {
  return depthIndex < position.depth - 1
    ? position.nestedCoords[depthIndex]!
    : position.finalCoord;
}

export function coordWidthAtDepth(depth: number) {
  return depth === 0 ? TOP_COORD_WIDTH : NESTED_COORD_WIDTH;
}

export function burstWidthAtDepth(depth: number) {
  return depth === 0 ? TOP_BURST_WIDTH : NESTED_BURST_WIDTH;
}

export function coordMaxAtDepth(depth: number) {
  return depth === 0 ? TOP_COORD_MAX : NESTED_COORD_MAX;
}

export function burstMaxAtDepth(depth: number) {
  return depth === 0 ? TOP_BURST_MAX : NESTED_BURST_MAX;
}

export function burstMaxNumberAtDepth(depth: number) {
  return depth === 0 ? TOP_BURST_MAX_NUMBER : NESTED_BURST_MAX_NUMBER;
}

export function coordMaxNumberAtDepth(depth: number) {
  if (depth === 0) {
    throw new InvalidPositionError("top coords do not fit in a safe integer");
  }

  return NESTED_COORD_MAX_NUMBER;
}

export function isRightCoord(coord: bigint) {
  return coord % 2n === 1n;
}

export function isRightCoordNumber(coord: number) {
  return coord % 2 === 1;
}

export function toLeftCoord(coord: bigint) {
  if (!isRightCoord(coord)) {
    throw new InvalidPositionError(`Expected a right-side coord, got ${coord}`);
  }

  return coord - 1n;
}

export function tokenCount(position: ParsedFuguePosition) {
  return position.coords.length + position.bursts.length;
}

function tokenAt(position: ParsedFuguePosition, tokenIndex: number) {
  if (tokenIndex % 2 === 0) {
    return position.coords[tokenIndex >> 1]!;
  }

  return position.bursts[(tokenIndex - 1) >> 1]!;
}

type ScannedPosition<TBurst, TCoord> = {
  topCoord: bigint;
  bursts: TBurst[];
  nestedCoords: TCoord[];
  finalCoord: TCoord;
  depth: number;
};

function scanPosition<TBurst, TCoord>(
  value: string,
  parseBurstAt: (value: string, offset: number, depth: number) => TBurst | null,
  parseCoordAt: (value: string, offset: number, depth: number) => TCoord | null,
  isRightFinalCoord: (coord: TCoord) => boolean,
): ScannedPosition<TBurst, TCoord> | null {
  const topCoord = parseBase62FixedWidthAt(
    value,
    0,
    TOP_COORD_WIDTH,
    TOP_COORD_MAX,
  );
  if (topCoord === null) {
    return null;
  }

  let offset = TOP_COORD_WIDTH;
  if (offset >= value.length || value[offset] !== SEPARATOR) {
    return null;
  }
  offset += SEPARATOR.length;

  const bursts: TBurst[] = [];
  const nestedCoords: TCoord[] = [];

  for (let depth = 0; depth < MAX_BURST_DEPTH; depth++) {
    const burst = parseBurstAt(value, offset, depth);
    if (burst === null) {
      return null;
    }
    offset += burstWidthAtDepth(depth);

    if (offset >= value.length || value[offset] !== SEPARATOR) {
      return null;
    }
    offset += SEPARATOR.length;

    const coord = parseCoordAt(value, offset, depth + 1);
    if (coord === null) {
      return null;
    }
    offset += coordWidthAtDepth(depth + 1);

    bursts.push(burst);

    if (offset === value.length) {
      if (!isRightFinalCoord(coord)) {
        return null;
      }

      return {
        topCoord,
        bursts,
        nestedCoords,
        finalCoord: coord,
        depth: depth + 1,
      };
    }

    if (value[offset] !== SEPARATOR) {
      return null;
    }
    offset += SEPARATOR.length;
    nestedCoords.push(coord);
  }

  return null;
}

function parsePositionInternal(value: string): ParsedFuguePosition | null {
  const scanned = scanPosition(
    value,
    (source, offset, depth) => {
      return parseBase62FixedWidthAt(
        source,
        offset,
        burstWidthAtDepth(depth),
        burstMaxAtDepth(depth),
      );
    },
    (source, offset, depth) => {
      return parseBase62FixedWidthAt(
        source,
        offset,
        coordWidthAtDepth(depth),
        coordMaxAtDepth(depth),
      );
    },
    isRightCoord,
  );
  if (scanned === null) {
    return null;
  }

  return {
    coords: [scanned.topCoord, ...scanned.nestedCoords, scanned.finalCoord],
    bursts: scanned.bursts,
  };
}

function preparePositionInternal(value: string): PreparedFuguePosition | null {
  const scanned = scanPosition(
    value,
    (source, offset, depth) => {
      return parseBase62FixedWidthNumberAt(
        source,
        offset,
        burstWidthAtDepth(depth),
        burstMaxNumberAtDepth(depth),
      );
    },
    (source, offset, depth) => {
      return parseBase62FixedWidthNumberAt(
        source,
        offset,
        coordWidthAtDepth(depth),
        coordMaxNumberAtDepth(depth),
      );
    },
    isRightCoordNumber,
  );
  if (scanned === null) {
    return null;
  }

  return {
    text: value as FuguePosition,
    topCoord: scanned.topCoord,
    bursts: scanned.bursts,
    nestedCoords: scanned.nestedCoords,
    finalCoord: scanned.finalCoord,
    depth: scanned.depth,
  };
}

export function tryParsePosition(value: string): ParsedFuguePosition | null {
  return parsePositionInternal(value);
}

export function isFuguePosition(value: string): value is FuguePosition {
  return tryParsePosition(value) !== null;
}

export function parsePosition(value: string): ParsedFuguePosition {
  const parsed = tryParsePosition(value);
  if (parsed === null) {
    throw new InvalidPositionError(
      `Invalid position "${value}". Expected alternating coord/burst tokens separated by ${SEPARATOR}`,
    );
  }

  return parsed;
}

export function preparePosition(value: FuguePosition): PreparedFuguePosition {
  const prepared = preparePositionInternal(value);
  if (prepared === null) {
    throw new InvalidPositionError(
      `Invalid position "${value}". Expected alternating coord/burst tokens separated by ${SEPARATOR}`,
    );
  }

  return prepared;
}

export function formatPosition(position: ParsedFuguePosition): FuguePosition {
  const { coords, bursts } = position;

  if (bursts.length === 0) {
    throw new InvalidPositionError("positions must contain at least 1 burst");
  }

  if (coords.length !== bursts.length + 1) {
    throw new InvalidPositionError(
      `positions must satisfy coords.length = bursts.length + 1, got ${coords.length} coords and ${bursts.length} bursts`,
    );
  }

  if (bursts.length > MAX_BURST_DEPTH) {
    throw new InvalidPositionError(
      `burst depth must be <= ${MAX_BURST_DEPTH}, got ${bursts.length}`,
    );
  }

  if (!isRightCoord(coords[coords.length - 1]!)) {
    throw new InvalidPositionError("final coord must be right-sided (odd)");
  }

  const tokens = [encode62(coords[0]!, TOP_COORD_WIDTH)];

  for (let depth = 0; depth < bursts.length; depth++) {
    const burst = bursts[depth]!;
    const coord = coords[depth + 1]!;

    assertRange(
      burst,
      0n,
      burstMaxAtDepth(depth),
      `burst at depth ${depth} must be in [0, ${burstMaxAtDepth(depth)}], got ${burst}`,
    );
    assertRange(
      coord,
      0n,
      coordMaxAtDepth(depth + 1),
      `coord at depth ${depth + 1} must be in [0, ${coordMaxAtDepth(depth + 1)}], got ${coord}`,
    );

    tokens.push(encode62(burst, burstWidthAtDepth(depth)));
    tokens.push(encode62(coord, coordWidthAtDepth(depth + 1)));
  }

  return tokens.join(SEPARATOR) as FuguePosition;
}

export function formatPreparedPosition(
  position: PreparedFuguePath,
): FuguePosition {
  const { topCoord, bursts, nestedCoords, depth, finalCoord } = position;

  if (depth === 0) {
    throw new InvalidPositionError("positions must contain at least 1 burst");
  }

  if (bursts.length < depth || nestedCoords.length < depth - 1) {
    throw new InvalidPositionError(
      `prepared positions must satisfy bursts.length >= depth and nestedCoords.length >= depth - 1, got depth ${depth}, ${nestedCoords.length} nested coords, and ${bursts.length} bursts`,
    );
  }

  if (depth > MAX_BURST_DEPTH) {
    throw new InvalidPositionError(
      `burst depth must be <= ${MAX_BURST_DEPTH}, got ${depth}`,
    );
  }

  assertRange(
    topCoord,
    0n,
    TOP_COORD_MAX,
    `top coord must be in [0, ${TOP_COORD_MAX}], got ${topCoord}`,
  );

  if (!isRightCoordNumber(finalCoord)) {
    throw new InvalidPositionError("final coord must be right-sided (odd)");
  }

  for (let index = 0; index < depth; index++) {
    assertNumberRange(
      bursts[index]!,
      0,
      burstMaxNumberAtDepth(index),
      `burst at depth ${index} must be in [0, ${burstMaxNumberAtDepth(index)}], got ${bursts[index]!}`,
    );
    assertNumberRange(
      preparedCoordAt(position, index),
      0,
      coordMaxNumberAtDepth(index + 1),
      `coord at depth ${index + 1} must be in [0, ${coordMaxNumberAtDepth(index + 1)}], got ${preparedCoordAt(position, index)}`,
    );
  }

  return formatPreparedPositionUnchecked(position);
}

export function formatPreparedPositionUnchecked(
  position: PreparedFuguePath,
): FuguePosition {
  const tokens = [encode62(position.topCoord, TOP_COORD_WIDTH)];

  for (let depth = 0; depth < position.depth; depth++) {
    tokens.push(
      encode62Number(position.bursts[depth]!, burstWidthAtDepth(depth)),
    );
    tokens.push(
      encode62Number(
        preparedCoordAt(position, depth),
        coordWidthAtDepth(depth + 1),
      ),
    );
  }

  return tokens.join(SEPARATOR) as FuguePosition;
}

export function comparePositions(
  left: ParsedFuguePosition,
  right: ParsedFuguePosition,
) {
  const sharedLength = Math.min(tokenCount(left), tokenCount(right));

  for (let index = 0; index < sharedLength; index++) {
    const leftToken = tokenAt(left, index);
    const rightToken = tokenAt(right, index);

    if (leftToken < rightToken) {
      return -1;
    }

    if (leftToken > rightToken) {
      return 1;
    }
  }

  if (tokenCount(left) < tokenCount(right)) {
    return -1;
  }

  if (tokenCount(left) > tokenCount(right)) {
    return 1;
  }

  return 0;
}

export function comparePreparedPositions(
  left: PreparedFuguePath,
  right: PreparedFuguePath,
) {
  if (left.topCoord < right.topCoord) {
    return -1;
  }

  if (left.topCoord > right.topCoord) {
    return 1;
  }

  const sharedDepth = Math.min(left.depth, right.depth);
  for (let depth = 0; depth < sharedDepth; depth++) {
    const leftBurst = left.bursts[depth]!;
    const rightBurst = right.bursts[depth]!;
    if (leftBurst < rightBurst) {
      return -1;
    }

    if (leftBurst > rightBurst) {
      return 1;
    }

    const leftCoord = preparedCoordAt(left, depth);
    const rightCoord = preparedCoordAt(right, depth);
    if (leftCoord < rightCoord) {
      return -1;
    }

    if (leftCoord > rightCoord) {
      return 1;
    }
  }

  if (left.depth < right.depth) {
    return -1;
  }

  if (left.depth > right.depth) {
    return 1;
  }

  return 0;
}

export function isPositionPrefix(
  prefix: ParsedFuguePosition,
  value: ParsedFuguePosition,
) {
  if (tokenCount(prefix) > tokenCount(value)) {
    return false;
  }

  for (let index = 0; index < tokenCount(prefix); index++) {
    if (tokenAt(prefix, index) !== tokenAt(value, index)) {
      return false;
    }
  }

  return true;
}

export function isPreparedPositionPrefix(
  prefix: PreparedFuguePath,
  value: PreparedFuguePath,
) {
  if (prefix.topCoord !== value.topCoord || prefix.depth > value.depth) {
    return false;
  }

  for (let depth = 0; depth < prefix.depth; depth++) {
    if (
      prefix.bursts[depth] !== value.bursts[depth] ||
      preparedCoordAt(prefix, depth) !== preparedCoordAt(value, depth)
    ) {
      return false;
    }
  }

  return true;
}

export function toLeftAncestor(
  position: ParsedFuguePosition,
): ParsedFuguePosition {
  const coords = [...position.coords];
  coords[coords.length - 1] = toLeftCoord(coords[coords.length - 1]!);
  return {
    coords,
    bursts: [...position.bursts],
  };
}

export function toPreparedLeftAncestor(
  position: PreparedFuguePath,
): PreparedFuguePath {
  if (!isRightCoordNumber(position.finalCoord)) {
    throw new InvalidPositionError(
      `Expected a right-side coord, got ${position.finalCoord}`,
    );
  }

  return {
    topCoord: position.topCoord,
    bursts: position.bursts,
    nestedCoords: position.nestedCoords,
    finalCoord: position.finalCoord - 1,
    depth: position.depth,
  };
}
