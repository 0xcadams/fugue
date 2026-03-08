export const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SEPARATOR = "!";

export const ANCHOR_BITS = 64;
export const RUN_BITS = 96;
export const SLOT_BITS = 64;

export const ANCHOR_WIDTH = 11;
export const RUN_WIDTH = 17;
export const SLOT_WIDTH = 11;
export const MAX_SUBSLOTS = 64;

export const SLOT_MIN = 0n;
export const SLOT_MAX = (1n << BigInt(SLOT_BITS)) - 1n;
export const SLOT_MID = 1n << BigInt(SLOT_BITS - 1);
export const SLOT_STEP_DEFAULT = 1n << 48n;

const ANCHOR_MIN = 0n;
const ANCHOR_MAX = (1n << BigInt(ANCHOR_BITS)) - 1n;
const RUN_MIN = 0n;
const RUN_MAX = (1n << BigInt(RUN_BITS)) - 1n;
const BASE62 = BigInt(DIGITS.length);
const POSITION_COMPONENT_COUNT = 3;
const MAX_POSITION_COMPONENT_COUNT = POSITION_COMPONENT_COUNT + MAX_SUBSLOTS;
const MIN_POSITION_LENGTH = ANCHOR_WIDTH + RUN_WIDTH + SLOT_WIDTH + 2;
const MAX_POSITION_LENGTH =
  MIN_POSITION_LENGTH + MAX_SUBSLOTS * (SLOT_WIDTH + 1);
const MAX_RANDOM_REJECTION_ATTEMPTS = 128;

const DIGIT_TO_VALUE = new Map<string, number>();
for (let i = 0; i < DIGITS.length; i++) {
  const digit = DIGITS[i];
  if (digit !== undefined) {
    DIGIT_TO_VALUE.set(digit, i);
  }
}

const defaultWarning = (message: string) => {
  console.warn(message);
};

type FuguePositionString =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;
type FugueRunPrefixString =
  `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}`;

declare const fuguePositionBrand: unique symbol;
declare const fugueRunPrefixBrand: unique symbol;

export type FuguePosition = FuguePositionString & {
  readonly [fuguePositionBrand]: true;
};

export type FugueRunPrefix = FugueRunPrefixString & {
  readonly [fugueRunPrefixBrand]: true;
};

export type ParsedFuguePosition = Readonly<{
  anchor: bigint;
  runId: bigint;
  slot: bigint;
  subslots?: readonly bigint[];
}>;

export type ParsedFugueRunPrefix = Readonly<{
  anchor: bigint;
  runId: bigint;
}>;

export type FugueRandomBytes = (byteLength: number) => Uint8Array;

export type FugueOptions = {
  randomBytes?: FugueRandomBytes;
  allowInsecureRandom?: boolean;
  onWarning?: (message: string) => void;
  slotStep?: bigint;
};

export class InvalidPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPositionError";
  }
}

export class SlotExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotExhaustedError";
  }
}

export class RunPrefixExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunPrefixExhaustedError";
  }
}

export class SecureRandomUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureRandomUnavailableError";
  }
}

