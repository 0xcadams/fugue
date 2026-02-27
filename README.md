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

## How it works

Positions are opaque strings with this shape:

`<anchor>!<runId>!<slot>[!<subslot>...]`

Toy examples below use short readable values like `07!n4Kp2x!50`.
Real `fugue` keys are fixed-width base62 fields.

Use this mental model only: sort positions as plain strings, ascending.

### Common operations

#### Insert at top or bottom

```ts
// Example toy positions:
// currentFirst.position = "05!aaaaaa!50"
// currentLast.position  = "09!zzzzzz!50"

const top = fugue.between(null, currentFirst.position);
const bottom = fugue.between(currentLast.position, null);

// Example output (toy):
// top    = "02!k3M9Qa!50"
// bottom = "0D!p9T2Lm!50"
```

#### Insert between two neighbors

```ts
// Example toy neighbors:
// left.position  = "05!aaaaaa!50"
// right.position = "09!zzzzzz!50"

const middle = fugue.between(left.position, right.position);

// Example output (toy):
// middle = "07!n4Kp2x!50"
```

#### Move an item to a new location

```ts
// Example toy target gap:
// newLeft.position  = "07!Q7mL1d!60"
// newRight.position = "07!n4Kp2x!50"

const newPosition = fugue.between(newLeft.position, newRight.position);
// save newPosition on the moved row

// Example output (toy):
// newPosition = "07!a8BdE2!50"
```

#### Insert a burst contiguously (typing/paste)

```ts
// Example toy bounds around insertion gap:
// left.position  = "05!aaaaaa!50"
// right.position = "09!zzzzzz!50"

const run = fugue.startRun(left.position, right.position);

const p1 = run.first;
const p2 = run.after();
const p3 = run.after();

// Example output (toy):
// p1 = "07!n4Kp2x!50"
// p2 = "07!n4Kp2x!60"
// p3 = "07!n4Kp2x!70"
```

Use `between(...)` for single inserts.
Use `startRun(...)` + `after/before` for bursts.

#### Run lifecycle in text editors

In collaborative editing, treat one run as one continuous typing/paste burst.

Keep using the current run while inserts are continuing in the same cursor gap.
Start a new run when any of these happens:

- cursor/selection moved (click/tap, arrow/home/end, selection jump, undo/redo relocation)
- observed insertion bounds changed (different left/right neighbors, including remote edits once applied locally)

```ts
// assumes: const fugue = new Fugue();
let activeRun: { first: string; after(): string } | null = null;
let usedFirst = false;
let lastLeft: string | null = null;
let lastRight: string | null = null;

function nextPosition(
  left: string | null,
  right: string | null,
  cursorMoved: boolean,
) {
  const boundsChanged = left !== lastLeft || right !== lastRight;

  if (activeRun === null || cursorMoved || boundsChanged) {
    activeRun = fugue.startRun(left, right);
    usedFirst = false;
  }

  const position = usedFirst ? activeRun.after() : activeRun.first;
  usedFirst = true;
  lastLeft = left;
  lastRight = right;
  return position;
}
```

### Common problems

#### Problem: insert between two existing items without rewriting old keys

Existing items:

- `L = 05!aaaaaa!50`
- `R = 09!zzzzzz!50`

Concept: key parts compare left-to-right (`anchor`, then `runId`, then `slot`).

Solution:

1. choose `anchor = 07` (between `05` and `09`)
2. choose `runId = n4Kp2x`
3. start at `slot = 50`

Output:

`07!n4Kp2x!50`

#### Problem: keep burst inserts grouped

Concept: one burst shares one `<anchor>!<runId>!` prefix.

Solution: call `run.after()` repeatedly within the same run.

Output:

```text
07!n4Kp2x!50
07!n4Kp2x!60
07!n4Kp2x!70
```

#### Problem: concurrent bursts in the same gap should not braid item-by-item

Concept: each burst gets a different `runId`.

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

#### Problem: insert between adjacent keys in the same run

Concept: if slot gap exists, midpoint works; if adjacent, use escape-hatch subslot.

Example:

```text
...!50 < ...!50!50 < ...!51
```

This can recurse deeper when needed (`...!50!50!50`, etc.).
If no representable space remains at that location, `fugue` throws an explicit exhaustion error.

## Guarantees and limits

- keys are opaque strings; compare/sort as strings
- key generation is typically O(1) and does not rewrite existing keys
- run-based burst inserts remain contiguous sorted blocks
- collisions are negligible with CSPRNG-based `runId` generation
- extreme exhaustion cases are explicit errors (not silent corruption)

## Environment support

Works in web, Node, Bun, and React Native.

By default, Fugue uses `globalThis.crypto.getRandomValues` for `runId` generation.

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

## v3 migration notes

Version 3 is a major algorithm update.

- v2 keys are not compatible with v3 parsing/generation
- client IDs are no longer encoded in keys
- `new Fugue(clientID)` is accepted for transition, but `clientID` is ignored
- for burst semantics, use `startRun(...)` + `after/before`

## License

[Unlicense](LICENSE)
