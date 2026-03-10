import { encode62, parseBase62FixedWidth } from "./codec";
import { InvalidPositionError, InvalidRunPrefixError } from "./errors";

export const SEPARATOR = "!";
export const PATH_SEPARATOR = "~";

export const ANCHOR_BITS = 64;
export const RUN_BITS = 96;
export const SLOT_BITS = 64;

export const ANCHOR_WIDTH = 11;
export const RUN_WIDTH = 17;
export const SLOT_WIDTH = 11;

export const MAX_ANCHOR_PATH_DEPTH = 64;
export const MAX_SLOT_PATH_DEPTH = 64;

export const ANCHOR_MIN = 0n;
export const ANCHOR_MAX = (1n << BigInt(ANCHOR_BITS)) - 1n;
export const ANCHOR_MID = 1n << BigInt(ANCHOR_BITS - 1);

export const RUN_MIN = 0n;
export const RUN_MAX = (1n << BigInt(RUN_BITS)) - 1n;

export const SLOT_MIN = 0n;
export const SLOT_MAX = (1n << BigInt(SLOT_BITS)) - 1n;
export const SLOT_MID = 1n << BigInt(SLOT_BITS - 1);

const MIN_POSITION_LENGTH = ANCHOR_WIDTH + RUN_WIDTH + SLOT_WIDTH + 2;
const MAX_ANCHOR_PATH_LENGTH =
  MAX_ANCHOR_PATH_DEPTH * ANCHOR_WIDTH + (MAX_ANCHOR_PATH_DEPTH - 1);
const MAX_SLOT_PATH_LENGTH =
  MAX_SLOT_PATH_DEPTH * SLOT_WIDTH + (MAX_SLOT_PATH_DEPTH - 1);
const MAX_POSITION_LENGTH =
  MAX_ANCHOR_PATH_LENGTH + RUN_WIDTH + MAX_SLOT_PATH_LENGTH + 2;

declare const fuguePositionBrand: unique symbol;
declare const fugueRunPrefixBrand: unique symbol;

export type FuguePosition =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;

export type FugueRunPrefix = `${string}${typeof SEPARATOR}${string}`;

export type ParsedFuguePosition = Readonly<{
  anchorPath: readonly bigint[];
  runId: bigint;
  slotPath: readonly bigint[];
}>;

export type ParsedFugueRunPrefix = Readonly<{
  anchorPath: readonly bigint[];
  runId: bigint;
}>;

function assertRange(
  value: bigint,
  min: bigint,
  max: bigint,
  message: string,
  ErrorType: typeof InvalidPositionError | typeof InvalidRunPrefixError,
) {
  if (value < min || value > max) {
    throw new ErrorType(message);
  }
}

function parsePathInternal(
  value: string,
  width: number,
  maxAllowed: bigint,
  maxDepth: number,
) {
  if (
    value.length < width ||
    value.length > maxDepth * width + (maxDepth - 1)
  ) {
    return null;
  }

  const encodedSegments = value.split(PATH_SEPARATOR);
  if (encodedSegments.length > maxDepth) {
    return null;
  }

  const path: bigint[] = [];
  for (const segment of encodedSegments) {
    const parsed = parseBase62FixedWidth(segment, width, maxAllowed);
    if (parsed === null) {
      return null;
    }

    path.push(parsed);
  }

  return path;
}

function assertPath(
  path: readonly bigint[],
  min: bigint,
  max: bigint,
  maxDepth: number,
  pathName: string,
  segmentName: string,
  ErrorType: typeof InvalidPositionError | typeof InvalidRunPrefixError,
) {
  if (path.length === 0) {
    throw new ErrorType(`${pathName} must contain at least 1 segment`);
  }

  if (path.length > maxDepth) {
    throw new ErrorType(
      `${pathName} depth must be <= ${maxDepth}, got ${path.length}`,
    );
  }

  for (const segment of path) {
    assertRange(
      segment,
      min,
      max,
      `${segmentName} must be in [${min}, ${max}], got ${segment}`,
      ErrorType,
    );
  }
}

function formatPath(
  path: readonly bigint[],
  width: number,
  min: bigint,
  max: bigint,
  maxDepth: number,
  pathName: string,
  segmentName: string,
  ErrorType: typeof InvalidPositionError | typeof InvalidRunPrefixError,
) {
  assertPath(path, min, max, maxDepth, pathName, segmentName, ErrorType);
  return path.map((segment) => encode62(segment, width)).join(PATH_SEPARATOR);
}

function parsePositionInternal(value: string): ParsedFuguePosition | null {
  if (
    value.length < MIN_POSITION_LENGTH ||
    value.length > MAX_POSITION_LENGTH
  ) {
    return null;
  }

  const split = value.split(SEPARATOR);
  if (split.length !== 3) {
    return null;
  }

  const [anchorPathEncoded, runIdEncoded, slotPathEncoded] = split as [
    string,
    string,
    string,
  ];

  const anchorPath = parsePathInternal(
    anchorPathEncoded,
    ANCHOR_WIDTH,
    ANCHOR_MAX,
    MAX_ANCHOR_PATH_DEPTH,
  );
  if (anchorPath === null) {
    return null;
  }

  const runId = parseBase62FixedWidth(runIdEncoded, RUN_WIDTH, RUN_MAX);
  if (runId === null) {
    return null;
  }

  const slotPath = parsePathInternal(
    slotPathEncoded,
    SLOT_WIDTH,
    SLOT_MAX,
    MAX_SLOT_PATH_DEPTH,
  );
  if (slotPath === null) {
    return null;
  }

  return { anchorPath, runId, slotPath };
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
      `Invalid position "${value}". Expected format ${ANCHOR_WIDTH}b62[~${ANCHOR_WIDTH}b62...]!${RUN_WIDTH}b62!${SLOT_WIDTH}b62[~${SLOT_WIDTH}b62...]`,
    );
  }

  return parsed;
}

