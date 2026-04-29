import { type PreparedPositionSnapshot } from "./prepared-path";
export declare const BURST_DEPTH_EXCEEDED_MESSAGE = "Cannot open another nested burst: burst depth exceeds 64";
export type FuguePositionText = `${string}!${string}!${string}`;
export type FugueRandomBytes = (byteLength: number) => Uint8Array;
export declare class PreparedPositionCache {
    private readonly entries;
    get(text: FuguePositionText): Readonly<Readonly<{
        topCoord: bigint;
        bursts: readonly number[];
        nestedCoords: readonly number[];
        finalCoord: number;
        depth: number;
    }> & {
        text: string;
    }> | null;
    set(position: PreparedPositionSnapshot): Readonly<Readonly<{
        topCoord: bigint;
        bursts: readonly number[];
        nestedCoords: readonly number[];
        finalCoord: number;
        depth: number;
    }> & {
        text: string;
    }>;
}
export declare function nextSequentialTopCoordAfter(coord: bigint): bigint | null;
export declare function nextSequentialTopCoordBefore(coord: bigint): bigint | null;
export declare function nextSequentialNestedCoordAfter(coord: number): number | null;
export declare function midpointPositionAtSameDepth(left: PreparedPositionSnapshot, right: PreparedPositionSnapshot): PreparedPositionSnapshot | null;
export declare function chooseBurstToken(randomBetweenNumber: (minInclusive: number, maxInclusive: number) => number, minInclusive: number, maxInclusive: number): number;
export declare function randomBelow(randomBytes: FugueRandomBytes, limit: bigint): bigint;
export declare function randomBelowNumber(randomBytes: FugueRandomBytes, limit: number): number;
export declare function defaultRandomBytes(byteLength: number, allowInsecureRandom: boolean): Uint8Array;
//# sourceMappingURL=fugue-support.d.ts.map