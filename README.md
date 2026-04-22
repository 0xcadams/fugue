# fugue

Client-generated ordering keys for collaborative lists and text.

`fugue` creates opaque string keys that you can store and sort with plain string comparison.
It is built for local-first and collaborative apps where clients need to generate order keys locally without rewriting older keys.

It also has first-class support for collaborative text editors - users can edit the same sections simultaneously without stomping on each other.

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

`between(left, right)` handles the common insert cases:

- `between(null, right)` -> before the first item
- `between(left, null)` -> after the last item
- `between(left, right)` -> between two existing items

## Mental model

Think of a key as a path through a tree.

- a `coord` token says where you are at that level
- a `burst` token says which insertion burst owns the subtree below it
- a fresh burst inside old text becomes a nested subtree, not a reused old burst id

Examples below use shortened readable tokens for intuition.

If one burst types `cat`, then a later burst inserts `red` after `c`:

```text
root
`-- 50  top coord
    `-- A  original burst
        |-- 50 -> c
        |   `-- B  later burst
        |       |-- 50 -> r
        |       |-- 60 -> e
        |       `-- 70 -> d
        |-- 60 -> a
        `-- 70 -> t
```

So `50!A!50!B!60` means:
top coord `50`, burst `A`, coord `50`, child burst `B`, coord `60`.

Shared prefix means shared branch.
That is why later inserts stay together as one contiguous block.

## Burst API

For typing, paste, or any other uninterrupted insertion episode, use an explicit burst:

```ts
import { Fugue } from "fugue";

const fugue = new Fugue();

const left = fugue.first();
const right = fugue.after(left);

const burst = fugue.startBurst(left, right);

const p1 = burst.next();
const p2 = burst.next();
const p3 = burst.next();
```

Use `between(...)` for one-offs.
Use `startBurst(...)` + `next()` for multi-item bursts.

## Example: type a burst

One burst typing `cat` might look like this conceptually:

```text
50!A!50
50!A!60
50!A!70
```

Those three keys sort as one contiguous block because they share the same burst prefix `50!A`.

## Example: later insert inside old text

For the `cat` plus later `red` insert above, the sorted conceptual keys are:

```text
50!A!50
50!A!50!B!50
50!A!50!B!60
50!A!50!B!70
50!A!60
50!A!70
```

The later burst `B` is a real nested burst.
It stays contiguous as its own block instead of interleaving item-by-item with the older burst.

## Example: concurrent bursts in the same gap

If two clients start bursts in the same old gap, each burst still sorts as a block:

```text
50!A!50
50!A!50!B!50
50!A!50!B!60
50!A!50!C!50
50!A!50!C!60
50!A!60
```

So you get `BBCC`, not `BCBC`.

## How the keys look

Behind that tree, the wire format is a recursive alternating path:

```text
<topCoord>!<topBurst>!<coord>[!<burst>!<coord>]...
```

For the usual ordered-list case, keys stay simple and compact.

If you mostly use `first()`, `after()`, and occasional `between(left, right)`, positions are typically just a top-level path:

```text
<topCoord>!<topBurst>!<coord>
```

Extra `!<burst>!<coord>` pairs only show up when later inserts need to nest inside older content.

Where:

- `topCoord` is 11-char fixed-width base62
- `topBurst` is 7-char fixed-width base62
- nested `coord` tokens are 6-char fixed-width base62
- nested `burst` tokens are 7-char fixed-width base62

Actual keys are opaque and fixed-width.
Examples above use shortened readable tokens for intuition.

## Ordering

Sort keys with plain binary/code-point string comparison.
Do not use locale collation.

Why this works:

- all tokens are fixed-width base62 at their depth
- `!` sorts before digits and letters
- tokens compare left to right
- if one key is a strict prefix of another, the shorter key sorts first

## Burst behavior

- the first `burst.next()` emits a middle coord under the burst prefix
- later `burst.next()` calls advance by a fixed stride inside the same burst
- when that local coord space fills up, the burst deepens under itself and continues
- the burst only fails when the recursive burst depth cap is exhausted

## Guarantees and limits

- keys are opaque strings; compare them as strings
- key generation is local and does not rewrite older keys
- fresh bursts can nest inside older bursts
- concurrent sibling bursts stay contiguous blocks
- flat keys are compact; each extra nested burst level adds one `!burst!coord` pair
- burst depth is capped at 64
- collisions are still probabilistic, but 7-char burst tokens make accidental sibling collisions very rare with a CSPRNG
- extreme exhaustion cases throw explicit errors instead of silently generating wrong keys

## Randomness

By default, `fugue` uses `globalThis.crypto.getRandomValues`.

If your runtime does not provide Web Crypto, pass a custom RNG:

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

## Validation

If you load keys from storage or the network, validate them before reuse:

```ts
import { Fugue, isFuguePosition } from "fugue";

const fugue = new Fugue();

if (isFuguePosition(maybePosition)) {
  fugue.after(maybePosition);
}
```

## Deep dive

See [`algorithm.md`](./algorithm.md) for the full v3 format and allocation rules.

## License

[Unlicense](LICENSE)
