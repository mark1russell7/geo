import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("the home page", () => {
  it("names the package and gives the install command", () => {
    expect(page).toContain("<title>geo</title>");
    expect(page).toContain("pnpm add @mark1russell7/geo");
  });

  it("links to the pages of site-pages and to the repository", () => {
    expect(page).toContain('href="./releases/"');
    expect(page).toContain('href="./status/"');
    expect(page).toContain('href="https://github.com/mark1russell7/geo"');
  });

  it("has the live demo: the map, the areas, the views and the readout", () => {
    expect(page).toContain('<svg id="map"');
    for (const id of ["antimeridian", "long-way", "pole"]) expect(page).toContain(`data-preset="${id}"`);
    expect(page).toContain('data-projection="globe"');
    expect(page).toContain('data-projection="flat"');
    for (const id of ["sentence", "code", "lat", "lon", "buffer", "precision", "draw", "zoom-in", "zoom-out"]) expect(page).toContain(`id="${id}"`);
  });

  it("does not say that the package has no release", () => {
    expect(page).not.toContain("no release on npm yet");
  });
});
