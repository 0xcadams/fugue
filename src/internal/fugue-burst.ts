import { encode62, encode62Number } from "../codec";
import { CoordSpaceExhaustedError, InvalidPositionError } from "../errors";
import {
  MAX_BURST_DEPTH,
  NESTED_COORD_MID_NUMBER,
  SEPARATOR,
  TOP_COORD_WIDTH,
  burstWidthAtDepth,
  coordWidthAtDepth,
  toSafeInteger,
} from "./position-schema";
import { nextSequentialNestedCoordAfter } from "./fugue-support";

type FuguePosition = `${string}!${string}!${string}`;

export type PreparedBurstPrefix = Readonly<{
  topCoord: bigint;
  bursts: readonly number[];
  nestedCoords: readonly number[];
}>;

function cloneNumberPath(path: readonly number[]) {
  return [...path];
}

function prepareBurstPrefix(
  prefixCoords: readonly bigint[],
  prefixBursts: readonly bigint[],
): PreparedBurstPrefix {
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

function formatPreparedPrefixStem(prefix: PreparedBurstPrefix) {
  if (prefix.bursts.length !== prefix.nestedCoords.length + 1) {
    throw new InvalidPositionError(
      `burst prefixes must satisfy bursts.length = nestedCoords.length + 1, got ${prefix.bursts.length} bursts and ${prefix.nestedCoords.length} nested coords`,
    );
  }

  let out = `${encode62(prefix.topCoord, TOP_COORD_WIDTH)}${SEPARATOR}`;

  for (let depth = 0; depth < prefix.bursts.length; depth++) {
    out += encode62Number(prefix.bursts[depth]!, burstWidthAtDepth(depth));
    out += SEPARATOR;

    if (depth < prefix.nestedCoords.length) {
      out += encode62Number(
        prefix.nestedCoords[depth]!,
        coordWidthAtDepth(depth + 1),
      );
      out += SEPARATOR;
    }
  }

  return out;
}

export class FugueBurst {
  private readonly prefixNestedCoords: readonly number[];
  private readonly prefixBursts: readonly number[];
  private readonly continuationBurst: number;
  private readonly prefix: string;
  private readonly prefixStem: string;

  private currentNestedCoords: number[] | null = null;
  private currentBursts: number[] | null = null;
  private currentFinalCoord: number | null = null;
  private currentStem: string | null = null;

  constructor(
    prefixCoords: readonly bigint[],
    prefixBursts: readonly bigint[],
    _rememberPosition?: unknown,
    preparedPrefix?: PreparedBurstPrefix,
  ) {
    const prefix =
      preparedPrefix ?? prepareBurstPrefix(prefixCoords, prefixBursts);

    this.prefixNestedCoords = prefix.nestedCoords;
    this.prefixBursts = prefix.bursts;
    this.continuationBurst = prefix.bursts[prefix.bursts.length - 1]!;
    this.prefixStem = formatPreparedPrefixStem(prefix);
    this.prefix = this.prefixStem.slice(0, -SEPARATOR.length);
  }

  static fromPreparedPrefix(prefix: PreparedBurstPrefix) {
    return new FugueBurst([], [], undefined, prefix);
  }

  next(): FuguePosition {
    if (this.currentNestedCoords === null || this.currentBursts === null) {
      this.currentBursts = cloneNumberPath(this.prefixBursts);
      this.currentNestedCoords = cloneNumberPath(this.prefixNestedCoords);
      this.currentFinalCoord = NESTED_COORD_MID_NUMBER;
      this.currentStem = this.prefixStem;
      return this.emitCurrentPosition();
    }

    const currentFinalCoord = this.currentFinalCoord!;
    const nextCoord = nextSequentialNestedCoordAfter(currentFinalCoord);
    if (nextCoord !== null) {
      this.currentFinalCoord = nextCoord;
      return this.emitCurrentPosition();
    }

    if (this.currentBursts.length >= MAX_BURST_DEPTH) {
      throw new CoordSpaceExhaustedError(
        `Cannot continue burst ${this.prefix}: burst depth exceeds ${MAX_BURST_DEPTH}`,
      );
    }

    const previousFinalCoord = currentFinalCoord;
    const previousDepth = this.currentBursts.length;
    this.currentStem += `${encode62Number(previousFinalCoord, coordWidthAtDepth(previousDepth))}${SEPARATOR}${encode62Number(this.continuationBurst, burstWidthAtDepth(previousDepth))}${SEPARATOR}`;
    this.currentNestedCoords.push(previousFinalCoord);
    this.currentBursts.push(this.continuationBurst);
    this.currentFinalCoord = NESTED_COORD_MID_NUMBER;
    return this.emitCurrentPosition();
  }

  private emitCurrentPosition() {
    return `${this.currentStem!}${encode62Number(this.currentFinalCoord!, coordWidthAtDepth(this.currentBursts!.length))}` as FuguePosition;
  }
}
