import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Each property test has one fixed seed. Thus two runs of one tree give the same coverage.
    setupFiles: ["./fast-check.config.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      // The floors are under the measure of 0.1.0 (99 % of the lines). The seed of the property tests is fixed, thus the coverage of a tree does not change.
      thresholds: { statements: 97, branches: 95, functions: 100, lines: 98 },
    },
  },
});