function maxBigInt(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function minBigInt(a: bigint, b: bigint) {
  return a < b ? a : b;
}

function assertRange(
  value: bigint,
  min: bigint,
  max: bigint,
  fieldName: string,
) {
  if (value < min || value > max) {
    throw new RangeError(
      `${fieldName} must be in [${min}, ${max}], got ${value}`,
    );
  }
}

function assertPositiveStep(step: bigint) {
  if (step <= 0n) {
    throw new RangeError(`slotStep must be > 0, got ${step}`);
  }

  if (step > SLOT_MAX) {
    throw new RangeError(`slotStep must be <= ${SLOT_MAX}, got ${step}`);
  }
}

function compareRunPrefixes(a: ParsedFugueRunPrefix, b: ParsedFugueRunPrefix) {
  if (a.anchor < b.anchor) {
    return -1;
  }

  if (a.anchor > b.anchor) {
    return 1;
  }

  if (a.runId < b.runId) {
    return -1;
  }

  if (a.runId > b.runId) {
    return 1;
  }

  return 0;
}

function comparePositions(a: ParsedFuguePosition, b: ParsedFuguePosition) {
  const prefix = compareRunPrefixes(a, b);
  if (prefix !== 0) {
    return prefix;
  }

  return compareSlotPaths(getSlotPath(a), getSlotPath(b));
}

function isSameRun(a: ParsedFuguePosition, b: ParsedFuguePosition) {
  return a.anchor === b.anchor && a.runId === b.runId;
}

function getSlotPath(position: ParsedFuguePosition) {
  const path = [position.slot];

  if (position.subslots !== undefined) {
    path.push(...position.subslots);
  }

  return path;
}

function compareSlotPaths(left: readonly bigint[], right: readonly bigint[]) {
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

function formatPositionFromSlotPath(
  anchor: bigint,
  runId: bigint,
  slotPath: readonly bigint[],
) {
  const slot = slotPath[0]!;
  const subslots = slotPath.slice(1);

  if (subslots.length === 0) {
    return formatPosition({ anchor, runId, slot });
  }

  return formatPosition({
    anchor,
    runId,
    slot,
    subslots,
  });
}

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

function parseBase62FixedWidth(
  value: string,
  width: number,
  maxAllowed: bigint,
): bigint | null {
  if (value.length !== width) {
    return null;
  }

  let out = 0n;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;

    const digit = DIGIT_TO_VALUE.get(char);
    if (digit === undefined) {
      return null;
    }

    out = out * BASE62 + BigInt(digit);
  }

  if (out > maxAllowed) {
    return null;
  }

  return out;
}

function parsePositionInternal(value: string): ParsedFuguePosition | null {
  if (
    value.length < MIN_POSITION_LENGTH ||
    value.length > MAX_POSITION_LENGTH
  ) {
    return null;
  }

  const [anchorEncoded, runIdEncoded, slotEncoded, ...subslotEncoded] =
    value.split(SEPARATOR);

  if (
    subslotEncoded.length + POSITION_COMPONENT_COUNT >
    MAX_POSITION_COMPONENT_COUNT
  ) {
    return null;
  }

  if (
    anchorEncoded === undefined ||
    runIdEncoded === undefined ||
    slotEncoded === undefined
  ) {
    return null;
  }

  const anchor = parseBase62FixedWidth(anchorEncoded, ANCHOR_WIDTH, ANCHOR_MAX);
  if (anchor === null) {
    return null;
  }

  const runId = parseBase62FixedWidth(runIdEncoded, RUN_WIDTH, RUN_MAX);
  if (runId === null) {
    return null;
  }

  const slot = parseBase62FixedWidth(slotEncoded, SLOT_WIDTH, SLOT_MAX);
  if (slot === null) {
    return null;
  }

  const subslots: bigint[] = [];
  for (const encodedSubslot of subslotEncoded) {
    const subslot = parseBase62FixedWidth(encodedSubslot, SLOT_WIDTH, SLOT_MAX);
    if (subslot === null) {
      return null;
    }

    subslots.push(subslot);
  }

  if (subslots.length === 0) {
    return { anchor, runId, slot };
  }

  return { anchor, runId, slot, subslots };
}

export function encode62(value: bigint, width: number) {
  if (width <= 0) {
    throw new RangeError(`width must be > 0, got ${width}`);
  }

  if (value < 0n) {
    throw new RangeError(`value must be >= 0, got ${value}`);
  }

  let out = "";
  let rest = value;

  while (rest > 0n) {
    const digit = Number(rest % BASE62);
    out = DIGITS[digit]! + out;
    rest /= BASE62;
  }

  if (out.length === 0) {
    out = "0";
  }

  if (out.length > width) {
    throw new RangeError(
      `value ${value} cannot be encoded in width ${width} (needs ${out.length})`,
    );
  }

  return out.padStart(width, "0");
}

export function decode62(value: string) {
  let out = 0n;

  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;

    const digit = DIGIT_TO_VALUE.get(char);
    if (digit === undefined) {
      throw new InvalidPositionError(`Invalid base62 character \"${char}\"`);
    }

    out = out * BASE62 + BigInt(digit);
  }

  return out;
}

