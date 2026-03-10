import {
  InvalidBoundsError,
  InvalidRandomSourceError,
  RunPrefixExhaustedError,
  SecureRandomUnavailableError,
  SlotExhaustedError,
} from "./errors";
import {
  ANCHOR_MAX,
  ANCHOR_MID,
  ANCHOR_MIN,
  MAX_ANCHOR_PATH_DEPTH,
  MAX_SLOT_PATH_DEPTH,
  RUN_MAX,
  RUN_MIN,
  SLOT_MAX,
  SLOT_MID,
  SLOT_MIN,
  comparePaths,
  comparePositions,
  formatPosition,
  isSameRun,
  parsePosition,
  type FuguePosition,
  type ParsedFuguePosition,
} from "./position";

const RUN_SLOT_STEP = 1n << 48n;
const MAX_RANDOM_REJECTION_ATTEMPTS = 128;

type RunIdCandidate = {
  anchorPath: readonly bigint[];
  minRunId: bigint;
  maxRunId: bigint;
  span: bigint;
};

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

function formatRunPrefix(anchorPath: readonly bigint[], runId: bigint) {
  const samplePosition = formatPosition({
    anchorPath,
    runId,
    slotPath: [SLOT_MID],
  });

  return samplePosition.slice(0, samplePosition.lastIndexOf("!"));
}

function nextSequentialPathAfter(
  path: readonly bigint[],
  step: bigint,
  maxValue: bigint,
  midValue: bigint,
  maxDepth: number,
) {
  const next = clonePath(path);
  const lastIndex = next.length - 1;
  const last = next[lastIndex]!;

  if (last <= maxValue - step) {
    next[lastIndex] = last + step;
    return next;
  }

  if (last < maxValue) {
    next[lastIndex] = maxValue;
    return next;
  }

  if (next.length >= maxDepth) {
    return null;
  }

  next.push(midValue);
  return next;
}

export class FugueRun {
  private readonly anchorPath: readonly bigint[];
  private readonly runId: bigint;
  private readonly prefix: string;

  private readonly initialSlotPath: readonly bigint[];
  private lastSlotPath: readonly bigint[] | null = null;

  constructor(
    anchorPath: readonly bigint[],
    runId: bigint,
    initialSlotPath: readonly bigint[] = [SLOT_MID],
  ) {
    formatPosition({ anchorPath, runId, slotPath: initialSlotPath });

    this.anchorPath = clonePath(anchorPath);
    this.runId = runId;
    this.prefix = formatRunPrefix(this.anchorPath, runId);
    this.initialSlotPath = clonePath(initialSlotPath);
  }

  next(): FuguePosition {
    if (this.lastSlotPath === null) {
      this.lastSlotPath = clonePath(this.initialSlotPath);
      return formatPosition({
        anchorPath: this.anchorPath,
        runId: this.runId,
        slotPath: this.lastSlotPath,
      });
    }

    const nextSlotPath = nextSequentialPathAfter(
      this.lastSlotPath,
      RUN_SLOT_STEP,
      SLOT_MAX,
      SLOT_MID,
      MAX_SLOT_PATH_DEPTH,
    );
    if (nextSlotPath === null) {
      throw new SlotExhaustedError(
        `Cannot allocate next position within run ${this.prefix}: slotPath depth exceeds ${MAX_SLOT_PATH_DEPTH}`,
      );
    }

    this.lastSlotPath = nextSlotPath;
    return formatPosition({
      anchorPath: this.anchorPath,
      runId: this.runId,
      slotPath: this.lastSlotPath,
    });
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
    return this.between(position, null);
  }

  before(position: FuguePosition): FuguePosition {
    return this.between(null, position);
  }

