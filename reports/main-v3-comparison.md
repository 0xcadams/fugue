# main vs v3 comparison

Generated with `pnpm compare:branches` using `scripts/compare-branches.mjs` after stage 2 (`7 / 7` burst widths).
Raw data lives in `reports/main-v3-comparison.json`.

## Scope

- Compared clean `v3` `HEAD` against `main` in a detached worktree.
- Ran `pnpm test`, `pnpm test:types`, `pnpm build`, and `pnpm size` on both refs.
- Benchmarked empty-doc inserts, edge inserts, direct `between(..., null)` / `between(null, ...)`, random middle inserts, explicit burst/run growth, same-gap concurrent growth, validation throughput, sorting throughput, and same-gap collision behavior.

## Executive call

- Stage 1 fixed edge `between(...)` so edge inserts now stay flat and fast.
- Stage 2 fixed the measured same-gap collision regression in the deterministic 100k stress harness by moving burst ids to `7 / 7` width.
- `v3` still wins on flat-edge workloads, bundle size, and public API size.
- `v3` still loses badly on generic middle `between(...)` workloads: repeated middle inserts are slower and keys grow much more than `main`.
- `v3` is much safer than before, but it is still not clearly better than `main` as a general-purpose ordering-key library until middle-gap allocation improves.

## Health checks

| Metric          |                                   main |                           v3 | Notes                                                 |
| --------------- | -------------------------------------: | ---------------------------: | ----------------------------------------------------- |
| Tests           |                              68 passed |                    74 passed | `v3` adds edge-path and collision regression coverage |
| Coverage        |             100% stmts / 99.19% branch | 97.25% stmts / 95.07% branch | `main` still has the tighter correctness net          |
| `pnpm build`    |                                   pass |                         pass | `v3` is still smaller                                 |
| `pnpm size`     |                                2.84 kB |                      2.33 kB | `v3` remains about 18% smaller                        |
| Install hygiene | needed `--no-frozen-lockfile` fallback |                        clean | `main` lockfile is out of sync                        |

## Speed

Ops/sec from `reports/main-v3-comparison.json`:

| Workload                       |      main |        v3 |  Delta |
| ------------------------------ | --------: | --------: | -----: |
| empty doc insert               |   305,030 |   345,939 | +13.4% |
| `after()` chain                |   166,347 |   270,824 | +62.8% |
| `between(left, null)` chain    |   164,109 |   285,828 | +74.2% |
| `before()` chain               |   220,606 |   289,624 | +31.3% |
| `between(null, right)` chain   |   230,134 |   289,195 | +25.7% |
| random middle inserts          |   126,755 |    25,295 | -80.0% |
| explicit burst/run growth      |   577,060 |   561,105 |  -2.8% |
| concurrent same-gap sequences  |   566,467 |   554,055 |  -2.2% |
| validation (`isFuguePosition`) |   555,284 |   240,731 | -56.6% |
| sorting                        | 7,882,079 | 2,379,631 | -69.8% |

Takeaways:

- `v3` still wins every measured edge workload.
- Stage 2 slightly reduced flat-edge speed versus the `6 / 5` version, but `v3` still stays ahead of `main` there.
- The main remaining problem is unchanged: once `v3` starts nesting in arbitrary middle gaps, performance and key length degrade quickly.

## Key length and growth

| Scenario                                         | main           | v3                                    |
| ------------------------------------------------ | -------------- | ------------------------------------- |
| Empty doc / `after()` / `before()`               | fixed 41 chars | fixed 26 chars                        |
| Edge `between(..., null)` / `between(null, ...)` | fixed 41 chars | fixed 26 chars                        |
| Explicit burst/run                               | fixed 41 chars | fixed 41 chars                        |
| Random middle inserts                            | fixed 41 chars | avg 255.12, p50 251, p95 341, max 446 |
| Mixed validation dataset                         | fixed 41 chars | avg 107.48, p50 26, p95 326, max 461  |

Critical finding:

- `7 / 7` keeps flat keys compact enough while giving burst identity the same width at every depth.
- The collision fix increased flat keys by only one char (`25 -> 26`) and explicit nested burst keys by three chars (`38 -> 41`).
- The remaining growth problem is still concentrated in arbitrary middle inserts, where `v3` expands into deep recursive paths much earlier than `main`.

That means the next algorithm pass should focus on shallower middle-gap allocation rather than more burst-token changes.

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
- Middle-gap behavior is still much less predictable than `main` for general list users.
- `v3` still relies on a non-obvious hidden left/right coord model in `algorithm.md:36`, so the prose is clearer than the implementation model, but not actually simpler.

## Library-level metrics

| Metric            |     main |       v3 |  Delta |
| ----------------- | -------: | -------: | -----: |
| Runtime exports   |       26 |        9 | -65.4% |
| Built ESM size    | 19,546 B | 16,225 B | -17.0% |
| Size-limit result |  2.84 kB |  2.33 kB | -18.0% |

This is still a real win for `v3`: the package stays smaller and the public surface stays easier to scan.

## Recommendation

### For a general-purpose ordering-key library

Still stay with `main` for now.

Why:

- stable 41-char keys in every measured workload
- much better arbitrary `between(...)` performance
- much better sort and validation throughput once datasets include many middle inserts

### For a burst-oriented collaborative text library

`v3` is now much closer.

Why:

- edge-path behavior is fixed
- same-gap collision behavior is materially safer in the measured harness
- flat edge ops are faster and shorter
- explicit bursts remain competitive on speed

The remaining blocker is middle-gap growth, not burst identity.

## Highest-priority fixes for v3

1. Add a shallower allocator for arbitrary middle-gap `between(...)` calls before falling back to nested bursts.
2. Keep the new collision and edge-path regression coverage in place.
3. Re-run `pnpm compare:branches` after the middle-gap allocator lands.

## Artifacts

- Harness: `scripts/compare-branches.mjs`
- Raw data: `reports/main-v3-comparison.json`
- This report: `reports/main-v3-comparison.md`
