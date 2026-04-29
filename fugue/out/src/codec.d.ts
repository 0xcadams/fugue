export declare function encode62(value: bigint, width: number): string;
export declare function encode62Number(value: number, width: number): string;
export declare function decode62(value: string): bigint;
export declare function decodeBase62FixedWidth(value: string, width: number, maxAllowed: bigint): bigint | null;
export declare function decodeBase62FixedWidth(value: string, width: number, maxAllowed: number): number | null;
export declare function decodeBase62FixedWidthAt(value: string, start: number, width: number, maxAllowed: bigint): bigint | null;
export declare function decodeBase62FixedWidthAt(value: string, start: number, width: number, maxAllowed: number): number | null;
//# sourceMappingURL=codec.d.ts.map