import { FugueBurst } from "./internal/fugue-burst";
import { type FugueRandomBytes } from "./internal/fugue-support";
import { type FuguePosition } from "./position";
export { FugueBurst };
export type { FugueRandomBytes };
export type FugueOptions = {
    randomBytes?: FugueRandomBytes;
    allowInsecureRandom?: boolean;
};
export declare class Fugue {
    private readonly randomBytes;
    private readonly allowInsecureRandom;
    private readonly preparedCache;
    constructor(options?: FugueOptions);
    first(): FuguePosition;
    after(position: FuguePosition): FuguePosition;
    before(position: FuguePosition): FuguePosition;
    between(left: FuguePosition | null, right: FuguePosition | null): FuguePosition;
    startBurst(left: FuguePosition | null, right: FuguePosition | null): FugueBurst;
    startBurstAfter(position: FuguePosition): FugueBurst;
    startBurstBefore(position: FuguePosition): FugueBurst;
    private startBurstFromPreparedBounds;
    private startBurstFromAncestor;
    private startBurstFromPositionAtDepth;
    private startBurstFromLeftAncestor;
    private tryStartAfterLeftWithinGap;
    private tryStartWithinPrefixGap;
    private maxBurstBeforeRight;
    private maxBurstBeforeRightAtDepth;
    private chooseBurstToken;
    private startBurstAfterPrepared;
    private startBurstBeforePrepared;
    private tryStartAtSameTopCoord;
    private prepareBounds;
    private prepareBound;
    private prepareCachedPosition;
    private readonly rememberPreparedPosition;
    private randomBurstToken;
    private randomBelow;
    private randomBelowNumber;
    randomBetween(minInclusive: bigint, maxInclusive: bigint): bigint;
    private randomBetweenNumber;
    private defaultRandomBytes;
}
//# sourceMappingURL=fugue.d.ts.map