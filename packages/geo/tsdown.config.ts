import { defineConfig } from "tsdown";

// The build for npm: two ES module entries (the root and /projection) and their declarations in dist. The dependencies stay external.
export default defineConfig({
  entry: { index: "src/index.ts", projection: "src/projection.ts" },
  format: "esm",
  platform: "neutral",
  dts: true,
  outDir: "dist",
  clean: true,
});