export function formatPosition(position: ParsedFuguePosition): FuguePosition {
  const { anchorPath, runId, slotPath } = position;

  const encodedAnchorPath = formatPath(
    anchorPath,
    ANCHOR_WIDTH,
    ANCHOR_MIN,
    ANCHOR_MAX,
    MAX_ANCHOR_PATH_DEPTH,
    "anchorPath",
    "anchor segment",
    InvalidPositionError,
  );
  assertRange(
    runId,
    RUN_MIN,
    RUN_MAX,
    `runId must be in [${RUN_MIN}, ${RUN_MAX}], got ${runId}`,
    InvalidPositionError,
  );
  const encodedSlotPath = formatPath(
    slotPath,
    SLOT_WIDTH,
    SLOT_MIN,
    SLOT_MAX,
    MAX_SLOT_PATH_DEPTH,
    "slotPath",
    "slot segment",
    InvalidPositionError,
  );

  return `${encodedAnchorPath}${SEPARATOR}${encode62(runId, RUN_WIDTH)}${SEPARATOR}${encodedSlotPath}` as const;
}

function parseRunPrefixInternal(prefix: string): ParsedFugueRunPrefix | null {
  if (prefix.length < ANCHOR_WIDTH + RUN_WIDTH + 2) {
    return null;
  }

  const split = prefix.split(SEPARATOR);
  if (split.length !== 2) {
    return null;
  }

  const [anchorPathEncoded, runIdEncoded] = split as [string, string];

  const anchorPath = parsePathInternal(
    anchorPathEncoded,
    ANCHOR_WIDTH,
    ANCHOR_MAX,
    MAX_ANCHOR_PATH_DEPTH,
  );
  const runId = parseBase62FixedWidth(runIdEncoded, RUN_WIDTH, RUN_MAX);

  if (anchorPath === null || runId === null) {
    return null;
  }

  return { anchorPath, runId };
}

export function tryParseRunPrefix(prefix: string): ParsedFugueRunPrefix | null {
  return parseRunPrefixInternal(prefix);
}

export function isFugueRunPrefix(value: string): value is FugueRunPrefix {
  return tryParseRunPrefix(value) !== null;
}

export function parseRunPrefix(prefix: string): ParsedFugueRunPrefix {
  const parsed = tryParseRunPrefix(prefix);
  if (parsed === null) {
    throw new InvalidRunPrefixError(
      `Invalid run prefix "${prefix}". Expected format ${ANCHOR_WIDTH}b62[~${ANCHOR_WIDTH}b62...]!${RUN_WIDTH}b62!`,
    );
  }

  return parsed;
}

export function formatRunPrefix(prefix: ParsedFugueRunPrefix): FugueRunPrefix {
  const encodedAnchorPath = formatPath(
    prefix.anchorPath,
    ANCHOR_WIDTH,
    ANCHOR_MIN,
    ANCHOR_MAX,
    MAX_ANCHOR_PATH_DEPTH,
    "anchorPath",
    "anchor segment",
    InvalidRunPrefixError,
  );
  assertRange(
    prefix.runId,
    RUN_MIN,
    RUN_MAX,
    `runId must be in [${RUN_MIN}, ${RUN_MAX}], got ${prefix.runId}`,
    InvalidRunPrefixError,
  );

  return `${encodedAnchorPath}${SEPARATOR}${encode62(prefix.runId, RUN_WIDTH)}` as const;
}

export function getRunPrefix(position: FuguePosition): FugueRunPrefix {
  const parsed = parsePosition(position);
  return formatRunPrefix({
    anchorPath: parsed.anchorPath,
    runId: parsed.runId,
  });
}

export function comparePaths(
  left: readonly bigint[],
  right: readonly bigint[],
) {
  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index++) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;

    if (leftValue < rightValue) {
      return -1;
    }

    if (leftValue > rightValue) {
      return 1;
    }
  }

  if (left.length < right.length) {
    return -1;
  }

  if (left.length > right.length) {
    return 1;
  }

  return 0;
}

export function compareRunPrefixes(
  a: ParsedFugueRunPrefix,
  b: ParsedFugueRunPrefix,
) {
  const path = comparePaths(a.anchorPath, b.anchorPath);
  if (path !== 0) {
    return path;
  }

  if (a.runId < b.runId) {
    return -1;
  }

  if (a.runId > b.runId) {
    return 1;
  }

  return 0;
}

export function comparePositions(
  a: ParsedFuguePosition,
  b: ParsedFuguePosition,
) {
  const prefix = compareRunPrefixes(a, b);
  if (prefix !== 0) {
    return prefix;
  }

  return comparePaths(a.slotPath, b.slotPath);
}

export function isSameRun(a: ParsedFuguePosition, b: ParsedFuguePosition) {
  return comparePaths(a.anchorPath, b.anchorPath) === 0 && a.runId === b.runId;
}
