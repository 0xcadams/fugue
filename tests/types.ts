import { Fugue, type FuguePosition } from "../src";

declare function acceptPosition(value: FuguePosition): void;

const fugue = new Fugue();
const burst = fugue.startBurst(null, null);
const position = burst.next();

acceptPosition(position);

// @ts-expect-error missing separators
acceptPosition("not-a-position");
