import {
  formatPosition,
  formatRunPrefix,
  type FuguePosition,
  type FugueRunPrefix,
} from "../src";

declare function acceptPosition(value: FuguePosition): void;
declare function acceptRunPrefix(value: FugueRunPrefix): void;

const position = formatPosition({
  anchorPath: [1n, 2n],
  runId: 3n,
  slotPath: [4n, 5n],
});
const prefix = formatRunPrefix({ anchorPath: [1n, 2n], runId: 3n });

acceptPosition(position);
acceptRunPrefix(prefix);

// @ts-expect-error run prefixes are not positions
acceptPosition(prefix);
