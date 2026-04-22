# Benchmarks

Realistic cross-library benchmarks live in this workspace package so the root
library package does not need benchmark-only dependencies.

Run the benchmark suite with:

```bash
bun --cwd benchmarks run bench
```

Useful variants:

```bash
bun --cwd benchmarks run bench:smoke
bun --cwd benchmarks run bench:full
bun --cwd benchmarks run typecheck
```

The runner writes JSON reports to `benchmarks/reports/`.
