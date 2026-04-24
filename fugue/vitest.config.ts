import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    testTimeout: 60_000,
    include: ["tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      tsconfig: "tsconfig.json",
      include: ["tests/**/*.test.ts"],
    },
    benchmark: {
      include: ["tests/**/*.bench.ts"],
    },
    coverage: {
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
  plugins: [tsconfigPaths()],
});
