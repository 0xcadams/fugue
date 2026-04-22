# Remaining Allocation Issues

This file tracks the remaining high-confidence false-exhaustion bugs in the current v3 allocator.

## Already Fixed

### Repeated `after()` / `before()` edge inserts growing depth

This regression has been fixed locally.

Previously, repeated one-off inserts at the list edges (`first()` + repeated `after(last)`, or repeated `before(first)`) always opened fresh descendant bursts, so depth grew by 1 on each insert and ordinary long-lived lists could fail after roughly 65 inserts.

The current unstaged changes fix that by advancing the top coord first, and the new tests verify that repeated edge inserts stay flat at burst depth 1.

---

## Remaining Issue 1: `between(left, right)` false exhaustion at max depth

### Summary

`between(left, right)` can still throw `BurstSpaceExhaustedError` even when a valid one-off key still exists between the two bounds.

### Affected code

- `src/fugue.ts:181`
- `src/fugue.ts:188`
- `src/fugue.ts:235`

### What happens

`between(left, right)` currently works like this:

1. parse the bounds
2. call `startBurst(left, right)`
3. open a fresh descendant burst under `left` or `toLeftAncestor(right)`
4. call `.next()`

That means it always tries to solve the gap by opening a new nested burst.

If the chosen ancestor is already at `MAX_BURST_DEPTH`, `startBurstFromAncestor(...)` throws immediately.

### Why this is a bug

This is a false exhaustion result.

There are cases where a valid same-depth key still exists between `left` and `right`, but the allocator throws because it only tried the nested-burst strategy.

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

This issue occurs when all of the following are true:

- `left` and `right` are both non-null
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

- `src/fugue.ts:208`
- `src/fugue.ts:222`
- `src/fugue.ts:235`

### What happens

The current edge helpers now do this:

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

The current local test around `tests/fugue.test.ts:235` still encodes the old false-exhaustion behavior by expecting failure as soon as top-coord space is exhausted. That expectation should be narrowed so it only expects failure when same-top-coord top-burst space is exhausted too.

---

## Suggested Priority

1. Fix `between(left, right)` false exhaustion first
2. Fix `after()` / `before()` boundary false exhaustion second

The first issue is the more direct public-API correctness problem for one-off inserts inside an existing deep gap. The second issue is rarer and mostly affects extreme boundary cases.
