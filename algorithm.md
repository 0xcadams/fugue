# Algorithm

`fugue` v3 uses run-anchored lexicographic keys for ordered collaborative data.

## Key Forms

Normal form:

`<anchor>!<runId>!<slot>`

Escape-hatch form (only when needed):

`<anchor>!<runId>!<slot>!<subslot>[!<subslot2>...]`

- `anchor`: 64-bit unsigned integer, base62 width 11.
- `runId`: 96-bit unsigned integer, base62 width 17.
- `slot` and each `subslot`: 64-bit unsigned integer, base62 width 11.
- `!` (ASCII 33) is the separator.

Normal keys are fixed length: `11 + 1 + 17 + 1 + 11 = 41` chars.
Each escape-hatch level adds `1 + 11 = 12` chars.

## Goals

1. Plain lexicographic string sort equals logical list order.
2. Any client can generate keys locally (no central allocator).
3. Inserts before/after/between work without rewriting existing keys.
4. Bursts stay contiguous and concurrent bursts do not braid item-by-item.
5. Collision probability remains negligible in practice.

## Ordering Semantics

Sort is plain string compare.

Why this works:

1. Fields are fixed-width base62 components.
2. `!` sorts before base62 digits/letters.
3. Components compare in order: `anchor`, then `runId`, then `slot`, then deeper subslots.
4. If one key is a prefix of another, the shorter key sorts first.

So, for example:

`07!abc!50 < 07!abc!50!60 < 07!abc!51`

## Run Model

A run is one insertion burst (paste, uninterrupted typing, etc.).

All items in one run share:

`<anchor>!<runId>!`

Only slot components change inside a run. This is the anti-braiding property: each run is one contiguous sorted block.

## Constants

- `SLOT_MIN = 0`
- `SLOT_MAX = 2^64 - 1`
- `SLOT_MID = 2^63`
- `SLOT_STEP = 2^48` (default append/prepend stride)

## Operations

### 1) Start a new run between `L` and `R`

Inputs:

- `L` may be missing (insert at beginning)
- `R` may be missing (insert at end)
- if both exist, require `L < R`

Algorithm:

1. Parse bounds into `(anchor, runId, tail)`.
2. Convert missing bounds to run-prefix sentinels:
   - left sentinel: `(0, 0)`
   - right sentinel: `(2^64 - 1, 2^96 - 1)`
3. Choose anchor:
   - if `aR - aL >= 2`, choose midpoint `a = floor((aL + aR) / 2)`
   - otherwise pack under left anchor: `a = aL`
4. Choose `runId` at that anchor so the run prefix is strictly between neighbors:
   - if `a == aL`, require `runId > runIdL`
   - if `a == aR`, require `runId < runIdR`
5. Set first slot component to `SLOT_MID`.
6. Emit key in normal form.

### 2) Append/prepend within one run

Given run prefix `(anchor, runId)`:

- append: `slot = lastSlot + SLOT_STEP`
- prepend: `slot = firstSlot - SLOT_STEP`

When this stays within `[SLOT_MIN, SLOT_MAX]`, emit normal-form keys.

### 3) Insert between two items in the same run

If both neighbors share `(anchor, runId)`, insert using slot components:

1. Try midpoint at the current level.
2. If numeric gap is at least `2`, use that midpoint and stop.
3. If gap is `1` (adjacent), reuse the left value at that level and descend one level (escape hatch).

This creates a subslot key that still sorts strictly between neighbors.

Example:

- left: `...!50`
- right: `...!51`
- inserted: `...!50!50`

Ordering remains:

`...!50 < ...!50!50 < ...!51`

If a subslot gap also becomes adjacent, repeat the same rule:

`...!50!50 < ...!50!50!50 < ...!50!51`

This can recurse to arbitrary depth without rewriting existing keys.

### 4) Run escape hatch (long-burst edge exhaustion)

If append/prepend reaches slot-range ends for a run, continue the burst in a new adjacent run instead of rewriting old keys.

- append-side exhaustion: start a new run immediately after the exhausted run.
- prepend-side exhaustion: start a new run immediately before the exhausted run.

This is the run escape hatch. It may split one very long burst into multiple contiguous run blocks, while preserving correct sort order.

## Exhaustion and Packing

### Slot-gap exhaustion (inside one run)

Use the slot escape hatch (`subslot`, then deeper levels only if needed).

### Anchor exhaustion (between runs)

If there is no anchor value between neighbors, pack under an existing anchor and order runs with `runId`.

Example shape:

- existing left prefix: `(07, G1h9kQ)`
- existing right prefix: `(08, T9xYz1)`
- no anchor between 07 and 08 -> choose anchor 07
- pick `runId` with string order `G1h9kQ < newRunId`

Result: new run block lands between those neighbors.

### runId collisions and scarcity

- Random 96-bit `runId` collisions are negligible for practical scales.
- If a generated `runId` does not satisfy required ordering bounds, generate another.
- If no `runId` interval exists for the chosen anchor (`minRunId > maxRunId`), run-prefix space is exhausted at that location and key generation must fail explicitly.

## Collision Model

Default random source is CSPRNG (`crypto.getRandomValues`).
Custom RNG injection is supported for environments without Web Crypto.

## Complexity

- Normal key generation: `O(1)`
- Escape-hatch insertion: `O(d)` where `d` is added subslot depth (typically very small)
- Parse/format: `O(k)` where `k` is component count (`k = 3` in normal form)
- Key length: 41 chars in normal form, `41 + 12*d` with depth `d`
