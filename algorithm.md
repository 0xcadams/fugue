# Algorithm

`fugue` v3 uses run-anchored lexicographic keys for ordered collaborative data.

## Key forms

Start with the simple shape:

`<anchor>!<runId>!<slot>`

When Fugue needs more precision, `anchor` and `slot` become paths:

`<anchor>[~<subanchor>...]!<runId>!<slot>[~<subslot>...]`

- `anchor` and each `subanchor`: 64-bit unsigned integer, base62 width 11
- `runId`: 96-bit unsigned integer, base62 width 17
- `slot` and each `subslot`: 64-bit unsigned integer, base62 width 11
- `!` is the field separator
- `~` is the path separator
- maximum `anchorPath` depth: 64 segments
- maximum `slotPath` depth: 64 segments

## Goals

1. Plain lexicographic string sort equals logical list order.
2. Any client can generate keys locally with no central allocator.
3. Inserts before/after/between work without rewriting existing keys.
4. Bursts stay contiguous and concurrent bursts do not braid item-by-item.
5. Collision probability remains negligible in practice.

## Ordering semantics

Sort is plain string compare.

Why this works:

1. Segments are fixed-width base62 components.
2. `!` sorts before `~`, digits, and letters.
3. Fields compare in order: `anchorPath`, then `runId`, then `slotPath`.
4. Inside a path, segments compare left to right.
5. If one path is a strict prefix of the other, the shorter path sorts first.

Examples:

```text
07!abc!50 < 07!abc!50~60 < 07!abc!51
07!abc!50 < 07~01!abc!50 < 08!abc!50
```

## Run model

A run is one insertion burst (paste, uninterrupted typing, etc.).

All items in one run share:

`<anchorPath>!<runId>`

Only the `slotPath` changes inside a run.
That is the anti-braiding property: each run is one contiguous sorted block.

## Constants

- `ANCHOR_MIN = 0`
- `ANCHOR_MAX = 2^64 - 1`
- `ANCHOR_MID = 2^63`
- `SLOT_MIN = 0`
- `SLOT_MAX = 2^64 - 1`
- `SLOT_MID = 2^63`
- internal run stride = `2^48`
- `MAX_ANCHOR_PATH_DEPTH = 64`
- `MAX_SLOT_PATH_DEPTH = 64`

## Why subanchors and subslots exist

Most keys stay flat.

Fugue only deepens a path when the current depth has no room:

- `subanchors` appear when there is no room to place a fresh run between neighboring runs at the current anchor depth
- `subslots` appear when there is no room to place an item between neighboring items in the same run at the current slot depth

This keeps old keys stable while still making new space.

## Core helper: `betweenPath(L, R)`

`betweenPath(L, R)` returns a path strictly between two paths.

Rule:

1. Walk both paths left to right.
2. If segments are equal, copy the shared segment and continue.
3. At the first depth with a numeric gap, choose a segment value inside that open interval and stop.
4. If there is no room at that depth, copy the exhausted prefix and descend one level deeper.
5. If the gap is mathematically impossible, return `null`.

This helper is used for:

- `anchorPath` allocation between runs
- `slotPath` allocation inside a run

## Operations

### 1) Start a new run between `L` and `R`

Inputs:

- `L` may be missing (insert at beginning)
- `R` may be missing (insert at end)
- if both exist, require `L < R`

Algorithm:

1. Parse bounds into `(anchorPath, runId, slotPath)`.
2. If both bounds are missing, choose:
   - `anchorPath = [ANCHOR_MID]`
   - `runId = random96()`
   - first `slotPath = [SLOT_MID]`
3. If both bounds have the same `anchorPath`, allocate only by `runId`:
   - require `left.runId < newRunId < right.runId`
4. If the bounds have different `anchorPath`s, try:
   - `anchorPath = betweenPath(left.anchorPath, right.anchorPath)`
   - `runId = random96()`
5. If there is no `anchorPath` space, pack under an existing neighboring `anchorPath`:
   - left candidate: same `anchorPath` with `runId > left.runId`
   - right candidate: same `anchorPath` with `runId < right.runId`
6. If neither candidate has `runId` space, fail with `RunPrefixExhaustedError`.

### 2) `run.next()` inside one run

Given run prefix `(anchorPath, runId)`:

- first `run.next()`: `slotPath = [SLOT_MID]`
- later `run.next()`: advance the last slot segment by the internal stride when possible
- if the current segment is full, clamp to `SLOT_MAX`
- if the segment is already `SLOT_MAX`, append a new `SLOT_MID` child segment

So a long burst can grow like:

```text
[MID]
[MID + stride]
...
[MAX]
[MAX~MID]
[MAX~MID + stride]
```

`run.next()` only fails when the slot path is already at depth 64 and every segment is exhausted.

### 3) Insert between two items in the same run

If both neighbors share `(anchorPath, runId)`, insert using slot paths:

1. call `betweenPath(left.slotPath, right.slotPath)`
2. if it succeeds, emit `<anchorPath>!<runId>!<slotPath>`
3. if it returns `null`, fail with `SlotExhaustedError`

Example:

```text
...!50 < ...!50~50 < ...!51
```

### 4) Open-edge fallback when fresh run-prefix allocation fails

`between(left, null)` and `between(null, right)` first try to create a fresh run.

If that fails at the boundary:

- append inside `left`'s run for `between(left, null)`
- prepend inside `right`'s run for `between(null, right)`

This preserves correct ordering even when there is no fresh run-prefix space at that edge.

## Exhaustion and packing

### Slot-path exhaustion (inside one run)

Use deeper `slotPath` segments.
If the gap is impossible or the slot path depth cap is hit, throw `SlotExhaustedError`.

### Anchor-path exhaustion (between runs)

Use deeper `anchorPath` segments.
If there is still no `anchorPath` space, pack under a neighboring `anchorPath` and order runs with `runId`.
If there is no valid `runId` interval either, throw `RunPrefixExhaustedError`.

## Why explicit errors still exist

Variable-depth paths make the space much denser, but not perfectly dense.

Examples of impossible gaps:

- there is no path strictly between `p` and `p~0`
- there is no fresh run prefix between identical `anchorPath`s with adjacent `runId`s

Fugue reports those cases explicitly instead of generating an incorrect key.

## Collision model

Default random source is CSPRNG (`crypto.getRandomValues`).
Custom RNG injection is supported for environments without Web Crypto.

When multiple valid keys exist, Fugue samples one randomly for:

- `runId` allocation
- bounded `betweenPath(...)` choices
- edge fallback choices

This keeps collisions probabilistic and negligible in practice.

## Complexity

- normal key generation: typically `O(1)`
- bounded path insertion: `O(d)` where `d` is added path depth
- parse/format: `O(k)` where `k` is path segment count
- key length: `41` chars in the flat form, plus `12` chars for each extra path segment in either path field
