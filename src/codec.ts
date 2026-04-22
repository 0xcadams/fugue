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

export function encode62(value: bigint, width: number) {
  if (width <= 0) {
    throw new InvalidBase62Error(`width must be > 0, got ${width}`);
  }

  if (value < 0n) {
    throw new InvalidBase62Error(`value must be >= 0, got ${value}`);
  }

  let out = "";
  let rest = value;

  while (rest > 0n) {
    const digit = Number(rest % BASE62);
    out = DIGITS[digit]! + out;
    rest /= BASE62;
  }

  if (out.length === 0) {
    out = "0";
  }

  if (out.length > width) {
    throw new InvalidBase62Error(
      `value ${value} cannot be encoded in width ${width} (needs ${out.length})`,
    );
  }

  return out.padStart(width, "0");
}

export function encode62Number(value: number, width: number) {
  if (width <= 0) {
    throw new InvalidBase62Error(`width must be > 0, got ${width}`);
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidBase62Error(
      `value must be a safe integer >= 0, got ${value}`,
    );
  }

  let out = "";
  let rest = value;

  while (rest > 0) {
    const digit = rest % BASE62_NUMBER;
    out = DIGITS[digit]! + out;
    rest = Math.floor(rest / BASE62_NUMBER);
  }

  if (out.length === 0) {
    out = "0";
  }

  if (out.length > width) {
    throw new InvalidBase62Error(
      `value ${value} cannot be encoded in width ${width} (needs ${out.length})`,
    );
  }

  return out.padStart(width, "0");
}

export function decode62(value: string) {
  let out = 0n;

  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    const digit = digitToValue(charCode);
    if (digit < 0) {
      throw new InvalidBase62Error(`Invalid base62 character "${value[i]!}"`);
    }

    out = out * BASE62 + BigInt(digit);
  }

  return out;
}

export function parseBase62FixedWidth(
  value: string,
  width: number,
  maxAllowed: bigint,
): bigint | null {
  return parseBase62FixedWidthAt(value, 0, width, maxAllowed);
}

export function parseBase62FixedWidthNumber(
  value: string,
  width: number,
  maxAllowed: number,
): number | null {
  return parseBase62FixedWidthNumberAt(value, 0, width, maxAllowed);
}

export function parseBase62FixedWidthAt(
  value: string,
  start: number,
  width: number,
  maxAllowed: bigint,
): bigint | null {
  if (start < 0 || width <= 0 || start + width > value.length) {
    return null;
  }

  let out = 0n;
  for (let i = 0; i < width; i++) {
    const digit = digitToValue(value.charCodeAt(start + i));
    if (digit < 0) {
      return null;
    }

    out = out * BASE62 + BigInt(digit);
  }

  if (out > maxAllowed) {
    return null;
  }

  return out;
}

export function parseBase62FixedWidthNumberAt(
  value: string,
  start: number,
  width: number,
  maxAllowed: number,
): number | null {
  if (start < 0 || width <= 0 || start + width > value.length) {
    return null;
  }

  let out = 0;
  for (let i = 0; i < width; i++) {
    const digit = digitToValue(value.charCodeAt(start + i));
    if (digit < 0) {
      return null;
    }

    out = out * BASE62_NUMBER + digit;
  }

  if (!Number.isSafeInteger(out) || out > maxAllowed) {
    return null;
  }

  return out;
}
