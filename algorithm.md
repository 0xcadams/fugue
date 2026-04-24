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

Examples below use shortened symbolic tokens for intuition.
Actual wire values are opaque fixed-width base62, and real stored positions must end in a right-side coord, so example final coords are shown as odd values.

## Ordering semantics

Sort is plain string compare.

This works because:

1. tokens are fixed-width base62 at each depth
2. `!` sorts before digits and letters
3. tokens compare left to right
4. if one key is a strict prefix of another, the shorter key sorts first

Conceptual example:

```text
50!A!51 < 50!A!51!B!51 < 50!A!61
```

Actual wire values are opaque fixed-width base62, but the ordering story is the same.

## Burst model

A burst is one uninterrupted insertion episode: typing, paste, drag-copy, etc.

Public API:

- `between(left, right)` -> one-off insert
- `startBurst(left, right)` -> explicit burst handle
- `burst.next()` -> next item in that burst

Each burst owns a prefix that ends in a burst token.
All items from that burst sort under that prefix, so the burst forms one contiguous block.

`startBurst(left, right)` is the strict API: it either opens a fresh burst prefix or throws.
`between(left, right)` usually returns a size-1 fresh burst, but in rare exhaustion cases it can fall back to a same-depth midpoint instead.

## Starting a fresh burst

`startBurst(left, right)` chooses the shallowest fresh burst that stays inside the requested gap.

### Case 1: empty document

If `left` and `right` are both missing:

1. use the fixed middle top coord
2. choose a random top burst token
3. return a burst prefix `<topCoord>!<topBurst>`

The first `next()` call appends the middle nested coord.

### Case 2: insert at an edge

If exactly one bound is present, prefer a flat top-level key first.

For `startBurstAfter(left)`:

1. move to the next top coord if one exists
2. otherwise open a nested burst under `left`
3. at the far-right top-coord boundary, if the key is already at max burst depth, reuse the same top coord with a larger top-level burst token if that burst space still exists

`startBurstBefore(right)` is symmetric:

1. move to the previous top coord if one exists
2. otherwise open a nested burst before `right` via its hidden left attachment point
3. at the far-left top-coord boundary, if the key is already at max burst depth, reuse the same top coord with a smaller top-level burst token if that burst space still exists

So repeated edge inserts stay flat until top-level coord space is exhausted.

### Case 3: `left` is a strict prefix of `right`

First try to open a child burst directly under `left` with a burst token smaller than `right`'s next burst token.

If no child burst token fits there, fall back to `right`'s hidden left attachment point and open the burst there.

That still sorts after `left` and before `right`, but uses one extra burst level.

### Case 4: general middle gap

Otherwise, inspect shallower shared ancestors before falling back to the deepest left path.

1. if a sibling burst token fits between `left` and `right` at some shared depth, open there
2. otherwise open a fresh burst directly under `left`

This lets `fugue` reopen a shallower middle gap when one exists instead of always nesting under the deepest left path.

## `between(left, right)`

`between(left, right)` first tries:

```ts
startBurst(left, right).next();
```

If that fails with `BurstSpaceExhaustedError`, `between()` can still succeed when `left` and `right` already have the same depth and path and there is still room between their final coords.

In that case it returns a same-depth midpoint coord instead of opening a fresh burst.

So `between()` is slightly more permissive than `startBurst()`: it may succeed in a gap where no fresh burst prefix can be opened.

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
50!A!51
50!A!61
```

Later insert a fresh burst between them:

```text
50!A!51
50!A!51!B!51
50!A!51!B!61
50!A!61
```

So the later burst gets its own identity `B` and stays contiguous.

## Concurrent bursts in the same gap

If two clients start bursts in the same gap, each gets a different random burst token.

Example:

```text
50!A!51
50!A!51!B!51
50!A!51!B!61
50!A!51!C!51
50!A!51!C!61
50!A!61
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

Thrown when `fugue` cannot open a fresh burst in the requested gap.

Common reasons:

- opening another nested burst would exceed the 64-burst depth cap
- no burst token remains between the requested bounds at the chosen depth

`between(left, right)` still tries the same-depth midpoint fallback described above before rethrowing this error.

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
