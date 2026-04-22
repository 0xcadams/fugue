# main vs v3 comparison

Generated with `pnpm compare:branches` using `scripts/compare-branches.mjs` after the shallower middle-gap allocator pass on top of stage 2 (`7 / 7` burst widths).
Raw data lives in `reports/main-v3-comparison.json`.

## Scope

- Compared clean `v3` `HEAD` against `main` in a detached worktree.
- Ran `pnpm test`, `pnpm test:types`, `pnpm build`, and `pnpm size` on both refs.
- Benchmarked empty-doc inserts, edge inserts, direct `between(..., null)` / `between(null, ...)`, random middle inserts, explicit burst/run growth, same-gap concurrent growth, validation throughput, sorting throughput, and same-gap collision behavior.

## Executive call

- Stage 1 fixed edge `between(...)` so edge inserts now stay flat and fast.
- Stage 2 fixed the measured same-gap collision regression in the deterministic 100k stress harness by moving burst ids to `7 / 7` width.
- The current shallower middle-gap allocator materially improves arbitrary middle inserts by reusing shared ancestors and sibling burst space before opening a fresh descendant burst.
- `v3` still wins on flat-edge workloads, bundle size, and public API size, and it is now effectively at parity on validation throughput.
- `v3` is still behind `main` on generic middle inserts and slightly behind on sorting, and the remaining max-depth and boundary fallback bugs are still open.

## Health checks

| Metric          |                                   main |                          v3 | Notes                                                |
| --------------- | -------------------------------------: | --------------------------: | ---------------------------------------------------- |
| Tests           |                              68 passed |                   78 passed | `v3` adds shallower-middle-gap regression coverage   |
| Coverage        |             100% stmts / 99.19% branch | 95.9% stmts / 93.72% branch | `main` still has the tighter correctness net         |
| `pnpm build`    |                                   pass |                        pass | `v3` builds cleanly, but the output is a bit larger  |
| `pnpm size`     |                                2.84 kB |                      2.6 kB | `v3` remains smaller, but regressed vs the prior run |
| Install hygiene | needed `--no-frozen-lockfile` fallback |                       clean | `main` lockfile is out of sync                       |

## Speed

Ops/sec from `reports/main-v3-comparison.json`:

| Workload                       |      main |        v3 |  Delta |
| ------------------------------ | --------: | --------: | -----: |
| empty doc insert               |   291,820 |   393,446 | +34.8% |
| `after()` chain                |   171,869 |   270,425 | +57.3% |
| `between(left, null)` chain    |   175,249 |   284,016 | +62.1% |
| `before()` chain               |   216,231 |   281,099 | +30.0% |
| `between(null, right)` chain   |   227,542 |   279,477 | +22.8% |
| random middle inserts          |   139,105 |    77,937 | -44.0% |
| explicit burst/run growth      |   603,846 |   554,641 |  -8.1% |
| concurrent same-gap sequences  |   604,972 |   538,733 | -10.9% |
| validation (`isFuguePosition`) |   545,514 |   549,364 |  +0.7% |
| sorting                        | 6,112,122 | 5,512,740 |  -9.8% |

Takeaways:

- `v3` still wins every measured edge workload.
- The new allocator pass makes random middle inserts much healthier: `v3` is still slower than `main`, but the gap is now moderate instead of catastrophic.
- Shorter middle-gap keys also pull validation throughput up to parity and bring sorting much closer to `main`.
- The remaining performance risk is now concentrated in deep arbitrary middle gaps and the still-open max-depth and boundary fallback cases.

## Key length and growth

| Scenario                                         | main           | v3                                  |
| ------------------------------------------------ | -------------- | ----------------------------------- |
| Empty doc / `after()` / `before()`               | fixed 41 chars | fixed 26 chars                      |
| Edge `between(..., null)` / `between(null, ...)` | fixed 41 chars | fixed 26 chars                      |
| Explicit burst/run                               | fixed 41 chars | fixed 41 chars                      |
| Random middle inserts                            | fixed 41 chars | avg 72.61, p50 56, p95 116, max 236 |
| Mixed validation dataset                         | fixed 41 chars | avg 46.51, p50 26, p95 116, max 176 |

