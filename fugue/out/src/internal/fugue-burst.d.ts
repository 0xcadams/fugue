type FuguePosition = `${string}!${string}!${string}`;
export type PreparedBurstPrefix = Readonly<{
    topCoord: bigint;
    bursts: readonly number[];
    nestedCoords: readonly number[];
}>;
export declare class FugueBurst {
    private readonly prefixNestedCoords;
    private readonly prefixBursts;
    private readonly continuationBurst;
    private readonly prefix;
    private readonly prefixStem;
    private currentNestedCoords;
    private currentBursts;
    private currentFinalCoord;
    private currentStem;
    constructor(prefixCoords: readonly bigint[], prefixBursts: readonly bigint[], _rememberPosition?: unknown, preparedPrefix?: PreparedBurstPrefix);
    static fromPreparedPrefix(prefix: PreparedBurstPrefix): FugueBurst;
    next(): FuguePosition;
    private emitCurrentPosition;
}
export {};
//# sourceMappingURL=fugue-burst.d.ts.map