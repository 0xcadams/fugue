import { encode62, parseBase62FixedWidth } from "./codec";
import { InvalidPositionError } from "./errors";

export const SEPARATOR = "!";

export const TOP_COORD_WIDTH = 11;
export const TOP_BURST_WIDTH = 6;
export const NESTED_COORD_WIDTH = 6;
export const NESTED_BURST_WIDTH = 5;

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

export const BURST_ID_MAX = NESTED_BURST_MAX;

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

export type FuguePosition =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;

export type ParsedFuguePosition = Readonly<{
  coords: readonly bigint[];
  bursts: readonly bigint[];
}>;

function assertRange(value: bigint, min: bigint, max: bigint, message: string) {
  if (value < min || value > max) {
    throw new InvalidPositionError(message);
  }
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

export function isRightCoord(coord: bigint) {
  return coord % 2n === 1n;
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

function parsePositionInternal(value: string): ParsedFuguePosition | null {
  const tokens = value.split(SEPARATOR);
  if (tokens.length < 3 || tokens.length % 2 === 0) {
    return null;
  }

  const burstDepth = (tokens.length - 1) >> 1;
  if (burstDepth > MAX_BURST_DEPTH) {
    return null;
  }

  const coords: bigint[] = [];
  const bursts: bigint[] = [];

  const firstCoord = parseBase62FixedWidth(
    tokens[0]!,
    TOP_COORD_WIDTH,
    TOP_COORD_MAX,
  );
  if (firstCoord === null) {
    return null;
  }
  coords.push(firstCoord);

  for (let depth = 0; depth < burstDepth; depth++) {
    const burstToken = tokens[depth * 2 + 1]!;
    const coordToken = tokens[depth * 2 + 2]!;

    const burst = parseBase62FixedWidth(
      burstToken,
      burstWidthAtDepth(depth),
      burstMaxAtDepth(depth),
    );
    if (burst === null) {
      return null;
    }

    const coord = parseBase62FixedWidth(
      coordToken,
      coordWidthAtDepth(depth + 1),
      coordMaxAtDepth(depth + 1),
    );
    if (coord === null) {
      return null;
    }

    bursts.push(burst);
    coords.push(coord);
  }

  if (!isRightCoord(coords[coords.length - 1]!)) {
    return null;
  }

  return { coords, bursts };
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
