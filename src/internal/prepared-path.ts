import { encode62, encode62Number } from "../codec";
import { InvalidPositionError } from "../errors";
import {
  MAX_BURST_DEPTH,
  SEPARATOR,
  TOP_COORD_MAX,
  TOP_COORD_WIDTH,
  burstMaxNumberAtDepth,
  burstWidthAtDepth,
  coordMaxNumberAtDepth,
  coordWidthAtDepth,
  isRightCoordNumber,
} from "./position-schema";

export type PreparedPathView = Readonly<{
  topCoord: bigint;
  bursts: readonly number[];
  nestedCoords: readonly number[];
  finalCoord: number;
  depth: number;
}>;

export type PreparedPositionSnapshot = Readonly<
  PreparedPathView & {
    text: string;
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

export function preparedCoordAt(
  position: PreparedPathView,
  depthIndex: number,
) {
  return depthIndex < position.depth - 1
    ? position.nestedCoords[depthIndex]!
    : position.finalCoord;
}

export function comparePreparedPathSlices(
  left: PreparedPathView,
  leftDepth: number,
  right: PreparedPathView,
  rightDepth = right.depth,
) {
  if (left.topCoord < right.topCoord) {
    return -1;
  }

  if (left.topCoord > right.topCoord) {
    return 1;
  }

  const sharedDepth = Math.min(leftDepth, rightDepth);
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

  if (leftDepth < rightDepth) {
    return -1;
  }

  if (leftDepth > rightDepth) {
    return 1;
  }

  return 0;
}

export function isPreparedPathPrefix(
  prefix: PreparedPathView,
  prefixDepth: number,
  value: PreparedPathView,
  valueDepth = value.depth,
) {
  if (prefix.topCoord !== value.topCoord || prefixDepth > valueDepth) {
    return false;
  }

  for (let depth = 0; depth < prefixDepth; depth++) {
    if (
      prefix.bursts[depth] !== value.bursts[depth] ||
      preparedCoordAt(prefix, depth) !== preparedCoordAt(value, depth)
    ) {
      return false;
    }
  }

  return true;
}

export function comparePreparedPositions(
  left: PreparedPathView,
  right: PreparedPathView,
) {
  return comparePreparedPathSlices(left, left.depth, right, right.depth);
}

export function isPreparedPositionPrefix(
  prefix: PreparedPathView,
  value: PreparedPathView,
) {
  return isPreparedPathPrefix(prefix, prefix.depth, value, value.depth);
}

export function nestedCoordsForBurstDepth(
  position: PreparedPathView,
  depth: number,
): readonly number[] {
  if (depth < 0 || depth > position.depth) {
    throw new InvalidPositionError(
      `depth must be in [0, ${position.depth}], got ${depth}`,
    );
  }

  if (depth === 0) {
    return [];
  }

  if (depth < position.depth) {
    return position.nestedCoords.slice(0, depth);
  }

  return [...position.nestedCoords, position.finalCoord];
}

export function toPreparedLeftAncestor(
  position: PreparedPathView,
): PreparedPathView {
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

export function formatPreparedPosition(position: PreparedPathView): string {
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

  for (let depthIndex = 0; depthIndex < depth; depthIndex++) {
    assertNumberRange(
      bursts[depthIndex]!,
      0,
      burstMaxNumberAtDepth(depthIndex),
      `burst at depth ${depthIndex} must be in [0, ${burstMaxNumberAtDepth(depthIndex)}], got ${bursts[depthIndex]!}`,
    );
    assertNumberRange(
      preparedCoordAt(position, depthIndex),
      0,
      coordMaxNumberAtDepth(depthIndex + 1),
      `coord at depth ${depthIndex + 1} must be in [0, ${coordMaxNumberAtDepth(depthIndex + 1)}], got ${preparedCoordAt(position, depthIndex)}`,
    );
  }

  return formatPreparedPositionUnchecked(position);
}

export function formatPreparedPositionUnchecked(
  position: PreparedPathView,
): string {
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

  return tokens.join(SEPARATOR);
}

export function midpointRightCoordBetween(left: number, right: number) {
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
