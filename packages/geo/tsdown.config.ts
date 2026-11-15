import { defineConfig } from "tsdown";

// The build for npm: one ES module entry and its declarations in dist. The dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  dts: true,
  outDir: "dist",
  clean: true,
});
