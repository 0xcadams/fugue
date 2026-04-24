import { InvalidBase62Error } from "./errors";

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE62 = BigInt(DIGITS.length);
const BASE62_NUMBER = DIGITS.length;

function digitToValue(charCode: number) {
  if (charCode >= 48 && charCode <= 57) {
    return charCode - 48;
  }

  if (charCode >= 65 && charCode <= 90) {
    return charCode - 65 + 10;
  }

  if (charCode >= 97 && charCode <= 122) {
    return charCode - 97 + 36;
  }

  return -1;
}

function assertWidth(width: number) {
  if (width <= 0) {
    throw new InvalidBase62Error(`width must be > 0, got ${width}`);
  }
}

function finalizeEncodedValue(
  encoded: string,
  width: number,
  value: bigint | number,
) {
  const normalized = encoded.length === 0 ? "0" : encoded;
  if (normalized.length > width) {
    throw new InvalidBase62Error(
      `value ${value} cannot be encoded in width ${width} (needs ${normalized.length})`,
    );
  }

  return normalized.padStart(width, "0");
}

function hasFixedWidthSlice(value: string, start: number, width: number) {
  return start >= 0 && width > 0 && start + width <= value.length;
}

function parseBase62DigitsAt<T>(
  value: string,
  start: number,
  width: number,
  seed: T,
  accumulate: (current: T, digit: number) => T,
  isAllowed: (current: T) => boolean,
): T | null {
  if (!hasFixedWidthSlice(value, start, width)) {
    return null;
  }

  let out = seed;
  for (let index = 0; index < width; index++) {
    const digit = digitToValue(value.charCodeAt(start + index));
    if (digit < 0) {
      return null;
    }

    out = accumulate(out, digit);
  }

  return isAllowed(out) ? out : null;
}

export function encode62(value: bigint, width: number) {
  assertWidth(width);

  if (value < 0n) {
    throw new InvalidBase62Error(`value must be >= 0, got ${value}`);
  }

  let encoded = "";
  let rest = value;

  while (rest > 0n) {
    const digit = Number(rest % BASE62);
    encoded = DIGITS[digit]! + encoded;
    rest /= BASE62;
  }

  return finalizeEncodedValue(encoded, width, value);
}

export function encode62Number(value: number, width: number) {
  assertWidth(width);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidBase62Error(
      `value must be a safe integer >= 0, got ${value}`,
    );
  }

  let encoded = "";
  let rest = value;

  while (rest > 0) {
    const digit = rest % BASE62_NUMBER;
    encoded = DIGITS[digit]! + encoded;
    rest = Math.floor(rest / BASE62_NUMBER);
  }

  return finalizeEncodedValue(encoded, width, value);
}

export function decode62(value: string) {
  let out = 0n;

  for (let index = 0; index < value.length; index++) {
    const digit = digitToValue(value.charCodeAt(index));
    if (digit < 0) {
      throw new InvalidBase62Error(
        `Invalid base62 character "${value[index]!}"`,
      );
    }

    out = out * BASE62 + BigInt(digit);
  }

  return out;
}

export function decodeBase62FixedWidth(
  value: string,
  width: number,
  maxAllowed: bigint,
): bigint | null;

export function decodeBase62FixedWidth(
  value: string,
  width: number,
  maxAllowed: number,
): number | null;

export function decodeBase62FixedWidth(
  value: string,
  width: number,
  maxAllowed: bigint | number,
): bigint | number | null {
  if (typeof maxAllowed === "bigint") {
    return decodeBase62FixedWidthAt(value, 0, width, maxAllowed);
  }

  return decodeBase62FixedWidthAt(value, 0, width, maxAllowed);
}

export function decodeBase62FixedWidthAt(
  value: string,
  start: number,
  width: number,
  maxAllowed: bigint,
): bigint | null;

export function decodeBase62FixedWidthAt(
  value: string,
  start: number,
  width: number,
  maxAllowed: number,
): number | null;

export function decodeBase62FixedWidthAt(
  value: string,
  start: number,
  width: number,
  maxAllowed: bigint | number,
): bigint | number | null {
  if (typeof maxAllowed === "bigint") {
    return parseBase62DigitsAt(
      value,
      start,
      width,
      0n,
      (current, digit) => current * BASE62 + BigInt(digit),
      (current) => current <= maxAllowed,
    );
  }

  return parseBase62DigitsAt(
    value,
    start,
    width,
    0,
    (current, digit) => current * BASE62_NUMBER + digit,
    (current) => Number.isSafeInteger(current) && current <= maxAllowed,
  );
}
