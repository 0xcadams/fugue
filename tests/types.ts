import {
  formatPosition,
  formatRunPrefix,
  type FuguePosition,
  type FugueRunPrefix,
} from "../src";

declare function acceptPosition(value: FuguePosition): void;
declare function acceptRunPrefix(value: FugueRunPrefix): void;

const position = formatPosition({ anchor: 1n, runId: 2n, slot: 3n });
const prefix = formatRunPrefix(1n, 2n);

acceptPosition(position);
acceptRunPrefix(prefix);

// @ts-expect-error run prefixes are not positions
acceptPosition(prefix);

// @ts-expect-error positions are not run prefixes
acceptRunPrefix(position);

// @ts-expect-error arbitrary strings are not branded positions
acceptPosition("00000000001!00000000000000002!00000000003");

// @ts-expect-error arbitrary strings are not branded run prefixes
acceptRunPrefix("00000000001!00000000000000002!");
