import { decodeBase62FixedWidthAt, encode62 } from "./codec";
import { InvalidPositionError } from "./errors";
import {
  comparePreparedPositions,
  formatPreparedPosition as formatPreparedPositionImpl,
  formatPreparedPositionUnchecked as formatPreparedPositionUncheckedImpl,
  isPreparedPositionPrefix,
  toPreparedLeftAncestor,
  type PreparedPathView,
} from "./internal/prepared-path";
import {
  COORD_STRIDE,
  MAX_BURST_DEPTH,
  NESTED_BURST_MAX,
  NESTED_BURST_MAX_NUMBER,
  NESTED_BURST_WIDTH,
  NESTED_COORD_MAX,
  NESTED_COORD_MAX_NUMBER,
  NESTED_COORD_MAX_RIGHT,
  NESTED_COORD_MAX_RIGHT_NUMBER,
  NESTED_COORD_MID,
  NESTED_COORD_MID_NUMBER,
  NESTED_COORD_WIDTH,
  SEPARATOR,
  TOP_BURST_MAX,
  TOP_BURST_MAX_NUMBER,
  TOP_BURST_WIDTH,
  TOP_COORD_MAX,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  TOP_COORD_WIDTH,
  burstMaxAtDepth,
  burstMaxNumberAtDepth,
  burstWidthAtDepth,
  coordMaxAtDepth,
  coordMaxNumberAtDepth,
  coordWidthAtDepth,
  isRightCoord,
  isRightCoordNumber,
  toLeftCoord,
} from "./internal/position-schema";

export {
  COORD_STRIDE,
  MAX_BURST_DEPTH,
  NESTED_BURST_MAX,
  NESTED_BURST_MAX_NUMBER,
  NESTED_BURST_WIDTH,
  NESTED_COORD_MAX,
  NESTED_COORD_MAX_NUMBER,
  NESTED_COORD_MAX_RIGHT,
  NESTED_COORD_MAX_RIGHT_NUMBER,
  NESTED_COORD_MID,
  NESTED_COORD_MID_NUMBER,
  NESTED_COORD_WIDTH,
  SEPARATOR,
  TOP_BURST_MAX,
  TOP_BURST_MAX_NUMBER,
  TOP_BURST_WIDTH,
  TOP_COORD_MAX,
  TOP_COORD_MAX_RIGHT,
  TOP_COORD_MID,
  TOP_COORD_WIDTH,
  burstMaxAtDepth,
  burstMaxNumberAtDepth,
  burstWidthAtDepth,
  comparePreparedPositions,
  coordMaxAtDepth,
  coordMaxNumberAtDepth,
  coordWidthAtDepth,
  isPreparedPositionPrefix,
  isRightCoord,
  isRightCoordNumber,
  toLeftCoord,
  toPreparedLeftAncestor,
};

export type FuguePosition =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;

export type ParsedFuguePosition = Readonly<{
  coords: readonly bigint[];
  bursts: readonly bigint[];
}>;

export type PreparedFuguePath = PreparedPathView;

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
  const topCoord = decodeBase62FixedWidthAt(
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
      return decodeBase62FixedWidthAt(
        source,
        offset,
        burstWidthAtDepth(depth),
        burstMaxAtDepth(depth),
      );
    },
    (source, offset, depth) => {
      return decodeBase62FixedWidthAt(
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
      return decodeBase62FixedWidthAt(
        source,
        offset,
        burstWidthAtDepth(depth),
        burstMaxNumberAtDepth(depth),
      );
    },
    (source, offset, depth) => {
      return decodeBase62FixedWidthAt(
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
  return formatPreparedPositionImpl(position) as FuguePosition;
}

export function formatPreparedPositionUnchecked(
  position: PreparedFuguePath,
): FuguePosition {
  return formatPreparedPositionUncheckedImpl(position) as FuguePosition;
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