export function isFuguePosition(value: string): value is FuguePosition {
  return parsePositionInternal(value) !== null;
}

export function parsePosition(value: string): ParsedFuguePosition {
  const parsed = parsePositionInternal(value);
  if (parsed === null) {
    throw new InvalidPositionError(
      `Invalid position \"${value}\". Expected format ${ANCHOR_WIDTH}b62!${RUN_WIDTH}b62!${SLOT_WIDTH}b62[!${SLOT_WIDTH}b62...]`,
    );
  }

  return parsed;
}

export function formatPosition(position: ParsedFuguePosition): FuguePosition {
  const { anchor, runId, slot } = position;
  const subslots = position.subslots ?? [];

  if (subslots.length > MAX_SUBSLOTS) {
    throw new RangeError(
      `subslots length must be <= ${MAX_SUBSLOTS}, got ${subslots.length}`,
    );
  }

  assertRange(anchor, ANCHOR_MIN, ANCHOR_MAX, "anchor");
  assertRange(runId, RUN_MIN, RUN_MAX, "runId");
  assertRange(slot, SLOT_MIN, SLOT_MAX, "slot");

  const encodedSlotPath = [encode62(slot, SLOT_WIDTH)];
  for (const subslot of subslots) {
    assertRange(subslot, SLOT_MIN, SLOT_MAX, "subslot");
    encodedSlotPath.push(encode62(subslot, SLOT_WIDTH));
  }

  return `${encode62(anchor, ANCHOR_WIDTH)}${SEPARATOR}${encode62(runId, RUN_WIDTH)}${SEPARATOR}${encodedSlotPath.join(SEPARATOR)}` as FuguePosition;
}

export function parseRunPrefix(prefix: string): ParsedFugueRunPrefix {
  if (prefix.length !== ANCHOR_WIDTH + RUN_WIDTH + 2) {
    throw new InvalidPositionError(`Invalid run prefix \"${prefix}\"`);
  }

  if (!prefix.endsWith(SEPARATOR)) {
    throw new InvalidPositionError(
      `Invalid run prefix \"${prefix}\": missing trailing separator`,
    );
  }

  const trimmed = prefix.slice(0, -1);
  const split = trimmed.split(SEPARATOR);
  if (split.length !== 2) {
    throw new InvalidPositionError(`Invalid run prefix \"${prefix}\"`);
  }

  const anchorEncoded = split[0]!;
  const runIdEncoded = split[1]!;

  const anchor = parseBase62FixedWidth(anchorEncoded, ANCHOR_WIDTH, ANCHOR_MAX);
  const runId = parseBase62FixedWidth(runIdEncoded, RUN_WIDTH, RUN_MAX);

  if (anchor === null || runId === null) {
    throw new InvalidPositionError(`Invalid run prefix \"${prefix}\"`);
  }

  return { anchor, runId };
}

export function formatRunPrefix(anchor: bigint, runId: bigint): FugueRunPrefix {
  assertRange(anchor, ANCHOR_MIN, ANCHOR_MAX, "anchor");
  assertRange(runId, RUN_MIN, RUN_MAX, "runId");

  return `${encode62(anchor, ANCHOR_WIDTH)}${SEPARATOR}${encode62(runId, RUN_WIDTH)}${SEPARATOR}` as FugueRunPrefix;
}

export function getRunPrefix(position: string): FugueRunPrefix {
  const parsed = parsePosition(position);
  return formatRunPrefix(parsed.anchor, parsed.runId);
}

export class FugueRun {
  readonly anchor: bigint;
  readonly runId: bigint;
  readonly prefix: FugueRunPrefix;
  readonly first: FuguePosition;

  private minSlot: bigint;
  private maxSlot: bigint;
  private readonly slotStep: bigint;