Critical finding:

- `7 / 7` keeps flat keys compact enough while giving burst identity the same width at every depth.
- The current shallower allocator materially cuts middle-gap growth, which is why validation and sorting recovered so much in this run.
- `v3` still expands more than `main` on arbitrary middle inserts, but it no longer blows up nearly as early as the earlier stage-2 build.

That means the next algorithm pass should finish the remaining max-depth and edge-boundary fallbacks rather than spend more time on burst-token changes.

## Collision behavior

Same-gap uniqueness test: 100,000 inserts in one stable gap.

| Metric         |    main |      v3 |
| -------------- | ------: | ------: |
| Unique keys    | 100,000 | 100,000 |
| Collisions     |       0 |       0 |
| Collision rate |       0 |       0 |

This is the biggest stage 2 improvement:

- the previous `v3` build produced 6 collisions in this exact deterministic harness
- the current `7 / 7` build produces none
- collisions are still probabilistic in principle, but the measured default safety margin is now much healthier

## API usability and docs

### v3 strengths

- The public surface is much smaller in `src/index.ts:1`, which makes the main entrypoint easier to understand.
- The docs are more intentional about burst semantics: `README.md:74` and `algorithm.md:65` explain contiguous insertion bursts far better than `main`.
- For editor-style insertion, `startBurst(...).next()` is a cleaner mental model than `startRun(...).append()/prepend()`.
- Generic edge `between(...)` now behaves the same way users expect from `after()` and `before()`.

### v3 weaknesses

- The API is now more specialized. `main` exposes sentinels, parsing helpers, codec helpers, and tuning knobs in `/tmp/fugue-main-compare/src/index.ts:1`; `v3` hides most of that.
- `main` documents common list operations and sentinel bounds directly in `/tmp/fugue-main-compare/README.md:54` and `/tmp/fugue-main-compare/README.md:67`; `v3` is more text-editor-centric.
- Middle-gap behavior is much healthier than before, but it is still less predictable than `main` for general list users.
- `v3` still relies on a non-obvious hidden left/right coord model in `algorithm.md:36`, so the prose is clearer than the implementation model, but not actually simpler.

## Library-level metrics

| Metric            |     main |       v3 |  Delta |
| ----------------- | -------: | -------: | -----: |
| Runtime exports   |       26 |        9 | -65.4% |
| Built ESM size    | 19,546 B | 18,950 B |  -3.0% |
| Size-limit result |  2.84 kB |   2.6 kB |  -8.5% |

This is still a real win for `v3`: the package stays smaller and the public surface stays easier to scan, even though the latest allocator work increased size a bit versus the prior `v3` report.

## Recommendation

### For a general-purpose ordering-key library

Still stay with `main` for now.

Why:

- stable 41-char keys in every measured workload
- much better arbitrary `between(...)` performance
- slightly better sorting throughput
- simpler behavior once datasets include lots of arbitrary middle inserts

### For a burst-oriented collaborative text library

`v3` is now much closer.

Why:

- edge-path behavior is fixed
- same-gap collision behavior is materially safer in the measured harness
- arbitrary middle inserts are far less pathological than before
- validation throughput is now effectively at parity with `main`
- flat edge ops are faster and shorter
- explicit bursts remain competitive on speed

The remaining blockers are the max-depth one-off fallback, the edge-boundary fallback, and the residual middle-gap gap to `main`.

## Highest-priority fixes for v3

1. Add the missing same-depth one-off fallback for `between(left, right)` at max depth.
2. Extend `after()` / `before()` so they search remaining same-top-coord top-burst space before reporting exhaustion.
3. Keep the new collision, edge-path, and shallower-middle-gap regression coverage in place.
4. Re-run `pnpm compare:branches` and the full `benchmarks/` suite after those fallbacks land.

## Artifacts

- Harness: `scripts/compare-branches.mjs`
- Raw data: `reports/main-v3-comparison.json`
- This report: `reports/main-v3-comparison.md`
