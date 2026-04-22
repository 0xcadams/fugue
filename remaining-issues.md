# Remaining Allocation Issues

This file tracks the remaining high-confidence false-exhaustion bugs in the current v3 allocator.

## Current status

- The current `startBurst(...)` allocator now searches shallower shared ancestors and bounded sibling burst space before falling back to a fresh descendant burst.
- That change materially improved the measured middle-gap story in `reports/main-v3-comparison.json`: random middle inserts rose from `25,295` to `77,937` ops/sec, validation rose from `240,731` to `549,364` ops/sec, and sorting rose from `2,379,631` to `5,512,740` ops/sec versus the previous local `v3` run.
- Key growth is also much healthier: random-middle keys dropped from avg length `255.12` to `72.61`, and the mixed validation dataset dropped from avg length `107.48` to `46.51`.
- The remaining bugs are now narrower than before. They are mostly correctness gaps at max depth and boundary conditions, not the broad middle-gap regression that existed before this allocator pass.
- The full `benchmarks/` suite has not yet been rerun against this exact worktree, so the published edit trace failure status is still not revalidated here.

## Already Fixed

### Repeated `after()` / `before()` edge inserts growing depth

This regression has been fixed locally.

Previously, repeated one-off inserts at the list edges (`first()` + repeated `after(last)`, or repeated `before(first)`) always opened fresh descendant bursts, so depth grew by 1 on each insert and ordinary long-lived lists could fail after roughly 65 inserts.

The current unstaged changes fix that by advancing the top coord first, and the new tests verify that repeated edge inserts stay flat at burst depth 1.

### Shallower middle-gap burst reuse

This regression is also now partially fixed locally.

Previously, `startBurst(left, right)` usually solved arbitrary middle inserts by opening a fresh descendant burst under `left` or `toLeftAncestor(right)`, so repeated middle edits caused deep recursive growth and very large keys.

The current allocator now tries shallower shared ancestors first and reuses sibling burst space when it exists. That does not solve every max-depth case, but it dramatically reduces key growth and throughput loss in the measured middle-gap benchmarks.

---

## Remaining Issue 1: `between(left, right)` same-depth fallback at max depth

### Summary

After the current shallower allocator pass, `between(left, right)` can still throw `BurstSpaceExhaustedError` even when a valid one-off key still exists between the two bounds.

### Affected code

- `src/fugue.ts` `between(...)`
- `src/fugue.ts` `startBurst(...)`
- `src/fugue.ts` `startBurstFromAncestor(...)`

### What happens

`between(left, right)` currently works like this:

1. parse the bounds
2. call `startBurst(left, right)`
3. try shallower shared ancestors and sibling burst space
4. if none exists, try to open a fresh descendant burst
5. call `.next()`

That means it still always tries to solve the gap by returning a real burst handle.

If no new burst can be opened because the relevant ancestor is already at `MAX_BURST_DEPTH`, `startBurstFromAncestor(...)` still throws.

### Why this is a bug

This is now a narrower false exhaustion result.

There are cases where a valid same-depth key still exists between `left` and `right`, but the allocator throws because `between(...)` has no direct one-off fallback once all burst-opening strategies are exhausted.

Example shape:

```text
left  = ...!101
right = ...!303
```

A valid key like this still exists:

```text
...!201
```

If the shared prefix is already at depth 64, the current code still throws instead of using the remaining coord space.

### When this occurs

This issue now occurs when all of the following are true:

- `left` and `right` are both non-null
- the allocator cannot reuse a shallower ancestor or sibling burst interval
- they already sit at `MAX_BURST_DEPTH`
- they share the same full path except for the final coord
- there is still an odd coord strictly between the two final coords

This is most likely in deep, long-lived hot spots where many insertions have already nested into the same local region.

### Suggested fix

Add a one-off fallback in `between(...)` that runs before throwing when fresh nesting is impossible.