  constructor(
    anchor: bigint,
    runId: bigint,
    slotStep: bigint,
    initialSlot: bigint = SLOT_MID,
  ) {
    assertRange(anchor, ANCHOR_MIN, ANCHOR_MAX, "anchor");
    assertRange(runId, RUN_MIN, RUN_MAX, "runId");
    assertRange(initialSlot, SLOT_MIN, SLOT_MAX, "initialSlot");
    assertPositiveStep(slotStep);

    this.anchor = anchor;
    this.runId = runId;
    this.slotStep = slotStep;

    this.prefix = formatRunPrefix(anchor, runId);
    this.first = formatPosition({ anchor, runId, slot: initialSlot });
    this.minSlot = initialSlot;
    this.maxSlot = initialSlot;
  }

  after(): FuguePosition {
    if (this.maxSlot > SLOT_MAX - this.slotStep) {
      throw new SlotExhaustedError(
        `Cannot allocate after within run ${this.prefix}: slot exceeds ${SLOT_MAX}`,
      );
    }

    this.maxSlot += this.slotStep;
    return formatPosition({
      anchor: this.anchor,
      runId: this.runId,
      slot: this.maxSlot,
    });
  }

  before(): FuguePosition {
    if (this.minSlot < SLOT_MIN + this.slotStep) {
      throw new SlotExhaustedError(
        `Cannot allocate before within run ${this.prefix}: slot goes below ${SLOT_MIN}`,
      );
    }

    this.minSlot -= this.slotStep;
    return formatPosition({
      anchor: this.anchor,
      runId: this.runId,
      slot: this.minSlot,
    });
  }
}

export class Fugue {
  private readonly randomBytes: FugueRandomBytes;
  private readonly allowInsecureRandom: boolean;
  private readonly onWarning: (message: string) => void;
  private readonly slotStep: bigint;
  private warnedInsecureRandom = false;

  constructor(options?: FugueOptions);
  constructor(_legacyClientID: string, options?: FugueOptions);
  constructor(
    optionsOrLegacyClientID?: FugueOptions | string,
    maybeOptions?: FugueOptions,
  ) {
    const options =
      typeof optionsOrLegacyClientID === "string"
        ? (maybeOptions ?? {})
        : (optionsOrLegacyClientID ?? {});

    this.onWarning = options.onWarning ?? defaultWarning;

    if (typeof optionsOrLegacyClientID === "string") {
      this.onWarning(
        "Passing clientID to new Fugue(clientID) is deprecated in v3 and ignored. Use new Fugue(options).",
      );
    }

    this.allowInsecureRandom = options.allowInsecureRandom ?? false;
    this.slotStep = options.slotStep ?? SLOT_STEP_DEFAULT;
    assertPositiveStep(this.slotStep);

    this.randomBytes =
      options.randomBytes ??
      ((byteLength: number) => {
        return this.defaultRandomBytes(byteLength);
      });
  }

  first(): FuguePosition {
    return this.between(null, null);
  }

  after(position: string): FuguePosition {
    return this.between(position, null);
  }

  before(position: string): FuguePosition {
    return this.between(null, position);
  }

  between(left: string | null, right: string | null): FuguePosition {
    const [parsedLeft, parsedRight] = this.parseBounds(left, right);

    if (
      parsedLeft !== null &&
      parsedRight !== null &&
      isSameRun(parsedLeft, parsedRight)
    ) {
      const slotPath = this.slotPathBetween(
        getSlotPath(parsedLeft),
        getSlotPath(parsedRight),
      );

      if (slotPath === null) {
        throw new SlotExhaustedError(
          `No slot space between ${left} and ${right} inside run ${formatRunPrefix(parsedLeft.anchor, parsedLeft.runId)}`,
        );
      }

      return formatPositionFromSlotPath(
        parsedLeft.anchor,
        parsedLeft.runId,
        slotPath,
      );
    }

    try {
      return this.startRunFromBounds(parsedLeft, parsedRight).first;
    } catch (error) {
      if (!(error instanceof RunPrefixExhaustedError)) {
        throw error;
      }

      if (parsedLeft !== null && parsedRight === null) {
        return this.appendInsideRun(parsedLeft);
      }

      if (parsedLeft === null && parsedRight !== null) {
        return this.prependInsideRun(parsedRight);
      }

      throw error;
    }
  }

