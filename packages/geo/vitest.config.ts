import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      // The floors are under the measure of 0.1.0 (99 % of the lines). The property tests take a new seed in each run, so the floors keep a margin.
      thresholds: { statements: 97, branches: 95, functions: 100, lines: 98 },
    },
  },
});
