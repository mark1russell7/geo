import { defineConfig } from "tsdown";

// The build for npm: three ES module entries (the root, /projection and /shapefile) and their declarations in dist. The dependencies stay external.
export default defineConfig({
  entry: { index: "src/index.ts", projection: "src/projection.ts", shapefile: "src/shapefile.ts" },
  format: "esm",
  platform: "neutral",
  dts: true,
  outDir: "dist",
  clean: true,
});