  between(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): FuguePosition {
    const [parsedLeft, parsedRight] = this.parseBounds(left, right);

    if (
      parsedLeft !== null &&
      parsedRight !== null &&
      isSameRun(parsedLeft, parsedRight)
    ) {
      const slotPath = this.pathBetween(
        parsedLeft.slotPath,
        parsedRight.slotPath,
        SLOT_MIN,
        SLOT_MAX,
        MAX_SLOT_PATH_DEPTH,
      );

      if (slotPath === null) {
        throw new SlotExhaustedError(
          `No slot space between ${left} and ${right} inside run ${formatRunPrefix(parsedLeft.anchorPath, parsedLeft.runId)}`,
        );
      }

      return formatPosition({
        anchorPath: parsedLeft.anchorPath,
        runId: parsedLeft.runId,
        slotPath,
      });
    }

    try {
      return this.startRunFromBounds(parsedLeft, parsedRight).next();
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

  startRun(
    left: FuguePosition | null,
    right: FuguePosition | null,
  ): { next(): FuguePosition } {
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

  startRunAfter(position: FuguePosition): { next(): FuguePosition } {
    return this.startRun(position, null);
  }

  startRunBefore(position: FuguePosition): { next(): FuguePosition } {
    return this.startRun(null, position);
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

  private startRunFromBounds(
    left: ParsedFuguePosition | null,
    right: ParsedFuguePosition | null,
  ) {
    if (left === null && right === null) {
      return new FugueRun([ANCHOR_MID], this.randomBetween(RUN_MIN, RUN_MAX));
    }

    if (left !== null && right !== null) {
      const anchorOrder = comparePaths(left.anchorPath, right.anchorPath);

      if (anchorOrder === 0) {
        if (left.runId + 1n > right.runId - 1n) {
          throw new RunPrefixExhaustedError(
            `No runId space available at anchorPath ${left.anchorPath.join("~")} between ${left.runId} and ${right.runId}`,
          );
        }

        return new FugueRun(
          left.anchorPath,
          this.randomBetween(left.runId + 1n, right.runId - 1n),
        );
      }

      const freshAnchorPath = this.pathBetween(
        left.anchorPath,
        right.anchorPath,
        ANCHOR_MIN,
        ANCHOR_MAX,
        MAX_ANCHOR_PATH_DEPTH,
      );
      if (freshAnchorPath !== null) {
        return new FugueRun(
          freshAnchorPath,
          this.randomBetween(RUN_MIN, RUN_MAX),
        );
      }

      const candidates: RunIdCandidate[] = [];
      const leftCandidate = this.getRunIdCandidate(
        left.anchorPath,
        left.runId + 1n,
        RUN_MAX,
      );
      if (leftCandidate !== null) {
        candidates.push(leftCandidate);
      }

      const rightCandidate = this.getRunIdCandidate(
        right.anchorPath,
        RUN_MIN,
        right.runId - 1n,
      );
      if (rightCandidate !== null) {
        candidates.push(rightCandidate);
      }

      if (candidates.length === 0) {
        throw new RunPrefixExhaustedError(
          `No run-prefix space between ${formatRunPrefix(left.anchorPath, left.runId)} and ${formatRunPrefix(right.anchorPath, right.runId)}`,
        );
      }

      const candidate = this.pickRunIdCandidate(candidates);
      return new FugueRun(
        candidate.anchorPath,
        this.randomBetween(candidate.minRunId, candidate.maxRunId),
      );
    }

    if (left !== null) {
      const freshAnchorPath = this.randomPathAfter(
        left.anchorPath,
        ANCHOR_MIN,
        ANCHOR_MAX,
        MAX_ANCHOR_PATH_DEPTH,
      );
      if (freshAnchorPath !== null) {
        return new FugueRun(
          freshAnchorPath,
          this.randomBetween(RUN_MIN, RUN_MAX),
        );
      }

      if (left.runId < RUN_MAX) {
        return new FugueRun(
          left.anchorPath,
          this.randomBetween(left.runId + 1n, RUN_MAX),
        );
      }

      throw new RunPrefixExhaustedError(
        `No run-prefix space after ${formatRunPrefix(left.anchorPath, left.runId)}`,
      );
    }

    const parsedRight = right!;
    const freshAnchorPath = this.randomPathBefore(
      parsedRight.anchorPath,
      ANCHOR_MIN,
      ANCHOR_MAX,
    );
    if (freshAnchorPath !== null) {
      return new FugueRun(
        freshAnchorPath,
        this.randomBetween(RUN_MIN, RUN_MAX),
      );
    }

    if (parsedRight.runId > RUN_MIN) {
      return new FugueRun(
        parsedRight.anchorPath,
        this.randomBetween(RUN_MIN, parsedRight.runId - 1n),
      );
    }

    throw new RunPrefixExhaustedError(
      `No run-prefix space before ${formatRunPrefix(parsedRight.anchorPath, parsedRight.runId)}`,
    );
  }

  private getRunIdCandidate(
    anchorPath: readonly bigint[],
    minRunId: bigint,
    maxRunId: bigint,
  ) {
    if (minRunId > maxRunId) {
      return null;
    }

    return {
      anchorPath: clonePath(anchorPath),
      minRunId,
      maxRunId,
      span: maxRunId - minRunId + 1n,
    };
  }

  private pickRunIdCandidate(candidates: readonly RunIdCandidate[]) {
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

  private appendInsideRun(left: ParsedFuguePosition) {
    const slotPath = this.randomPathAfter(
      left.slotPath,
      SLOT_MIN,
      SLOT_MAX,
      MAX_SLOT_PATH_DEPTH,
    );
    if (slotPath === null) {
      throw new SlotExhaustedError(
        `No slot space after ${formatPosition(left)} in run ${formatRunPrefix(left.anchorPath, left.runId)}`,
      );
    }

    return formatPosition({
      anchorPath: left.anchorPath,
      runId: left.runId,
      slotPath,
    });
  }

  private prependInsideRun(right: ParsedFuguePosition) {
    const slotPath = this.randomPathBefore(right.slotPath, SLOT_MIN, SLOT_MAX);
    if (slotPath === null) {
      throw new SlotExhaustedError(
        `No slot space before ${formatPosition(right)} in run ${formatRunPrefix(right.anchorPath, right.runId)}`,
      );
    }

    return formatPosition({
      anchorPath: right.anchorPath,
      runId: right.runId,
      slotPath,
    });
  }

  private pathBetween(
    left: readonly bigint[],
    right: readonly bigint[],
    minValue: bigint,
    maxValue: bigint,
    maxDepth: number,
  ) {
    const prefix: bigint[] = [];
    let index = 0;

    for (;;) {
      const leftHasValue = index < left.length;
      const rightHasValue = index < right.length;

      if (!leftHasValue && !rightHasValue) {
        if (prefix.length >= maxDepth) {
          return null;
        }

        prefix.push(this.randomBetween(minValue, maxValue));
        return prefix;
      }

      if (!leftHasValue) {
        const rightValue = right[index]!;

        if (rightValue > minValue) {
          if (prefix.length >= maxDepth) {
            return null;
          }

          prefix.push(this.randomBetween(minValue, rightValue - 1n));
          return prefix;
        }

        const tail = right.slice(index + 1);
        if (tail.length === 0) {
          return null;
        }

        if (prefix.length >= maxDepth) {
          return null;
        }

        const deeper = this.randomPathBefore(tail, minValue, maxValue);
        if (
          deeper !== null &&
          prefix.length + 1 + deeper.length <= maxDepth &&
          this.randomBelow(2n) === 1n
        ) {
          prefix.push(minValue, ...deeper);
          return prefix;
        }

        prefix.push(minValue);
        return prefix;
      }

      if (!rightHasValue) {
        const leftValue = left[index]!;

        if (leftValue < maxValue) {
          if (prefix.length >= maxDepth) {
            return null;
          }

          prefix.push(this.randomBetween(leftValue + 1n, maxValue));
          return prefix;
        }

        if (prefix.length >= maxDepth) {
          return null;
        }

        prefix.push(maxValue);
        index++;
        continue;
      }

      const leftValue = left[index]!;
      const rightValue = right[index]!;

      if (leftValue === rightValue) {
        if (prefix.length >= maxDepth) {
          return null;
        }

        prefix.push(leftValue);
        index++;
        continue;
      }

      const gap = rightValue - leftValue;
      if (gap >= 2n) {
        if (prefix.length >= maxDepth) {
          return null;
        }

        prefix.push(this.randomBetween(leftValue + 1n, rightValue - 1n));
        return prefix;
      }

      if (prefix.length >= maxDepth) {
        return null;
      }

      prefix.push(leftValue);
      index++;
    }
  }

  private randomPathAfter(
    left: readonly bigint[],
    minValue: bigint,
    maxValue: bigint,
    maxDepth: number,
  ) {
    const prefix: bigint[] = [];

    for (const value of left) {
      if (value < maxValue) {
        prefix.push(this.randomBetween(value + 1n, maxValue));
        return prefix;
      }

      if (prefix.length >= maxDepth) {
        return null;
      }

      prefix.push(maxValue);
    }

    if (prefix.length >= maxDepth) {
      return null;
    }

    prefix.push(this.randomBetween(minValue, maxValue));
    return prefix;
  }

  private randomPathBefore(
    right: readonly bigint[],
    minValue: bigint,
    _maxValue: bigint,
  ): bigint[] | null {
    if (right.length === 0) {
      return null;
    }

    let index = 0;
    while (index < right.length && right[index] === minValue) {
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
      result = [this.randomBetween(minValue, rightValue - 1n)];
      unwindLevels = index;
    }

    for (let level = 0; level < unwindLevels; level++) {
      const prefix = [minValue];
      if (result !== null && this.randomBelow(2n) === 1n) {
        prefix.push(...result);
      }

      result = prefix;
    }

    return result;
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