  startRun(left: string | null, right: string | null): FugueRun {
    const [parsedLeft, parsedRight] = this.parseBounds(left, right);

    if (
      parsedLeft !== null &&
      parsedRight !== null &&
      isSameRun(parsedLeft, parsedRight)
    ) {
      throw new RunPrefixExhaustedError(
        "Cannot start a new independent run between two keys in the same run. Use between(left, right) for single inserts.",
      );
    }

    return this.startRunFromBounds(parsedLeft, parsedRight);
  }

  startRunAfter(position: string): FugueRun {
    return this.startRun(position, null);
  }

  startRunBefore(position: string): FugueRun {
    return this.startRun(null, position);
  }

  private parseBounds(
    left: string | null,
    right: string | null,
  ): [ParsedFuguePosition | null, ParsedFuguePosition | null] {
    const parsedLeft = this.parseBound(left);
    const parsedRight = this.parseBound(right);

    if (
      parsedLeft !== null &&
      parsedRight !== null &&
      comparePositions(parsedLeft, parsedRight) >= 0
    ) {
      throw new RangeError(
        `left must be strictly less than right: ${left} < ${right}`,
      );
    }

    return [parsedLeft, parsedRight];
  }

  private parseBound(value: string | null): ParsedFuguePosition | null {
    if (value === null) {
      return null;
    }

    return parsePosition(value);
  }

  private startRunFromBounds(
    left: ParsedFuguePosition | null,
    right: ParsedFuguePosition | null,
  ) {
    const leftPrefix: ParsedFugueRunPrefix =
      left === null
        ? {
            anchor: ANCHOR_MIN,
            runId: RUN_MIN,
          }
        : {
            anchor: left.anchor,
            runId: left.runId,
          };

    const rightPrefix: ParsedFugueRunPrefix =
      right === null
        ? {
            anchor: ANCHOR_MAX,
            runId: RUN_MAX,
          }
        : {
            anchor: right.anchor,
            runId: right.runId,
          };

    if (compareRunPrefixes(leftPrefix, rightPrefix) >= 0) {
      throw new RunPrefixExhaustedError(
        `No run-prefix space between ${formatRunPrefix(leftPrefix.anchor, leftPrefix.runId)} and ${formatRunPrefix(rightPrefix.anchor, rightPrefix.runId)}`,
      );
    }

    const anchorGap = rightPrefix.anchor - leftPrefix.anchor;

    if (anchorGap >= 2n) {
      const anchor = (leftPrefix.anchor + rightPrefix.anchor) / 2n;
      return this.createRunAtAnchor(anchor, leftPrefix, rightPrefix);
    }

    if (anchorGap === 1n) {
      const candidates = [
        this.getRunIdCandidate(leftPrefix.anchor, leftPrefix, rightPrefix),
        this.getRunIdCandidate(rightPrefix.anchor, leftPrefix, rightPrefix),
      ].filter(
        (
          candidate,
        ): candidate is {
          anchor: bigint;
          minRunId: bigint;
          maxRunId: bigint;
          span: bigint;
        } => candidate !== null,
      );

      if (candidates.length === 0) {
        throw new RunPrefixExhaustedError(
          `No runId space available at anchors ${leftPrefix.anchor} and ${rightPrefix.anchor} between ${leftPrefix.runId} and ${rightPrefix.runId}`,
        );
      }

      const candidate = this.pickRunIdCandidate(candidates);
      const runId = this.randomBetween(candidate.minRunId, candidate.maxRunId);
      return new FugueRun(candidate.anchor, runId, this.slotStep);
    }

    return this.createRunAtAnchor(leftPrefix.anchor, leftPrefix, rightPrefix);
  }

