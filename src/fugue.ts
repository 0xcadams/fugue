import {
  BurstSpaceExhaustedError,
  InvalidBoundsError,
  InvalidRandomSourceError,
} from "./errors";
import { FugueBurst, type PreparedBurstPrefix } from "./internal/fugue-burst";
import {
  BURST_DEPTH_EXCEEDED_MESSAGE,
  PreparedPositionCache,
  chooseBurstToken,
  defaultRandomBytes,
  midpointPositionAtSameDepth,
  nextSequentialTopCoordAfter,
  nextSequentialTopCoordBefore,
  randomBelow,
  randomBelowNumber,
  type FugueRandomBytes,
} from "./internal/fugue-support";
import {
  comparePreparedPathSlices,
  comparePreparedPositions,
  isPreparedPathPrefix,
  isPreparedPositionPrefix,
  nestedCoordsForBurstDepth,
  toPreparedLeftAncestor,
} from "./internal/prepared-path";
import {
  MAX_BURST_DEPTH,
  TOP_COORD_MID,
  burstMaxNumberAtDepth,
} from "./internal/position-schema";
import {
  preparePosition,
  type FuguePosition,
  type PreparedFuguePath,
  type PreparedFuguePosition,
} from "./position";

export { FugueBurst };
export type { FugueRandomBytes };

export type FugueOptions = {
  randomBytes?: FugueRandomBytes;
  allowInsecureRandom?: boolean;
};

function createRootBurstPrefix(burst: number): PreparedBurstPrefix {
  return {
    topCoord: TOP_COORD_MID,
    bursts: [burst],
    nestedCoords: [],
  };
}

