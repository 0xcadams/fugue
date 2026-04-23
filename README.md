# fugue

Client-generated position keys for local-first lists and collaborative text.

`fugue` creates opaque string positions that you can store anywhere and sort with ordinary string comparison. It is built for sync systems where clients need to create positions locally, insert into the same gaps concurrently, and never rewrite older keys.

- generate positions on the client
- store them as plain strings
- sort them with normal binary/code-point string comparison
- insert anywhere without reindexing existing items
- keep typing, paste, and duplicate bursts contiguous under concurrent edits

Use it for kanban cards, outline nodes, layers, comments, blocks, rows, spans, or characters.

`fugue` is not a full CRDT. It solves ordering only. If your app already has a central server, optimistic updates, or an app-specific sync layer, you probably do not need a full CRDT just to solve ordered sequences. For a good argument in that direction, see [Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html).

## Why fugue?

Ordered sequences are one of the annoying parts of collaborative systems.

- Array indices are unstable under concurrent edits.
- Plain fractional indexing is deterministic: the same gap produces the same key.
- Randomized midpoint schemes reduce collision risk, but still treat each insert as an unrelated point.
- Full text CRDTs solve a much larger problem than many apps actually have.

`fugue` takes a different angle: it models an uninterrupted insertion episode as a burst. A burst might be typing a word, pasting a paragraph, duplicating several cards, or inserting a run of list items. Each burst gets its own identity, so concurrent inserts stay grouped as blocks instead of collapsing into collisions or interleaving item-by-item.

If you came here from Figma's posts on [multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) or [fractional indexing](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/), `fugue` lives in that same design space: ordered sequences in collaborative systems. The difference is that it is built around independently generated client positions and burst-style inserts.

## Installation

```bash
npm install fugue
# or
pnpm add fugue
# or
yarn add fugue
# or
bun add fugue
```

## Quick start: a kanban column

Store a `position` alongside each card. To insert a card, look at the cards on either side and call `between(left, right)`.

```ts
import { Fugue, type FuguePosition } from "fugue";

type Card = {
  id: string;
  title: string;
  position: FuguePosition;
};

const fugue = new Fugue();
let nextId = 1;

const compareByPosition = (a: Card, b: Card) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

function insertCard(cards: Card[], index: number, title: string): Card {
  const left = index === 0 ? null : cards[index - 1]!.position;
  const right = index === cards.length ? null : cards[index]!.position;

  const card: Card = {
    id: String(nextId++),
    title,
    position: fugue.between(left, right),
  };

  cards.splice(index, 0, card);
  return card;
}

const todo: Card[] = [];

insertCard(todo, 0, "Ship multiplayer");
insertCard(todo, 1, "Write docs");
insertCard(todo, 1, "Record demo");

todo.sort(compareByPosition);

console.log(todo.map((card) => card.title));
// ["Ship multiplayer", "Record demo", "Write docs"]
```

`between(left, right)` handles the common insert cases:

- `between(null, null)` -> first item in an empty sequence
- `between(null, right)` -> before the first item
- `between(left, null)` -> after the last item
- `between(left, right)` -> between two existing items

## Collaborative text: bursts stay together

A burst is one uninterrupted insertion episode: typing, paste, drag-copy, autofill, and so on.

Here is a tiny text example. Start with `ct`, then later insert `ar` between `c` and `t` to make `cart`:

```ts
import { Fugue, type FuguePosition } from "fugue";

type Char = {
  ch: string;
  position: FuguePosition;
};

const fugue = new Fugue();

const base = fugue.startBurst(null, null);
const c = base.next();
const t = base.next();

const insert = fugue.startBurst(c, t);
const a = insert.next();
const r = insert.next();

const chars: Char[] = [
  { ch: "c", position: c },
  { ch: "t", position: t },
  { ch: "a", position: a },
  { ch: "r", position: r },
];

chars.sort((x, y) =>
  x.position < y.position ? -1 : x.position > y.position ? 1 : 0,
);

console.log(chars.map((char) => char.ch).join(""));
// cart
```

Use `between(...)` for one-off inserts. Use `startBurst(...)` + `next()` for typing, paste, or any uninterrupted multi-item insert.

This is the key property:

- if Alice types `ab` and Bob types `XY` in the same old gap, `fugue` gives `abXY` or `XYab`
- it does not degrade into `aXbY`

That is the reason `fugue` is useful for collaborative text-like sequences, not just plain ordered lists.

## API guide

- `first()` -> first position in an empty sequence
- `before(position)` -> one item before an existing position
- `after(position)` -> one item after an existing position
- `between(left, right)` -> one-off insert between neighbors
- `startBurst(left, right)` -> open a multi-item burst in a gap
- `startBurstBefore(right)` -> open a burst before an existing position
- `startBurstAfter(left)` -> open a burst after an existing position
- `burst.next()` -> next position in the current burst

A good rule of thumb:

- one item -> `between(...)`
- typing or paste -> `startBurst(...)` + `next()`
- repeated prepend -> `startBurstBefore(...)` + `next()`
- repeated append -> `startBurstAfter(...)` + `next()`

## How fugue compares

### vs plain fractional indexing

Plain fractional indexing is elegant when one authority can allocate or repair positions. But it is deterministic: the same gap produces the same key. Under simultaneous client-generated inserts, that means collisions unless you add extra machinery such as server-side reassignment or another tiebreak.

