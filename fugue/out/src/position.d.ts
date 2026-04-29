import { comparePreparedPositions, isPreparedPositionPrefix, toPreparedLeftAncestor, type PreparedPathView } from "./internal/prepared-path";
import { COORD_STRIDE, MAX_BURST_DEPTH, NESTED_BURST_MAX, NESTED_BURST_MAX_NUMBER, NESTED_BURST_WIDTH, NESTED_COORD_MAX, NESTED_COORD_MAX_NUMBER, NESTED_COORD_MAX_RIGHT, NESTED_COORD_MAX_RIGHT_NUMBER, NESTED_COORD_MID, NESTED_COORD_MID_NUMBER, NESTED_COORD_WIDTH, SEPARATOR, TOP_BURST_MAX, TOP_BURST_MAX_NUMBER, TOP_BURST_WIDTH, TOP_COORD_MAX, TOP_COORD_MAX_RIGHT, TOP_COORD_MID, TOP_COORD_WIDTH, burstMaxAtDepth, burstMaxNumberAtDepth, burstWidthAtDepth, coordMaxAtDepth, coordMaxNumberAtDepth, coordWidthAtDepth, isRightCoord, isRightCoordNumber, toLeftCoord } from "./internal/position-schema";
export { COORD_STRIDE, MAX_BURST_DEPTH, NESTED_BURST_MAX, NESTED_BURST_MAX_NUMBER, NESTED_BURST_WIDTH, NESTED_COORD_MAX, NESTED_COORD_MAX_NUMBER, NESTED_COORD_MAX_RIGHT, NESTED_COORD_MAX_RIGHT_NUMBER, NESTED_COORD_MID, NESTED_COORD_MID_NUMBER, NESTED_COORD_WIDTH, SEPARATOR, TOP_BURST_MAX, TOP_BURST_MAX_NUMBER, TOP_BURST_WIDTH, TOP_COORD_MAX, TOP_COORD_MAX_RIGHT, TOP_COORD_MID, TOP_COORD_WIDTH, burstMaxAtDepth, burstMaxNumberAtDepth, burstWidthAtDepth, comparePreparedPositions, coordMaxAtDepth, coordMaxNumberAtDepth, coordWidthAtDepth, isPreparedPositionPrefix, isRightCoord, isRightCoordNumber, toLeftCoord, toPreparedLeftAncestor, };
export type FuguePosition = `${string}${typeof SEPARATOR}${string}${typeof SEPARATOR}${string}`;
export type ParsedFuguePosition = Readonly<{
    coords: readonly bigint[];
    bursts: readonly bigint[];
}>;
export type PreparedFuguePath = PreparedPathView;
export type PreparedFuguePosition = Readonly<PreparedFuguePath & {
    text: FuguePosition;
}>;
export declare function tokenCount(position: ParsedFuguePosition): number;
export declare function tryParsePosition(value: string): ParsedFuguePosition | null;
export declare function isFuguePosition(value: string): value is FuguePosition;
export declare function parsePosition(value: string): ParsedFuguePosition;
export declare function preparePosition(value: FuguePosition): PreparedFuguePosition;
export declare function formatPosition(position: ParsedFuguePosition): FuguePosition;
export declare function formatPreparedPosition(position: PreparedFuguePath): FuguePosition;
export declare function formatPreparedPositionUnchecked(position: PreparedFuguePath): FuguePosition;
export declare function comparePositions(left: ParsedFuguePosition, right: ParsedFuguePosition): 1 | -1 | 0;
export declare function isPositionPrefix(prefix: ParsedFuguePosition, value: ParsedFuguePosition): boolean;
export declare function toLeftAncestor(position: ParsedFuguePosition): ParsedFuguePosition;
//# sourceMappingURL=position.d.ts.map