function createFlatBurstPrefix(
  topCoord: bigint,
  burst: number,
): PreparedBurstPrefix {
  return {
    topCoord,
    bursts: [burst],
    nestedCoords: [],
  };
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
        return this.rememberPreparedPosition(fallback as PreparedFuguePosition)
          .text;
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
    return this.startBurstAfterPrepared(this.prepareCachedPosition(position));
  }

  startBurstBefore(position: FuguePosition): FugueBurst {
    return this.startBurstBeforePrepared(this.prepareCachedPosition(position));
  }

  private startBurstFromPreparedBounds(
    preparedLeft: PreparedFuguePosition | null,
    preparedRight: PreparedFuguePosition | null,
  ) {
    if (preparedLeft === null && preparedRight === null) {
      return FugueBurst.fromPreparedPrefix(
        createRootBurstPrefix(this.randomBurstToken(0)),
      );
    }

    if (preparedLeft !== null && preparedRight === null) {
      return this.startBurstAfterPrepared(preparedLeft);
    }

    if (preparedLeft === null && preparedRight !== null) {
      return this.startBurstBeforePrepared(preparedRight);
    }

    if (isPreparedPositionPrefix(preparedLeft!, preparedRight!)) {
      const withinPrefixGap = this.tryStartWithinPrefixGap(
        preparedLeft!,
        preparedRight!,
      );
      if (withinPrefixGap !== null) {
        return withinPrefixGap;
      }

      return this.startBurstFromLeftAncestor(preparedRight!);
    }

    const withinSharedGap = this.tryStartAfterLeftWithinGap(
      preparedLeft!,
      preparedRight!,
    );
    if (withinSharedGap !== null) {
      return withinSharedGap;
    }

    return this.startBurstFromAncestor(preparedLeft!);
  }

  private startBurstFromAncestor(
    ancestor: PreparedFuguePath,
    minBurstExclusive?: number,
    maxBurstInclusive?: number,
  ) {
    return this.startBurstFromPositionAtDepth(
      ancestor,
      ancestor.depth,
      minBurstExclusive,
      maxBurstInclusive,
    );
  }

  private startBurstFromPositionAtDepth(
    position: PreparedFuguePath,
    depth: number,
    minBurstExclusive?: number,
    maxBurstInclusive?: number,
  ) {
    if (depth >= MAX_BURST_DEPTH) {
      throw new BurstSpaceExhaustedError(BURST_DEPTH_EXCEEDED_MESSAGE);
    }

    const minBurst =
      minBurstExclusive === undefined ? 0 : minBurstExclusive + 1;
    const maxBurst = maxBurstInclusive ?? burstMaxNumberAtDepth(depth);

    if (minBurst > maxBurst) {
      throw new BurstSpaceExhaustedError(
        `Cannot open another nested burst: burst space exhausted at depth ${depth}`,
      );
    }

    const bursts = new Array<number>(depth + 1);
    for (let index = 0; index < depth; index++) {
      bursts[index] = position.bursts[index]!;
    }
    bursts[depth] = this.chooseBurstToken(minBurst, maxBurst);

    return FugueBurst.fromPreparedPrefix({
      topCoord: position.topCoord,
      bursts,
      nestedCoords: nestedCoordsForBurstDepth(position, depth),
    });
  }

  private startBurstFromLeftAncestor(position: PreparedFuguePosition) {
    return this.startBurstFromAncestor(toPreparedLeftAncestor(position));
  }

  private tryStartAfterLeftWithinGap(
    left: PreparedFuguePosition,
    right: PreparedFuguePosition,
  ) {
    for (let depth = 0; depth <= left.depth; depth++) {
      if (depth === left.depth) {
        if (comparePreparedPathSlices(left, depth, right) < 0) {
          return this.startBurstFromPositionAtDepth(left, depth);
        }
        continue;
      }

      const maxBurst = this.maxBurstBeforeRightAtDepth(left, depth, right);
      if (maxBurst === null) {
        continue;
      }

      const minBurst = left.bursts[depth]!;
      if (minBurst < maxBurst) {
        return this.startBurstFromPositionAtDepth(
          left,
          depth,
          minBurst,
          maxBurst,
        );
      }
    }

    return null;
  }

  private tryStartWithinPrefixGap(
    left: PreparedFuguePosition,
    right: PreparedFuguePosition,
  ) {
    const maxBurst = this.maxBurstBeforeRight(left, left.depth, right);

    if (maxBurst === null || maxBurst < 0) {
      return null;
    }

    return this.startBurstFromPositionAtDepth(
      left,
      left.depth,
      undefined,
      maxBurst,
    );
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

  private maxBurstBeforeRightAtDepth(
    position: PreparedFuguePath,
    depth: number,
    right: PreparedFuguePosition,
  ) {
    if (isPreparedPathPrefix(position, depth, right)) {
      const rightBurst = right.bursts[depth];
      if (rightBurst === undefined) {
        return null;
      }

      return rightBurst - 1;
    }

    if (comparePreparedPathSlices(position, depth, right) < 0) {
      return burstMaxNumberAtDepth(depth);
    }

    return null;
  }

  private chooseBurstToken(minInclusive: number, maxInclusive: number) {
    return chooseBurstToken(
      (innerMin, innerMax) => {
        return this.randomBetweenNumber(innerMin, innerMax);
      },
      minInclusive,
      maxInclusive,
    );
  }

  private startBurstAfterPrepared(position: PreparedFuguePosition) {
    const nextTopCoord = nextSequentialTopCoordAfter(position.topCoord);
    if (nextTopCoord !== null) {
      return FugueBurst.fromPreparedPrefix(
        createFlatBurstPrefix(nextTopCoord, this.randomBurstToken(0)),
      );
    }

    if (position.depth < MAX_BURST_DEPTH) {
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
      return FugueBurst.fromPreparedPrefix(
        createFlatBurstPrefix(previousTopCoord, this.randomBurstToken(0)),
      );
    }

    if (position.depth < MAX_BURST_DEPTH) {
      return this.startBurstFromLeftAncestor(position);
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

    return FugueBurst.fromPreparedPrefix(
      createFlatBurstPrefix(
        topCoord,
        this.chooseBurstToken(minBurstInclusive, maxBurstInclusive),
      ),
    );
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

    return this.prepareCachedPosition(value);
  }

  private prepareCachedPosition(value: FuguePosition) {
    const cached = this.preparedCache.get(value);
    if (cached !== null) {
      return cached as PreparedFuguePosition;
    }

    return this.rememberPreparedPosition(preparePosition(value));
  }

  private readonly rememberPreparedPosition = (
    position: PreparedFuguePosition,
  ) => {
    return this.preparedCache.set(position) as PreparedFuguePosition;
  };

  private randomBurstToken(depth: number) {
    return this.randomBetweenNumber(0, burstMaxNumberAtDepth(depth));
  }

  private randomBelow(limit: bigint) {
    return randomBelow(this.randomBytes, limit);
  }

  private randomBelowNumber(limit: number) {
    return randomBelowNumber(this.randomBytes, limit);
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
    return defaultRandomBytes(byteLength, this.allowInsecureRandom);
  }
}
