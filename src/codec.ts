import { InvalidBase62Error } from "./errors";

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE62 = BigInt(DIGITS.length);
const BASE62_NUMBER = DIGITS.length;

const DIGIT_TO_VALUE = new Map<string, number>();
for (let i = 0; i < DIGITS.length; i++) {
  const digit = DIGITS[i];
  if (digit !== undefined) {
    DIGIT_TO_VALUE.set(digit, i);
  }
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
    const char = value[i]!;

    const digit = DIGIT_TO_VALUE.get(char);
    if (digit === undefined) {
      throw new InvalidBase62Error(`Invalid base62 character "${char}"`);
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
  if (value.length !== width) {
    return null;
  }

  let out = 0n;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;

    const digit = DIGIT_TO_VALUE.get(char);
    if (digit === undefined) {
      return null;
    }

    out = out * BASE62 + BigInt(digit);
  }

  if (out > maxAllowed) {
    return null;
  }

  return out;
}

export function parseBase62FixedWidthNumber(
  value: string,
  width: number,
  maxAllowed: number,
): number | null {
  if (value.length !== width) {
    return null;
  }

  let out = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;

    const digit = DIGIT_TO_VALUE.get(char);
    if (digit === undefined) {
      return null;
    }

    out = out * BASE62_NUMBER + digit;
  }

  if (!Number.isSafeInteger(out) || out > maxAllowed) {
    return null;
  }

  return out;
}
