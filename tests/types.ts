import { Fugue, type FuguePosition } from "../src";

declare function acceptPosition(value: FuguePosition): void;

const fugue = new Fugue();
const position = fugue.first();

acceptPosition(position);

// @ts-expect-error missing separators
acceptPosition("not-a-position");