  private createRunAtAnchor(
    anchor: bigint,
    leftPrefix: ParsedFugueRunPrefix,
    rightPrefix: ParsedFugueRunPrefix,
  ) {
    const bounds = this.getRunIdBoundsAtAnchor(anchor, leftPrefix, rightPrefix);
    if (bounds === null) {
      throw new RunPrefixExhaustedError(
        `No runId space available at anchor ${anchor} between ${leftPrefix.runId} and ${rightPrefix.runId}`,
      );
    }

    const runId = this.randomBetween(bounds.minRunId, bounds.maxRunId);
    return new FugueRun(anchor, runId, this.slotStep);
  }

  private getRunIdBoundsAtAnchor(
    anchor: bigint,
    leftPrefix: ParsedFugueRunPrefix,
    rightPrefix: ParsedFugueRunPrefix,
  ) {
    let minRunId = RUN_MIN;
    let maxRunId = RUN_MAX;

    if (anchor === leftPrefix.anchor) {
      minRunId = maxBigInt(minRunId, leftPrefix.runId + 1n);
    }

    if (anchor === rightPrefix.anchor) {
      maxRunId = minBigInt(maxRunId, rightPrefix.runId - 1n);
    }

    if (minRunId > maxRunId) {
      return null;
    }

    return { minRunId, maxRunId };
  }

  private getRunIdCandidate(
    anchor: bigint,
    leftPrefix: ParsedFugueRunPrefix,
    rightPrefix: ParsedFugueRunPrefix,
  ) {
    const bounds = this.getRunIdBoundsAtAnchor(anchor, leftPrefix, rightPrefix);
    if (bounds === null) {
      return null;
    }

    return {
      anchor,
      minRunId: bounds.minRunId,
      maxRunId: bounds.maxRunId,
      span: bounds.maxRunId - bounds.minRunId + 1n,
    };
  }

  private pickRunIdCandidate(
    candidates: readonly {
      anchor: bigint;
      minRunId: bigint;
      maxRunId: bigint;
      span: bigint;
    }[],
  ) {
    if (candidates.length === 1) {
      return candidates[0]!;
    }

    let totalSpan = 0n;
    for (const candidate of candidates) {
      totalSpan += candidate.span;
    }

    let offset = this.randomBelow(totalSpan);
    for (const candidate of candidates) {
      if (offset < candidate.span) {
        return candidate;
      }

      offset -= candidate.span;
    }

    return candidates[candidates.length - 1]!;
  }

  private randomBetween(minInclusive: bigint, maxInclusive: bigint) {
    if (maxInclusive < minInclusive) {
      throw new RangeError(
        `Invalid random interval [${minInclusive}, ${maxInclusive}]`,
      );
    }

    const span = maxInclusive - minInclusive + 1n;
    const offset = this.randomBelow(span);
    return minInclusive + offset;
  }

  private appendInsideRun(left: ParsedFuguePosition) {
    const gap = SLOT_MAX - left.slot;

    if (gap > 0n) {
      const maxDelta = gap >= this.slotStep ? this.slotStep : gap;
      const delta = this.randomBetween(1n, maxDelta);
      return formatPosition({
        anchor: left.anchor,
        runId: left.runId,
        slot: left.slot + delta,
      });
    }

    const slotPath = this.slotPathAfter(getSlotPath(left));
    return formatPositionFromSlotPath(left.anchor, left.runId, slotPath);
  }

  private prependInsideRun(right: ParsedFuguePosition) {
    const gap = right.slot - SLOT_MIN;

    if (gap > 0n) {
      const maxDelta = gap >= this.slotStep ? this.slotStep : gap;
      const delta = this.randomBetween(1n, maxDelta);
      return formatPosition({
        anchor: right.anchor,
        runId: right.runId,
        slot: right.slot - delta,
      });
    }

    const slotPath = this.slotPathBefore(getSlotPath(right));
    if (slotPath === null) {
      throw new SlotExhaustedError(
        `No slot space before ${formatPosition(right)} in run ${formatRunPrefix(right.anchor, right.runId)}`,
      );
    }

    return formatPositionFromSlotPath(right.anchor, right.runId, slotPath);
  }

