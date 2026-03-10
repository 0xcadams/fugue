# fugue

Client-generated ordering keys for collaborative ordered data.

`fugue` creates opaque string keys you can store and sort to represent item order.
It is designed for collaborative apps where multiple clients insert and move items concurrently.

## What problem does this solve?

If your app has ordered items (cards, rows, comments, blocks), you usually hit these issues:

- inserting between two items often requires renumbering old items
- concurrent inserts can interleave in hard-to-reason-about ways
- clients need to generate order keys locally (optimistic/offline), without central coordination

`fugue` solves this with keys that:

- sort correctly with plain string comparison
- can be generated independently on any client
- support insert-before, insert-after, and insert-between
- keep insertion bursts contiguous as sorted blocks

## Installation

```bash
bun add fugue
# or
npm install fugue
# or
pnpm add fugue
# or
yarn add fugue
```

## Quick start

```ts
import { Fugue } from "fugue";

const fugue = new Fugue();

const first = fugue.first();
const second = fugue.after(first);
const middle = fugue.between(first, second);

console.log(first < middle && middle < second);
// true
```

`between(left, right)` handles all common insert cases:

- `between(null, right)` -> before first item
- `between(left, null)` -> after last item
- `between(left, right)` -> between two items

## How the keys look

Most of the time, think of a key as:

`<anchor>!<runId>!<slot>`

That simple shape is enough for the common mental model:

- `anchor` says where the run sits among other runs
- `runId` identifies one insertion burst and breaks ties between concurrent runs
- `slot` says where one item sits inside that run

When Fugue needs more precision, `anchor` and `slot` can grow into paths:

`<anchor>[~<subanchor>...]!<runId>!<slot>[~<subslot>...]`

Examples below use short readable values like `07!n4Kp2x!50` or `07~04!n4Kp2x!50~10`.
Real Fugue keys use fixed-width base62 segments.

## Why subanchors and subslots exist

Most inserts fit in the simple form.

Fugue only adds deeper path segments when the current level runs out of room:

- `subanchors` appear when there is no room between neighboring runs at the current anchor depth
- `subslots` appear when there is no room between neighboring items in the same run at the current slot depth

This lets Fugue keep inserting without rewriting older keys.

## Ordering

Sort keys with plain binary/code-point string comparison.
Do not use locale collation.

Conceptually, keys compare by:

1. `anchorPath`
2. `runId`
3. `slotPath`

Within `anchorPath` or `slotPath`:

- compare segments left to right
- the first differing segment decides order
- if one path is a strict prefix of the other, the shorter path sorts first

## Common operations

### Insert at top or bottom

```ts
// Example positions:
// currentFirst = "05!aaaaaa!50"
// currentLast  = "09!zzzzzz!50"

const top = fugue.between(null, currentFirst);
const bottom = fugue.between(currentLast, null);

// Example output:
// top    = "02!k3M9Qa!50"
// bottom = "0D!p9T2Lm!50"
```

### Insert between two neighbors

```ts
// Example neighbors:
// left  = "05!aaaaaa!50"
// right = "09!zzzzzz!50"

const middle = fugue.between(left, right);

// Example output:
// middle = "07!n4Kp2x!50"
```

### Move an item to a new location

```ts
// Example target gap:
// newLeft  = "07!Q7mL1d!60"
// newRight = "07!n4Kp2x!50"

const newPosition = fugue.between(newLeft, newRight);
// save newPosition on the moved row
```

### Insert a burst contiguously (typing/paste)

```ts
// Example bounds around insertion gap:
// left  = "05!aaaaaa!50"
// right = "09!zzzzzz!50"

const run = fugue.startRun(left, right);

const p1 = run.next();
const p2 = run.next();
const p3 = run.next();

// Example output:
// p1 = "07!n4Kp2x!50"
// p2 = "07!n4Kp2x!60"
// p3 = "07!n4Kp2x!70"
```

Use `between(...)` for single inserts.
Use `startRun(...)` + `next()` for bursts.

If one slot path segment fills up, `run.next()` deepens the slot path instead of failing immediately.
It only throws `SlotExhaustedError` after the slot path reaches the maximum depth of 64 segments.

### Run lifecycle in text editors

In collaborative editing, treat one run as one continuous typing/paste burst.

