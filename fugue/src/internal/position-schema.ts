import { InvalidPositionError } from "../errors";

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

export function toSafeInteger(value: bigint, label: string) {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new InvalidPositionError(
      `${label} must fit in a safe integer, got ${value}`,
    );
  }

  return converted;
}

export const TOP_BURST_MAX_NUMBER = toSafeInteger(
  TOP_BURST_MAX,
  "TOP_BURST_MAX",
);
export const NESTED_COORD_MAX_NUMBER = toSafeInteger(
  NESTED_COORD_MAX,
  "NESTED_COORD_MAX",
);
export const NESTED_BURST_MAX_NUMBER = toSafeInteger(
  NESTED_BURST_MAX,
  "NESTED_BURST_MAX",
);

export const COORD_STRIDE = 1n << 16n;

export function highestOdd(maxValue: bigint) {
  return maxValue % 2n === 1n ? maxValue : maxValue - 1n;
}

export function midpointOdd(maxValue: bigint) {
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
export const NESTED_COORD_MAX_RIGHT_NUMBER = toSafeInteger(
  NESTED_COORD_MAX_RIGHT,
  "NESTED_COORD_MAX_RIGHT",
);
export const NESTED_COORD_MID_NUMBER = toSafeInteger(
  NESTED_COORD_MID,
  "NESTED_COORD_MID",
);

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
