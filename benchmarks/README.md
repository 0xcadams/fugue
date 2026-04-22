# Benchmarks

Realistic cross-library benchmarks live in this workspace package so the root
library package does not need benchmark-only dependencies.

Run the benchmark suite with:

```bash
pnpm --dir benchmarks bench
```

Useful variants:

```bash
pnpm --dir benchmarks bench:smoke
pnpm --dir benchmarks bench:full
pnpm --dir benchmarks typecheck
```

The runner writes JSON reports to `benchmarks/reports/`.
