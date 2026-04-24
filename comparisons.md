# Benchmark comparisons

This page summarizes the latest `bun run bench:full` results from `benchmarks/reports/latest-full.json`.

## How to read these tables

- Lower `applyMs` is better.
- Higher `ops/s` is better.
- These are full-suite results, not the smaller smoke run used by `bun run bench`.

The tables below list the full results for each workload, sorted from fastest to slowest by `applyMs`.

## Published edit trace

Replay of the published `automerge-perf` edit-by-index trace.

| Adapter                      | Family   |  Apply ms |        Ops/s | Status |
| ---------------------------- | -------- | --------: | -----------: | ------ |
| **list-positions**           | position |    81.884 | 1,094,389.62 | ok     |
| loro                         | crdt     |   174.037 |   514,907.75 | ok     |
| yjs                          | crdt     |   484.963 |   184,783.17 | ok     |
| position-strings             | position | 3,837.009 |    23,354.91 | ok     |
| **fugue**                    | position | 3,884.802 |    23,067.58 | ok     |
| fractional-indexing          | position | 3,947.819 |    22,699.37 | ok     |
| automerge                    | crdt     | 4,146.711 |    21,610.62 | ok     |
| jittered-fractional-indexing | position | 6,599.571 |    13,578.61 | ok     |

## Paragraph hotspot

Four collaborators repeatedly edit the same paragraph-sized hotspot.

| Adapter                      | Family   |  Apply ms |      Ops/s | Status |
| ---------------------------- | -------- | --------: | ---------: | ------ |
| **loro**                     | crdt     |    19.607 | 510,021.93 | ok     |
| yjs                          | crdt     |    40.221 | 248,626.34 | ok     |
| list-positions               | position |    45.640 | 219,106.05 | ok     |
| position-strings             | position |   224.539 |  44,535.69 | ok     |
| fractional-indexing          | position |   230.642 |  43,357.24 | ok     |
| **fugue**                    | position |   299.989 |  33,334.56 | ok     |
| automerge                    | crdt     |   599.481 |  16,681.10 | ok     |
| jittered-fractional-indexing | position | 1,072.698 |   9,322.29 | ok     |

## Document session

Three collaborators edit a multi-section document with mostly local typing.

| Adapter                      | Family   |  Apply ms |      Ops/s | Status |
| ---------------------------- | -------- | --------: | ---------: | ------ |
| **loro**                     | crdt     |    31.352 | 510,334.27 | ok     |
| yjs                          | crdt     |   112.843 | 141,789.92 | ok     |
| list-positions               | position |   142.752 | 112,082.49 | ok     |
| position-strings             | position |   725.915 |  22,041.15 | ok     |
| fractional-indexing          | position |   922.972 |  17,335.30 | ok     |
| **fugue**                    | position |   968.516 |  16,520.12 | ok     |
| automerge                    | crdt     | 1,156.769 |  13,831.63 | ok     |
| jittered-fractional-indexing | position | 2,445.773 |   6,541.90 | ok     |

## Kanban session

A multi-column board with inserts, moves, duplicates, and deletes.

| Adapter                      | Family   | Apply ms |      Ops/s | Status |
| ---------------------------- | -------- | -------: | ---------: | ------ |
| **fractional-indexing**      | position |   19.716 | 760,803.41 | ok     |
| **fugue**                    | position |   40.639 | 369,103.57 | ok     |
| position-strings             | position |   72.280 | 207,526.29 | ok     |
| jittered-fractional-indexing | position |  153.620 |  97,643.54 | ok     |
| list-positions               | position |  418.696 |  35,825.52 | ok     |

Skipped: `yjs`, `automerge`, and `loro` do not implement board workloads in this suite.

## Source

- Report: `benchmarks/reports/latest-full.json`
- Runner docs: `benchmarks/README.md`
