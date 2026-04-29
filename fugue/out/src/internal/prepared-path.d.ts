export type PreparedPathView = Readonly<{
    topCoord: bigint;
    bursts: readonly number[];
    nestedCoords: readonly number[];
    finalCoord: number;
    depth: number;
}>;
export type PreparedPositionSnapshot = Readonly<PreparedPathView & {
    text: string;
}>;
export declare function preparedCoordAt(position: PreparedPathView, depthIndex: number): number;
export declare function comparePreparedPathSlices(left: PreparedPathView, leftDepth: number, right: PreparedPathView, rightDepth?: number): 1 | -1 | 0;
export declare function isPreparedPathPrefix(prefix: PreparedPathView, prefixDepth: number, value: PreparedPathView, valueDepth?: number): boolean;
export declare function comparePreparedPositions(left: PreparedPathView, right: PreparedPathView): 1 | -1 | 0;
export declare function isPreparedPositionPrefix(prefix: PreparedPathView, value: PreparedPathView): boolean;
export declare function nestedCoordsForBurstDepth(position: PreparedPathView, depth: number): readonly number[];
export declare function toPreparedLeftAncestor(position: PreparedPathView): PreparedPathView;
export declare function formatPreparedPosition(position: PreparedPathView): string;
export declare function formatPreparedPositionUnchecked(position: PreparedPathView): string;
export declare function midpointRightCoordBetween(left: number, right: number): number | null;
//# sourceMappingURL=prepared-path.d.ts.map