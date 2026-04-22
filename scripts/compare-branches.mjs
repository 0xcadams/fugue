import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const DEFAULT_BASE_REF = "main";
const DEFAULT_BASE_DIR = "/tmp/fugue-main-compare";
const DEFAULT_OUTPUT = resolve(repoRoot, "reports", "main-v3-comparison.json");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    if (equalsIndex >= 0) {
      args[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[argument.slice(2)] = next;
      index++;
      continue;
    }

    args[argument.slice(2)] = "true";
  }

  return args;
}

function run(command, args, cwd) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const finishedAt = performance.now();

  return {
    command: [command, ...args].join(" "),
    cwd,
    durationMs: Number((finishedAt - startedAt).toFixed(2)),
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runOrThrow(command, args, cwd) {
  const result = run(command, args, cwd);
  if (result.exitCode !== 0) {
    const message = [
      `Command failed: ${result.command}`,
      `cwd: ${cwd}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(message);
  }

  return result;
}

function getGitText(cwd, ...args) {
  return runOrThrow("git", args, cwd).stdout.trim();
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function ensureBaseWorktree(currentDir, baseDir, baseRef) {
  if (existsSync(join(baseDir, ".git"))) {
    return;
  }

  mkdirSync(dirname(baseDir), { recursive: true });
  runOrThrow(
    "git",
    ["worktree", "add", "--detach", baseDir, baseRef],
    currentDir,
  );
}

function ensureDependencies(cwd) {
  if (existsSync(join(cwd, "node_modules"))) {
    return null;
  }

  const frozenInstall = run("pnpm", ["install", "--frozen-lockfile"], cwd);
  if (frozenInstall.exitCode === 0) {
    return frozenInstall;
  }

  const relaxedInstall = run("pnpm", ["install", "--no-frozen-lockfile"], cwd);

  return {
    command: relaxedInstall.command,
    cwd,
    durationMs: Number(
      (frozenInstall.durationMs + relaxedInstall.durationMs).toFixed(2),
    ),
    exitCode: relaxedInstall.exitCode,
    stdout: [
      "Frozen install failed; retried without frozen lockfile.",
      `First attempt: ${frozenInstall.command}`,
      frozenInstall.stdout.trim(),
      `Retry: ${relaxedInstall.command}`,
      relaxedInstall.stdout.trim(),
    ]
      .filter(Boolean)
      .join("\n\n"),
    stderr: [frozenInstall.stderr.trim(), relaxedInstall.stderr.trim()]
      .filter(Boolean)
      .join("\n\n"),
    attempts: [frozenInstall, relaxedInstall],
  };
}

function makePRNG(seed) {
  let state = seed >>> 0;

  const nextUint32 = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return {
    nextUint32,
    nextInt(max) {
      return nextUint32() % max;
    },
  };
}

function makeDeterministicRandomBytes(seed) {
  const rng = makePRNG(seed);

  return (byteLength) => {
    const out = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
      out[index] = rng.nextInt(256);
    }
    return out;
  };
}

function insertSorted(values, value) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  values.splice(low, 0, value);
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction)),
  );
  return sorted[index];
}

function summarizeLengths(keys) {
  const lengths = keys.map((key) => key.length);
  const tokenCounts = keys.map((key) => key.split("!").length);

  return {
    count: keys.length,
    avgLength: Number(average(lengths).toFixed(2)),
    minLength: Math.min(...lengths),
    p50Length: percentile(lengths, 0.5),
    p95Length: percentile(lengths, 0.95),
    maxLength: Math.max(...lengths),
    avgTokens: Number(average(tokenCounts).toFixed(2)),
    maxTokens: Math.max(...tokenCounts),
  };
}

function benchmark(label, operationCount, fn, repeats = 5) {
  fn();

  const samples = [];
  let finalResult = null;

  for (let repeat = 0; repeat < repeats; repeat++) {
    const startedAt = performance.now();
    finalResult = fn();
    const finishedAt = performance.now();
    samples.push(finishedAt - startedAt);
  }

  const medianMs = median(samples);
  const finalOperationCount = finalResult.operationCount ?? operationCount;

  return {
    label,
    operationCount: finalOperationCount,
    requestedOperationCount: operationCount,
    repeats,
    medianMs: Number(medianMs.toFixed(3)),
    avgMs: Number(average(samples).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    opsPerSec: Number(((finalOperationCount / medianMs) * 1000).toFixed(2)),
    metrics: finalResult.metrics ?? null,
  };
}

function measure(label, fn) {
  const startedAt = performance.now();
  const result = fn();
  const finishedAt = performance.now();

  return {
    label,
    durationMs: Number((finishedAt - startedAt).toFixed(3)),
    metrics: result.metrics ?? null,
  };
}

function makeAdapter(lib) {
  const Fugue = lib.Fugue;
  const hasBurst = typeof Fugue.prototype.startBurst === "function";

  return {
    mode: hasBurst ? "burst" : "run",
    exports: Object.keys(lib).sort(),
    makeFugue(seed) {
      const options = { randomBytes: makeDeterministicRandomBytes(seed) };
      if (!hasBurst) {
        options.onWarning = () => {};
      }
      return new Fugue(options);
    },
    startSequence(fugue, left, right) {
      if (hasBurst) {
        const burst = fugue.startBurst(left, right);
        return {
          first() {
            return burst.next();
          },
          next() {
            return burst.next();
          },
        };
      }

      const runInstance = fugue.startRun(left, right);
      let firstTaken = false;

      return {
        first() {
          firstTaken = true;
          return runInstance.first;
        },
        next() {
          if (!firstTaken) {
            firstTaken = true;
            return runInstance.first;
          }

          return runInstance.append();
        },
      };
    },
    isPosition(value) {
      return lib.isFuguePosition(value);
    },
  };
}

function makeWorkloads(adapter) {
  const firstCount = 20_000;
  const edgeCount = 20_000;
  const middleCount = 8_000;
  const sequenceCount = 8_000;
  const concurrentClients = 4;
  const concurrentPerClient = 2_000;
  const sameGapDraws = 100_000;

  return {
    emptyDocumentInsert: benchmark("emptyDocumentInsert", firstCount, () => {
      const fugue = adapter.makeFugue(0x1001);
      const keys = [];

      for (let index = 0; index < firstCount; index++) {
        keys.push(fugue.first());
      }

      return { metrics: summarizeLengths(keys) };
    }),
    appendChain: benchmark("appendChain", edgeCount, () => {
      const fugue = adapter.makeFugue(0x2001);
      let position = fugue.first();
      const keys = [position];

      for (let index = 0; index < edgeCount; index++) {
        position = fugue.after(position);
        keys.push(position);
      }

      return { metrics: summarizeLengths(keys) };
    }),
    appendViaBetween: benchmark("appendViaBetween", edgeCount, () => {
      const fugue = adapter.makeFugue(0x2801);
      let position = fugue.first();
      const keys = [position];
      let generated = 0;
      let error = null;

      for (let index = 0; index < edgeCount; index++) {
        try {
          position = fugue.between(position, null);
          keys.push(position);
          generated++;
        } catch (caughtError) {
          error = {
            name: caughtError.name,
            message: caughtError.message,
          };
          break;
        }
      }

      return {
        operationCount: generated,
        metrics: {
          ...summarizeLengths(keys),
          exhausted: error !== null,
          error,
        },
      };
    }),
    prependChain: benchmark("prependChain", edgeCount, () => {
      const fugue = adapter.makeFugue(0x3001);
      let position = fugue.first();
      const keys = [position];

      for (let index = 0; index < edgeCount; index++) {
        position = fugue.before(position);
        keys.push(position);
      }

      return { metrics: summarizeLengths(keys) };
    }),
    prependViaBetween: benchmark("prependViaBetween", edgeCount, () => {
      const fugue = adapter.makeFugue(0x3801);
      let position = fugue.first();
      const keys = [position];
      let generated = 0;
      let error = null;

      for (let index = 0; index < edgeCount; index++) {
        try {
          position = fugue.between(null, position);
          keys.push(position);
          generated++;
        } catch (caughtError) {
          error = {
            name: caughtError.name,
            message: caughtError.message,
          };
          break;
        }
      }

      return {
        operationCount: generated,
        metrics: {
          ...summarizeLengths(keys),
          exhausted: error !== null,
          error,
        },
      };
    }),
    randomMiddleInsertions: benchmark(
      "randomMiddleInsertions",
      middleCount,
      () => {
        const rng = makePRNG(0x4001);
        const clients = [
          adapter.makeFugue(0x4002),
          adapter.makeFugue(0x4003),
          adapter.makeFugue(0x4004),
        ];
        const seed = clients[0];
        const first = seed.first();
        const second = seed.after(first);
        const positions = [first, second];

        for (let index = 0; index < middleCount; index++) {
          const client = clients[rng.nextInt(clients.length)];
          const gapIndex = rng.nextInt(positions.length - 1);
          const left = positions[gapIndex];
          const right = positions[gapIndex + 1];
          insertSorted(positions, client.between(left, right));
        }

        return { metrics: summarizeLengths(positions) };
      },
    ),
    explicitBurstOrRun: benchmark("explicitBurstOrRun", sequenceCount, () => {
      const fugue = adapter.makeFugue(0x5001);
      const left = fugue.first();
      const right = fugue.after(left);
      const sequence = adapter.startSequence(fugue, left, right);
      const keys = [sequence.first()];

      for (let index = 1; index < sequenceCount; index++) {
        keys.push(sequence.next());
      }

      return { metrics: summarizeLengths(keys) };
    }),
    concurrentSameGapSequences: benchmark(
      "concurrentSameGapSequences",
      concurrentClients * concurrentPerClient,
      () => {
        const base = adapter.makeFugue(0x6001);
        const left = base.first();
        const right = base.after(left);
        const sequences = Array.from(
          { length: concurrentClients },
          (_, index) => {
            return adapter.startSequence(
              adapter.makeFugue(0x6002 + index),
              left,
              right,
            );
          },
        );
        const keys = [];

        for (const sequence of sequences) {
          keys.push(sequence.first());
          for (let index = 1; index < concurrentPerClient; index++) {
            keys.push(sequence.next());
          }
        }

        return { metrics: summarizeLengths(keys) };
      },
    ),
    sameGapUniqueness: measure("sameGapUniqueness", () => {
      const base = adapter.makeFugue(0x7001);
      const left = base.first();
      const right = base.after(left);
      const fugue = adapter.makeFugue(0x7002);
      const seen = new Set();
      let collisions = 0;

      for (let index = 0; index < sameGapDraws; index++) {
        const key = fugue.between(left, right);
        if (seen.has(key)) {
          collisions++;
        } else {
          seen.add(key);
        }
      }

      return {
        metrics: {
          draws: sameGapDraws,
          unique: seen.size,
          collisions,
          collisionRate: Number((collisions / sameGapDraws).toFixed(6)),
        },
      };
    }),
    validationAndSort: (() => {
      const dataset = [];

      const listFugue = adapter.makeFugue(0x8001);
      let position = listFugue.first();
      dataset.push(position);
      for (let index = 0; index < 12_000; index++) {
        position = listFugue.after(position);
        dataset.push(position);
      }

      const middleFugue = adapter.makeFugue(0x8002);
      const first = middleFugue.first();
      const second = middleFugue.after(first);
      const middleKeys = [first, second];
      const rng = makePRNG(0x8003);
      for (let index = 0; index < 6_000; index++) {
        const gapIndex = rng.nextInt(middleKeys.length - 1);
        insertSorted(
          middleKeys,
          middleFugue.between(middleKeys[gapIndex], middleKeys[gapIndex + 1]),
        );
      }
      dataset.push(...middleKeys);

      const validation = benchmark("validation", dataset.length, () => {
        let valid = 0;
        for (const key of dataset) {
          if (adapter.isPosition(key)) {
            valid++;
          }
        }
        return {
          metrics: {
            datasetSize: dataset.length,
            valid,
            lengths: summarizeLengths(dataset),
          },
        };
      });

      const sorting = benchmark("sorting", dataset.length, () => {
        const sorted = [...dataset].sort();
        return {
          metrics: {
            datasetSize: dataset.length,
            first: sorted[0],
            last: sorted[sorted.length - 1],
            lengths: summarizeLengths(sorted),
          },
        };
      });

      return { validation, sorting };
    })(),
  };
}

async function loadBuiltLibrary(cwd) {
  const distPath = join(cwd, "dist", "index.js");
  const cacheBuster = `?t=${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return import(`${pathToFileURL(distPath).href}${cacheBuster}`);
}

function collectBranchMetrics(cwd, label) {
  const packageJson = JSON.parse(
    readFileSync(join(cwd, "package.json"), "utf8"),
  );

  const install = ensureDependencies(cwd);
  const test = run("pnpm", ["test"], cwd);
  const typecheck = run("pnpm", ["test:types"], cwd);
  const build = run("pnpm", ["build"], cwd);
  const size = run("pnpm", ["size"], cwd);

  return {
    label,
    cwd,
    branch: getGitText(cwd, "rev-parse", "--abbrev-ref", "HEAD"),
    commit: getGitText(cwd, "rev-parse", "HEAD"),
    packageDescription: packageJson.description,
    install,
    checks: {
      test,
      typecheck,
      build,
      size,
    },
  };
}

function summarizeCheckResult(result) {
  return {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function analyzeBranch(cwd, label) {
  const branchMetrics = collectBranchMetrics(cwd, label);
  const lib = await loadBuiltLibrary(cwd);
  const adapter = makeAdapter(lib);
  const workloads = makeWorkloads(adapter);
  const distStats = statSync(join(cwd, "dist", "index.js"));

  return {
    ...branchMetrics,
    runtime: {
      mode: adapter.mode,
      exportCount: adapter.exports.length,
      exports: adapter.exports,
      builtIndexBytes: distStats.size,
    },
    workloads,
  };
}

function exitCodeSummary(branchResult) {
  const checks = branchResult.checks;
  return {
    install: branchResult.install?.exitCode ?? 0,
    test: checks.test.exitCode,
    typecheck: checks.typecheck.exitCode,
    build: checks.build.exitCode,
    size: checks.size.exitCode,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentDir = resolve(args.currentDir ?? repoRoot);
  const baseRef = args.baseRef ?? DEFAULT_BASE_REF;
  const baseDir = resolve(args.baseDir ?? DEFAULT_BASE_DIR);
  const outputFile = resolve(args.output ?? DEFAULT_OUTPUT);

  ensureBaseWorktree(currentDir, baseDir, baseRef);

  const result = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      pnpm: runOrThrow("pnpm", ["--version"], currentDir).stdout.trim(),
    },
    refs: {
      baseRef,
      baseDir,
      currentDir,
      currentBranch: getGitText(
        currentDir,
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ),
      mergeBase: getGitText(currentDir, "merge-base", baseRef, "HEAD"),
    },
    base: await analyzeBranch(baseDir, baseRef),
    current: await analyzeBranch(currentDir, "current"),
  };

  result.base.checkSummary = {
    install: result.base.install
      ? summarizeCheckResult(result.base.install)
      : null,
    test: summarizeCheckResult(result.base.checks.test),
    typecheck: summarizeCheckResult(result.base.checks.typecheck),
    build: summarizeCheckResult(result.base.checks.build),
    size: summarizeCheckResult(result.base.checks.size),
  };
  result.current.checkSummary = {
    install: result.current.install
      ? summarizeCheckResult(result.current.install)
      : null,
    test: summarizeCheckResult(result.current.checks.test),
    typecheck: summarizeCheckResult(result.current.checks.typecheck),
    build: summarizeCheckResult(result.current.checks.build),
    size: summarizeCheckResult(result.current.checks.size),
  };

  result.exitCodes = {
    base: exitCodeSummary(result.base),
    current: exitCodeSummary(result.current),
  };

  ensureParentDir(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);

  process.stdout.write(`Wrote comparison data to ${outputFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
