# Benchmarks

Realistic cross-library benchmarks. Run the benchmark suite with:

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