Keep using the current run while inserts are continuing in the same cursor gap.
Start a new run when any of these happens:

- cursor/selection moved (click/tap, arrow/home/end, selection jump, undo/redo relocation)
- observed insertion bounds changed (different left/right neighbors, including remote edits once applied locally)

```ts
import { Fugue, type FuguePosition } from "fugue";

const fugue = new Fugue();
let activeRun: { next(): FuguePosition } | null = null;
let lastLeft: FuguePosition | null = null;
let lastRight: FuguePosition | null = null;

function nextPosition(
  left: FuguePosition | null,
  right: FuguePosition | null,
  cursorMoved: boolean,
) {
  const boundsChanged = left !== lastLeft || right !== lastRight;

  if (activeRun === null || cursorMoved || boundsChanged) {
    activeRun = fugue.startRun(left, right);
  }

  const position = activeRun.next();
  lastLeft = left;
  lastRight = right;
  return position;
}
```

### Validate or parse stored values

If you load keys from a database or network boundary, validate them before passing them back into `Fugue`.

```ts
import {
  Fugue,
  isFuguePosition,
  isFugueRunPrefix,
  tryParsePosition,
  tryParseRunPrefix,
} from "fugue";

const fugue = new Fugue();

if (isFuguePosition(maybePosition)) {
  fugue.after(maybePosition);
}

const parsedPosition = tryParsePosition(maybePosition);
const parsedPrefix = tryParseRunPrefix(maybePrefix);

console.log(isFugueRunPrefix(maybePrefix), parsedPosition, parsedPrefix);
```

## Common problems

### Problem: insert between two existing items without rewriting old keys

Existing items:

- `L = 05!aaaaaa!50`
- `R = 09!zzzzzz!50`

Solution:

1. choose an `anchorPath` between the two neighboring runs
2. choose a random `runId`
3. start at a middle `slotPath`

Output:

`07!n4Kp2x!50`

### Problem: keep burst inserts grouped

One burst shares one `<anchorPath>!<runId>!` prefix.

Solution: call `run.next()` repeatedly within the same run.

Output:

```text
07!n4Kp2x!50
07!n4Kp2x!60
07!n4Kp2x!70
```

### Problem: concurrent bursts in the same gap should not braid item-by-item

Each burst gets a different `runId`.

Solution: full-string sort keeps each run as a contiguous block.

Output:

```text
07!Q7mL1d!50
07!Q7mL1d!60
07!Q7mL1d!70
07!n4Kp2x!50
07!n4Kp2x!60
07!n4Kp2x!70
```

### Problem: there is no room at the current anchor or slot depth

Solution: grow the path.

- when runs are too tight, grow `anchorPath` with `~<subanchor>`
- when items inside a run are too tight, grow `slotPath` with `~<subslot>`

Example:

```text
07!n4Kp2x!50 < 07!n4Kp2x!50~50 < 07!n4Kp2x!51
```

## Guarantees and limits

- keys are opaque strings; compare/sort them as strings
- key generation is typically `O(1)` and does not rewrite existing keys
- run-based burst inserts remain contiguous sorted blocks
- `anchorPath` depth is capped at 64 segments
- `slotPath` depth is capped at 64 segments
- collisions are probabilistic and negligible in practice with CSPRNG-based randomness (`runId`, bounded path gaps, and edge fallbacks)
- extreme exhaustion cases are explicit errors, not silent corruption

Some gaps are still mathematically impossible, even with variable-depth paths.
For example, there is no key strictly between a prefix and its immediate zero-descendant (`p < p~0`), and there is no fresh run prefix between identical `anchorPath`s with adjacent `runId`s.

## Environment support

Works in web, Node, Bun, and React Native.

By default, Fugue uses `globalThis.crypto.getRandomValues` for `runId` generation and bounded path allocation.

If your runtime does not provide Web Crypto, pass custom RNG:

```ts
import { randomBytes } from "node:crypto";
import { Fugue } from "fugue";

const fugue = new Fugue({
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
});
```

Optional insecure fallback:

```ts
const fugue = new Fugue({ allowInsecureRandom: true });
```

## Deep dive

For full algorithm details and edge-case behavior, see [`algorithm.md`](./algorithm.md).

## License

[Unlicense](LICENSE)
