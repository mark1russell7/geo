import { type Polygon, type Position, simplifyRegions } from "@mark1russell7/geo";
import { classifySegments } from "@mark1russell7/predicates";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { simplifyRegions as simplifyBase } from "geo-base";
import { describe, expect, it } from "vitest";
import { caseOf, type HashLine, LOCATE, mapOf, markdown, type Pairs, positionCount, report, SIMPLIFY, speedFaults, suiteOf, TOLERANCE_KM } from "./index.ts";

const key = (position: Position): string => `${position[0]},${position[1]}`;

/** The edges of all rings, each as its two ends. */
function edgesOf(regions: readonly Polygon[]): [Position, Position][] {
  return regions.flatMap((region) =>
    region.coordinates.flatMap((ring) => ring.slice(1).map((position, index): [Position, Position] => [ring[index] as Position, position])),
  );
}

/** The twice signed area of a ring in the plane of the longitudes. It is more than 0 for a counterclockwise ring. */
function signedArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const a = ring[index] as Position;
    const b = ring[index + 1] as Position;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

describe("the maps of the cases", () => {
  it("are the same for the same case", () => {
    expect(canonicalHash(mapOf(caseOf("grid-30-1e3")))).toBe(canonicalHash(mapOf(caseOf("grid-30-1e3"))));
  });

  it("refuses a case that does not exist", () => {
    expect(() => caseOf("no-case")).toThrow(RangeError);
  });

  it.each(["grid-30-1e3", "grid-100-1e4", "grid-552-1e5"])("%s has one region for each cell and the target count of positions within 2 %%", (id) => {
    const spec = caseOf(id);
    const regions = mapOf(spec);
    expect(regions).toHaveLength(spec.columns * spec.rows);
    expect(Math.abs(positionCount(regions) - spec.positions) / spec.positions).toBeLessThan(0.02);
  });

  it("closes each ring counterclockwise, with values of 6 decimals", () => {
    for (const region of mapOf(caseOf("grid-100-1e4"))) {
      const ring = region.coordinates[0] as readonly Position[];
      expect(key(ring[0] as Position)).toBe(key(ring[ring.length - 1] as Position));
      expect(signedArea(ring)).toBeGreaterThan(0);
      for (const [x, y] of ring) {
        expect(Math.round(x * 1e6) / 1e6).toBe(x);
        expect(Math.round(y * 1e6) / 1e6).toBe(y);
      }
    }
  });

  it("shares each inner border: each edge comes one time in each direction at most, and an inner edge comes in both", () => {
    const counts = new Map<string, number>();
    for (const [a, b] of edgesOf(mapOf(caseOf("grid-100-1e4")))) {
      const directed = `${key(a)} ${key(b)}`;
      counts.set(directed, (counts.get(directed) ?? 0) + 1);
    }
    let both = 0;
    for (const [directed, count] of counts) {
      expect(count).toBe(1);
      const [a, b] = directed.split(" ");
      if (counts.has(`${b} ${a}`)) both += 1;
    }
    // About 2 of each 3 positions are on inner borders, so most edges come in both directions.
    expect(both / counts.size).toBeGreaterThan(0.5);
  });

  it("has no two edges that meet at a point other than a shared end", () => {
    const unique = new Map<string, [Position, Position]>();
    for (const [a, b] of edgesOf(mapOf(caseOf("grid-100-1e4")))) {
      const [low, high] = key(a) < key(b) ? [a, b] : [b, a];
      unique.set(`${key(low)} ${key(high)}`, [low, high]);
    }
    const edges = [...unique.values()].sort((p, q) => Math.min(p[0][0], p[1][0]) - Math.min(q[0][0], q[1][0]));
    let pairs = 0;
    let bad = 0;
    for (let s = 0; s < edges.length; s += 1) {
      const [a, b] = edges[s] as [Position, Position];
      const right = Math.max(a[0], b[0]);
      for (let t = s + 1; t < edges.length; t += 1) {
        const [c, d] = edges[t] as [Position, Position];
        if (Math.min(c[0], d[0]) > right) break;
        if (Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
        pairs += 1;
        const { relation } = classifySegments(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
        const shared = key(a) === key(c) || key(a) === key(d) || key(b) === key(c) || key(b) === key(d);
        if (relation !== "disjoint" && !(relation === "touch" && shared)) bad += 1;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });

  it("gives the same result with geo 0.3.1 and with the head of geo on the small case", () => {
    const regions = mapOf(caseOf("grid-30-1e3"));
    const head = simplifyRegions(regions, TOLERANCE_KM);
    expect(canonicalHash(head)).toBe(canonicalHash(simplifyBase(regions, TOLERANCE_KM)));
    // The simplification removes positions, so the bench measures real work.
    expect(positionCount(head as Polygon[])).toBeLessThan(positionCount(regions));
  });
});

/** The records of a fake run: `rounds` rounds of each case, with the time `ms(case, round)` for each arm. */
function fakePairs(cases: readonly string[], rounds: number, ms: (arm: string, id: string, round: number) => number): Pairs {
  const pair = (b: string) =>
    cases.flatMap((id) =>
      Array.from({ length: rounds }, (_, round) => ({ case: id, round, first: round % 2 === 0 ? ("a" as const) : ("b" as const), a: ms("base", id, round), b: ms(b, id, round) })),
    );
  return { head: pair("head"), "head-copy": pair("head-copy"), "base~aa": pair("base") };
}

describe("the report", () => {
  const sizes: Record<string, number> = { "grid-30-1e3": 1, "grid-100-1e4": 10, "grid-552-1e5": 100, "tx-552-325k": 325, "grid-552-1e6": 1000 };
  const all = Object.keys(sizes);
  const hashes: HashLine[] = all.flatMap((id) => [
    { arm: "base", case: id, hash: "h" },
    { arm: "head", case: id, hash: id === "grid-30-1e3" ? "other" : "h" },
  ]);

  it("reads a head 10 times faster than the base, within the budget, with a linear growth", () => {
    const noise = (round: number): number => 1 + ((round * 7) % 5) / 1000;
    const pairs = fakePairs(all, 7, (arm, id, round) => (sizes[id] as number) * noise(round) * (arm === "base" ? 20 : 1));
    const result = report(pairs, hashes, SIMPLIFY);
    expect(result.cases).toHaveLength(5);
    expect(result.cases.find((row) => row.case === "tx-552-325k")?.ratio).toBeCloseTo(0.05, 2);
    expect(result.time.outcome).toBe("faster");
    expect(result.budget.outcome).toBe("within");
    expect(result.growth.outcome).toBe("within");
    expect(result.growth.steps.map((step) => step.exponent)).toEqual(result.growth.steps.map(() => expect.closeTo(1, 1)));
    expect(result.cases.find((row) => row.case === "grid-30-1e3")?.sameResult).toBe(false);
    expect(result.cases.find((row) => row.case === SIMPLIFY.budget?.case)?.sameResult).toBe(true);
    expect(markdown(result, SIMPLIFY)).toContain("| tx-552-325k | 7 |");
  });

  it("reads the base over the budget", () => {
    const pairs = fakePairs(all, 7, (_, id, round) => (sizes[id] as number) * 25 * (1 + (round % 3) / 1000));
    expect(report(pairs, hashes, SIMPLIFY).budget.outcome).toBe("beyond");
  });

  it("passes the speed gate only when the budget and the growth are within", () => {
    const fast = report(fakePairs(all, 7, (_, id, round) => (sizes[id] as number) * (1 + (round % 3) / 1000)), hashes, SIMPLIFY);
    expect(speedFaults(fast, all, SIMPLIFY)).toEqual([]);
    const slow = report(fakePairs(all, 7, (_, id, round) => (sizes[id] as number) * 25 * (1 + (round % 3) / 1000)), hashes, SIMPLIFY);
    expect(speedFaults(slow, all, SIMPLIFY)).toEqual([expect.stringContaining('The budget of tx-552-325k is "beyond".')]);
    const noisy = { budget: { outcome: "cannot decide" as const, reason: "", cases: [] }, growth: { outcome: "cannot decide" as const, reason: "", steps: [] } };
    expect(speedFaults(noisy, all, SIMPLIFY)).toHaveLength(2);
    expect(speedFaults(noisy, ["grid-30-1e3"], SIMPLIFY)).toEqual([]);
  });

  it("gives no read for a run with too few cases", () => {
    const result = report(fakePairs(["grid-30-1e3"], 7, () => 5), [], SIMPLIFY);
    expect(result.time.outcome).toBe("no read");
    expect(result.budget.outcome).toBe("no read");
    expect(result.growth.outcome).toBe("no read");
    expect(result.cases[0]?.sameResult).toBeUndefined();
  });
});

describe("the suites", () => {
  it("gives each suite by its id, and refuses an id that does not exist", () => {
    expect(suiteOf("simplify")).toBe(SIMPLIFY);
    expect(suiteOf("locate")).toBe(LOCATE);
    expect(() => suiteOf("no-suite")).toThrow(RangeError);
  });

  it("keeps the limits of the gate of R14", () => {
    expect(SIMPLIFY.enforced).toBe(true);
    expect(SIMPLIFY.budget).toEqual({ case: "tx-552-325k", limitMs: 360, maxDifferenceMs: 12 });
    expect(SIMPLIFY.growth.maxGrowth).toBe(12);
    expect(SIMPLIFY.cases.filter((id) => SIMPLIFY.growth.sizeOf(id) !== undefined)).toEqual(["grid-552-1e5", "tx-552-325k", "grid-552-1e6"]);
  });

  it("reads the locate suite with a temporary budget, and the growth of the coasts with 10,000 places", () => {
    expect(LOCATE.enforced).toBe(false);
    expect(LOCATE.budget).toEqual({ case: "coast-1e5-1e4", limitMs: 10_000, maxDifferenceMs: 1_000 });
    expect(LOCATE.cases.map((id) => LOCATE.growth.sizeOf(id))).toEqual([1_000, 10_000, 100_000, undefined, undefined, undefined]);
    const sizes: Record<string, number> = { "coast-1e3-1e4": 1, "coast-1e4-1e4": 10, "coast-1e5-1e4": 100, "coast-1e6-1e2": 10, "star-1e5-1e3": 10, "parts-552-1e5-1e3": 10 };
    const pairs = fakePairs(LOCATE.cases, 7, (_, id, round) => (sizes[id] as number) * (1 + ((round * 7) % 5) / 1000));
    const hashes: HashLine[] = LOCATE.cases.flatMap((id) => [
      { arm: "base", case: id, hash: "h" },
      { arm: "head", case: id, hash: "h" },
    ]);
    const result = report(pairs, hashes, LOCATE);
    expect(result.suite).toBe("locate");
    expect(result.budget.outcome).toBe("within");
    expect(result.growth.outcome).toBe("within");
    expect(result.growth.steps).toHaveLength(2);
    expect(speedFaults(result, LOCATE.cases, LOCATE)).toEqual([]);
    const text = markdown(result, LOCATE);
    expect(text).toContain("## The bench of pointLocator (R10)");
    expect(text).toContain("The report only reads the speed claims.");
    expect(text).toContain("- Budget: **within**.");
  });

  it("gives a fault of the growth of a quadratic locate, for the read of the report", () => {
    const sizes: Record<string, number> = { "coast-1e3-1e4": 1, "coast-1e4-1e4": 100, "coast-1e5-1e4": 10_000 };
    const ids = Object.keys(sizes);
    const result = report(fakePairs(ids, 7, (_, id, round) => (sizes[id] as number) * (1 + (round % 3) / 1000)), [], LOCATE);
    expect(result.growth.outcome).toBe("beyond");
    expect(speedFaults(result, ids, LOCATE)).toEqual([expect.stringContaining('The growth is "beyond".')]);
  });
});
