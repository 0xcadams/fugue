# Algorithm

`fugue` v3 uses recursive burst paths.

The design goal is simple:

- plain lexicographic string sort equals logical order
- clients generate keys locally
- old keys never need rewriting
- uninterrupted insertion bursts stay contiguous
- later bursts can nest inside older text as fresh blocks

## Key shape

The serialized form is an alternating path:

```text
<topCoord>!<topBurst>!<coord>[!<burst>!<coord>]...
```

Token widths:

- `topCoord`: 11-char base62
- `topBurst`: 7-char base62
- nested `coord`: 6-char base62
- nested `burst`: 7-char base62
- separator: `!`
- maximum burst depth: 64 burst tokens per key

Every external position:

- starts with a coord token
- ends with a coord token
- contains exactly one more coord than burst tokens

## Coord tokens and the hidden side bit

Each coord encodes a local magnitude plus a hidden left/right side.

Stored positions must end in a right-side coord. Left-side coords are internal only. They let `fugue` open a fresh burst immediately before a descendant without changing the visible key format.

In the encoding, right-side coords are odd and the matching left-side coord is the preceding even value. So if a visible coord is `51`, its hidden left attachment point is `50`.

A key may contain an even coord internally, but it may not end with one.

## Ordering semantics

Sort is plain string compare.

This works because:

1. tokens are fixed-width base62 at each depth
2. `!` sorts before digits and letters
3. tokens compare left to right
4. if one key is a strict prefix of another, the shorter key sorts first

Conceptual example:

```text
50!A!51 < 50!A!51!B!50!C!51 < 50!A!51!B!51
```

Actual wire values are opaque fixed-width base62, but the ordering story is the same.

## Burst model

A burst is one uninterrupted insertion episode: typing, paste, drag-copy, etc.

Public API:

- `between(left, right)` -> one-item burst
- `startBurst(left, right)` -> explicit burst handle
- `burst.next()` -> next item in that burst

Each burst owns a prefix that ends in a burst token.
All items from that burst sort under that prefix, so the burst forms one contiguous block.

## Starting a fresh burst

`startBurst(left, right)` uses three cases.

### Case 1: empty document

If `left` and `right` are both missing:

1. use the fixed middle top coord
2. choose a random top burst token
3. return a burst prefix `<topCoord>!<topBurst>`

The first `next()` call appends the middle nested coord.

### Case 2: insert before `right`

Use this when `left` is missing or `right` is a descendant of `left`.

1. parse `right`
2. replace its final right-side coord with the matching left-side coord
3. append a fresh burst token

This creates a subtree that sorts before `right` but stays inside the requested gap.

### Case 3: all other gaps

Create a fresh burst as a right descendant of `left`:

1. parse `left`
2. append a fresh burst token
3. return that new burst prefix

Because descendants sort after their ancestor but before the next lexicographically larger sibling region, this stays within the requested gap.

## `between(left, right)`

`between(left, right)` is just:

```ts
startBurst(left, right).next();
```

So a one-off insert is treated as a size-1 burst.

## `burst.next()`

Given a burst prefix ending in a burst token:

```text
...!<burst>
```

`next()` works like this.

### First item

Append the middle nested coord:

```text
...!<burst>!<midCoord>
```

### Later items in the same local coord range

Advance the trailing coord by a fixed stride.

In the implementation:

- nested coords are 6-char base62
- the raw coord stride is `2^16`
- raw right-sided coords stay odd, so stepping preserves the side bit

### When the trailing coord reaches max

Deepen under the same burst:

1. append the same burst token again
2. append a fresh middle coord

Conceptually:

```text
50!A!MAX
50!A!MAX!A!MID
50!A!MAX!A!MID+step
```

That lets one long burst keep going without becoming a new burst.

## Fresh nested bursts inside old text

This is the key v3 property.

Example:

```text
50!A!50
50!A!60
```

Later insert a fresh burst between them:

```text
50!A!50
50!A!50!B!50
50!A!50!B!60
50!A!60
```

So the later burst gets its own identity `B` and stays contiguous.

## Concurrent bursts in the same gap

If two clients start bursts in the same gap, each gets a different random burst token.

Example:

```text
50!A!50
50!A!50!B!50
50!A!50!B!60
50!A!50!C!50
50!A!50!C!60
50!A!60
```

The result is `BBCC` or `CCBB`, not `BCBC`.

## Randomness and collision model

Burst tokens are sampled from a CSPRNG by default.

Important detail:

- top-level bursts serialize to width 7
- nested bursts serialize to width 7
- a long-running burst reuses its own token when it deepens, so burst identity has the same 7-char budget at every depth

Collisions are probabilistic rather than coordinated. With 7-char burst tokens and a CSPRNG, accidental sibling collisions are very rare in ordinary workloads, but still not impossible.

## Exhaustion and explicit errors

`fugue` still has hard limits.

### `BurstSpaceExhaustedError`

Thrown when a fresh nested burst would exceed the 64-burst depth cap.

### `CoordSpaceExhaustedError`

Thrown when `burst.next()` would need to deepen again but the key is already at the burst depth cap.

These errors are explicit on purpose.
`fugue` does not silently generate incorrect keys.

## Complexity

- common insert: typically `O(1)`
- `burst.next()`: typically `O(1)`
- parse/format/compare: `O(d)` where `d` is burst depth
- flat key length: 26 chars
- each extra nested burst level adds one `!burst!coord` pair, about 15 chars