  private slotPathBetween(left: readonly bigint[], right: readonly bigint[]) {
    const prefix: bigint[] = [];
    let index = 0;

    for (;;) {
      const leftHasValue = index < left.length;
      const rightHasValue = index < right.length;

      if (!leftHasValue && !rightHasValue) {
        prefix.push(this.randomBetween(SLOT_MIN, SLOT_MAX));
        return prefix;
      }

      if (!leftHasValue) {
        const rightValue = right[index]!;

        if (rightValue > SLOT_MIN) {
          prefix.push(this.randomBetween(SLOT_MIN, rightValue - 1n));
          return prefix;
        }

        const tail = right.slice(index + 1);
        if (tail.length === 0) {
          return null;
        }

        const deeper = this.slotPathBefore(tail);
        if (deeper !== null && this.randomBelow(2n) === 1n) {
          prefix.push(SLOT_MIN, ...deeper);
          return prefix;
        }

        prefix.push(SLOT_MIN);
        return prefix;
      }

      if (!rightHasValue) {
        const leftValue = left[index]!;

        if (leftValue < SLOT_MAX) {
          prefix.push(this.randomBetween(leftValue + 1n, SLOT_MAX));
          return prefix;
        }

        prefix.push(SLOT_MAX);
        index++;
        continue;
      }

      const leftValue = left[index]!;
      const rightValue = right[index]!;

      if (leftValue === rightValue) {
        prefix.push(leftValue);
        index++;
        continue;
      }

      const gap = rightValue - leftValue;
      if (gap >= 2n) {
        prefix.push(this.randomBetween(leftValue + 1n, rightValue - 1n));
        return prefix;
      }

      prefix.push(leftValue);
      index++;
    }
  }

  private slotPathAfter(left: readonly bigint[]) {
    const prefix: bigint[] = [];

    for (const value of left) {
      if (value < SLOT_MAX) {
        prefix.push(this.randomBetween(value + 1n, SLOT_MAX));
        return prefix;
      }

      prefix.push(SLOT_MAX);
    }

    prefix.push(this.randomBetween(SLOT_MIN, SLOT_MAX));
    return prefix;
  }

  private slotPathBefore(right: readonly bigint[]): bigint[] | null {
    if (right.length === 0) {
      return null;
    }

    let index = 0;
    while (index < right.length && right[index] === SLOT_MIN) {
      index++;
    }

    let result: bigint[] | null;
    let unwindLevels: number;

    if (index === right.length) {
      if (right.length === 1) {
        return null;
      }

      result = null;
      unwindLevels = right.length - 1;
    } else {
      const rightValue = right[index]!;
      result = [this.randomBetween(SLOT_MIN, rightValue - 1n)];
      unwindLevels = index;
    }

    for (let level = 0; level < unwindLevels; level++) {
      const prefix = [SLOT_MIN];
      if (result !== null && this.randomBelow(2n) === 1n) {
        prefix.push(...result);
      }

      result = prefix;
    }

    return result;
  }

  private randomBelow(limit: bigint) {
    if (limit <= 0n) {
      throw new RangeError(`limit must be > 0, got ${limit}`);
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
        throw new RangeError(
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

    throw new RangeError(
      `randomBytes failed to produce a sample < ${limit} after ${MAX_RANDOM_REJECTION_ATTEMPTS} attempts`,
    );
  }

  private defaultRandomBytes(byteLength: number) {
    if (byteLength <= 0) {
      throw new RangeError(`byteLength must be > 0, got ${byteLength}`);
    }

    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.getRandomValues !== undefined) {
      const bytes = new Uint8Array(byteLength);
      cryptoObject.getRandomValues(bytes);
      return bytes;
    }

    if (this.allowInsecureRandom) {
      if (!this.warnedInsecureRandom) {
        this.onWarning(
          "Fugue is using Math.random() as a fallback random source. This reduces collision and abuse resistance. Prefer options.randomBytes or crypto.getRandomValues.",
        );
        this.warnedInsecureRandom = true;
      }

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