That fallback should:

- only apply to `between(...)`, not `startBurst(...)`
- detect when both bounds share the same full prefix except the final coord
- detect whether there is still an odd coord strictly between the final coords
- if so, return a direct formatted position at the same depth instead of opening a new burst

`startBurst(...)` should remain strict, because it must return a real `FugueBurst` handle.

### Suggested regression tests

Add tests that cover:

1. **Success case**
   - construct two depth-64 positions with the same full prefix
   - use final coords like `101` and `303`
   - assert `between(left, right)` succeeds
   - assert the returned key sorts strictly between them
   - assert the returned key keeps the same burst depth

2. **True exhaustion case**
   - same setup, but use final coords like `101` and `103`
   - assert `between(left, right)` still throws, because there is no odd coord between them

---

## Remaining Issue 2: `after()` / `before()` false exhaustion at top-coord boundaries

### Summary

`after()` and `before()` can still throw too early at the extreme top-coord boundaries when the key is already at max depth, even though valid same-top-coord keys may still exist via unused top-burst space.

### Affected code

- `src/fugue.ts` `startBurstAfterParsed(...)`
- `src/fugue.ts` `startBurstBeforeParsed(...)`
- `src/fugue.ts` `startBurstFromAncestor(...)`

### What happens

The current edge helpers still do this:

- `after(position)`:
  1. try the next top coord
  2. if none exists, nest under the current key

- `before(position)`:
  1. try the previous top coord
  2. if none exists, nest under the left ancestor

This fixes the common shallow edge case.

However, if the key is already at `MAX_BURST_DEPTH`, that fallback nesting path throws immediately.

### Why this is a bug

This is also a false exhaustion result.

At the top-coord boundary, there may still be valid larger/smaller keys that reuse the same top coord but choose a different top-level burst token.

The current code does not search that remaining same-top-coord space before throwing.

So the allocator can report exhaustion even though valid keys still exist.

### When this occurs

This issue occurs when all of the following are true:

- the position is already at the maximum or minimum top coord
- there is no next/previous top coord available
- the position is already at `MAX_BURST_DEPTH`
- same-top-coord ordering room still exists via a different top-level burst

This is a boundary + max-depth issue, so it is rarer than the `between(...)` bug.

### Suggested fix

Extend the edge allocator so that when next/previous top-coord space is exhausted and further nesting is impossible, it tries one more strategy:

- stay on the same top coord
- allocate a different top-level burst token that still sorts after/before the reference key

Only throw once both of these are exhausted:

- neighboring top-coord space
- remaining same-top-coord top-burst space

### Suggested regression tests

Add tests that cover:

1. **Success case at right boundary**
   - build a position at `TOP_COORD_MAX_RIGHT`
   - ensure it is already at max depth
   - leave larger same-top-coord top-burst space available
   - assert `after(position)` succeeds

2. **Success case at left boundary**
   - build a position at top coord `1`
   - ensure it is already at max depth
   - leave smaller same-top-coord top-burst space available
   - assert `before(position)` succeeds

3. **True exhaustion case**
   - construct positions where no next/previous top coord exists
   - no valid same-top-coord top-burst space exists
   - assert the allocator still throws

### Note on current tests

The current local test named `startBurstAfter exhausts once top-level space is exhausted` in `tests/fugue.test.ts` still encodes the old false-exhaustion behavior by expecting failure as soon as top-coord space is exhausted. That expectation should be narrowed so it only expects failure when same-top-coord top-burst space is exhausted too.

---

## Suggested Priority

1. Fix `between(left, right)` max-depth one-off fallback first
2. Fix `after()` / `before()` same-top-coord boundary fallback second
3. Re-run the full `benchmarks/` suite and refresh the docs after those fallbacks land

The first issue is the more direct public-API correctness problem for one-off inserts inside an existing deep gap. The second issue is rarer and mostly affects extreme boundary cases.