`fugue` is designed for that concurrent case. Clients can independently mint positions in the same old gap, and each burst still keeps its own identity.

### vs jittered fractional indexing

Jittered midpoint schemes reduce collision risk by adding randomness. That helps with same-gap inserts, but each insert is still just another midpoint. There is no first-class notion of one typing or paste episode owning a contiguous block.

`fugue` makes bursts explicit in both the mental model and the API.

### vs full CRDTs

Libraries like Yjs, Loro, and Automerge solve a much broader problem: replicated state, merge semantics, and richer collaborative data structures.

Choose a full CRDT when you want a full collaborative data model, especially in replica-first or peer-to-peer systems.

Choose `fugue` when you already own the rest of the sync model and just need ordered positions for lists or text.

### vs other position-string libraries

There are several other good libraries in this space, with different growth and performance tradeoffs. `fugue`'s distinctive bet is the burst-oriented model: uninterrupted inserts are a first-class concept instead of an emergent property of midpoint allocation.

See [benchmarks/README.md](./benchmarks/README.md) for realistic cross-library benchmarks.

## Mental model

Think of a key as a path through a tree.

- a `coord` token says where you are at that level
- a `burst` token says which insertion burst owns the subtree below it
- a later burst inside old content becomes a fresh nested subtree

Examples below use shortened symbolic tokens and small odd coords for intuition. Actual keys are opaque fixed-width base62 values.

If one burst types `cat`, then a later burst inserts `red` after `c`:

```text
root
`-- 50
    `-- A
        |-- 51 -> c
        |   `-- B
        |       |-- 51 -> r
        |       |-- 61 -> e
        |       `-- 71 -> d
        |-- 61 -> a
        `-- 71 -> t
```

So `50!A!51!B!61` means:

- top coord `50`
- burst `A`
- coord `51`
- child burst `B`
- coord `61`

Shared prefix means shared branch. That is why later inserts stay together as one contiguous block.

## Example: type a burst

One burst typing `cat` might look like this conceptually:

```text
50!A!51
50!A!61
50!A!71
```

Those three keys sort as one contiguous block because they share the same burst prefix `50!A`.

## Example: later insert inside old text

For the `cat` plus later `red` insert above, the sorted conceptual keys are:

```text
50!A!51
50!A!51!B!51
50!A!51!B!61
50!A!51!B!71
50!A!61
50!A!71
```

The later burst `B` is a real nested burst. It stays contiguous as its own block instead of interleaving item-by-item with the older burst.

## Example: concurrent bursts in the same gap

If two clients start bursts in the same old gap, each burst still sorts as a block:

```text
50!A!51
50!A!51!B!51
50!A!51!B!61
50!A!51!C!51
50!A!51!C!61
50!A!61
```

So you get `BBCC`, not `BCBC`.

## How the keys look

Behind that tree, the wire format is a recursive alternating path:

```text
<topCoord>!<topBurst>!<coord>[!<burst>!<coord>]...
```

For the common ordered-list case, keys stay flat and compact:

```text
<topCoord>!<topBurst>!<coord>
```

Practical facts:

- common flat key length is 26 chars
- each extra nested burst level adds about 15 chars
- nesting usually appears when later inserts reopen old gaps or when one long burst deepens under itself

Token widths:

- `topCoord`: 11-char fixed-width base62
- `topBurst`: 7-char fixed-width base62
- nested `coord`: 6-char fixed-width base62
- nested `burst`: 7-char fixed-width base62

Keys are opaque. Treat them as values to store, sort, and round-trip, not something to inspect or edit.

## Ordering

Sort keys with plain binary/code-point string comparison.

Do not use locale collation.

Why this works:

- all tokens are fixed-width base62 at their depth
- `!` sorts before digits and letters
- tokens compare left to right
- if one key is a strict prefix of another, the shorter key sorts first

Conceptually:

```text
50!A!51 < 50!A!51!B!51 < 50!A!61
```

## Burst behavior

- the first `burst.next()` emits a middle coord under the burst prefix
- later `burst.next()` calls advance by a fixed stride inside the same burst
- when that local coord space fills up, the burst deepens under itself and continues
- repeated `after()`, `before()`, and edge `between()` inserts stay flat until top-level coord space is exhausted

`startBurst(...)` is the strict API: it either opens a fresh burst or throws.

`between(...)` usually returns a size-1 fresh burst, but in rare exhaustion cases it can fall back to a same-depth midpoint instead.

## Guarantees and limits

- keys are opaque strings; compare them as strings
- key generation is local and never rewrites older keys
- fresh bursts can nest inside older bursts
- concurrent sibling bursts stay contiguous blocks
- later inserts into old text stay grouped as later bursts
- burst depth is capped at 64
- collisions are still probabilistic, but 7-char burst tokens make accidental sibling collisions very rare with a CSPRNG
- extreme exhaustion cases throw explicit errors instead of silently generating wrong keys

`fugue` handles ordering only. You still own content storage, deletion semantics, permissions, transport, and the rest of your sync model.

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

## Benchmarks and deep dive

- [algorithm.md](./algorithm.md) explains the full format and allocation rules
- [benchmarks/README.md](./benchmarks/README.md) covers realistic cross-library benchmarks
- the benchmark suite compares `fugue` with other position-key libraries and full CRDT libraries on text and board workloads

## License

[Unlicense](LICENSE)
