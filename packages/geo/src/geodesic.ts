/*
 * ste-disable
 *
 * This file is a port of a part of GeographicLib 2.2.0 (geographiclib-geodesic, the files Geodesic.js,
 * GeodesicLine.js and Math.js) to TypeScript: the inverse and the direct geodesic problems.
 * https://geographiclib.sourceforge.io/
 *
 * The MIT License (MIT).
 *
 * Copyright (c) 2011-2022, Charles Karney
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 * ste-enable
 */

/**
 * Geodesics on an ellipsoid of revolution, as WGS84, with the method of Karney (2013). A geodesic is the shortest path
 * between two points on the ellipsoid.
 *
 * - `geodesicInverse` gives the length of the geodesic between two points and its bearings at the two ends.
 * - `geodesicDirect` gives the end point and the final bearing from a start point, a bearing and a distance.
 * - The code is a port of the inverse and the direct problems of GeographicLib 2.2.0 (MIT). It keeps the series of
 *   order 6 and the order of each operation.
 * - For an absolute flattening of 1/50 or less, the results are accurate to the rounding of double numbers. On WGS84,
 *   the error of a distance is less than 15 nanometres.
 *
 * The method: C. F. F. Karney, "Algorithms for geodesics", J. Geodesy 87, 43-55 (2013),
 * https://doi.org/10.1007/s00190-012-0578-z.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkPoint, latLon, type LatLon } from "./point.ts";

/** An ellipsoid of revolution, as a model of the Earth. Its polar radius is `a * (1 - f)`. */
export interface Ellipsoid {
  /** The equatorial radius `a` in metres. It is a finite number more than 0. */
  readonly equatorialRadiusMeters: number;
  /**
   * The flattening `f`, equal to `(a - b) / a` for the polar radius `b`. It is a finite number less than 1. A negative
   * flattening gives a prolate ellipsoid. The results are accurate for an absolute flattening of 1/50 or less.
   */
  readonly flattening: number;
}

/** The ellipsoid of WGS84: the equatorial radius 6378137 m and the flattening 1/298.257223563. */
export const WGS84: Ellipsoid = Object.freeze({ equatorialRadiusMeters: 6_378_137, flattening: 1 / 298.257223563 });

/** The result of `geodesicInverse`. */
export interface GeodesicInverse {
  /** The length of the geodesic in metres. */
  readonly meters: number;
  /** The bearing of the geodesic at the first point, in degrees clockwise from north, from 0 to less than 360. */
  readonly initialBearing: number;
  /** The bearing of the geodesic at the second point, away from the first point, from 0 to less than 360. */
  readonly finalBearing: number;
}

/** The result of `geodesicDirect`. */
export interface GeodesicDirect {
  /** The end point. Its longitude is normalized. */
  readonly point: LatLon;
  /** The bearing of the geodesic at the end point, in degrees clockwise from north, from 0 to less than 360. */
  readonly finalBearing: number;
}

const DEGREE = Math.PI / 180;
const TINY = Math.sqrt(Number.MIN_VALUE / Number.EPSILON);
const TOL0 = Number.EPSILON;
const TOL1 = 200 * TOL0;
const TOL2 = Math.sqrt(TOL0);
const TOLB = TOL0;
const XTHRESH = 1000 * TOL2;
const MAXIT1 = 20;
// The maximum count of the steps of the Newton iteration and of the bisection: 20 + 53 bits + 10.
const MAXIT2 = MAXIT1 + 53 + 10;

/** The values of one ellipsoid that the series use. */
interface Shape {
  readonly a: number;
  readonly f: number;
  readonly f1: number;
  readonly ep2: number;
  readonly n: number;
  readonly b: number;
  readonly etol2: number;
  /** The coefficients of `A3` as a polynomial in `eps`, from the power 5 to the power 0. */
  readonly A3x: Float64Array;
  /** The coefficients of `C3[1]` to `C3[5]` as polynomials in `eps`. */
  readonly C3x: Float64Array;
}

/** The sine and the cosine of an angle. */
interface SinCos {
  readonly s: number;
  readonly c: number;
}

/** A sum and its rounding error. */
interface ExactSum {
  readonly s: number;
  readonly t: number;
}

const sq = (x: number): number => x * x;

// GeographicLib does not use Math.hypot: its results are different by one bit in some cases (GeodSolve92).
const hypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);

const copysign = (x: number, y: number): number => Math.abs(x) * (y < 0 || (y === 0 && 1 / y < 0) ? -1 : 1);

/** This function gives the sum of two numbers and its rounding error, with no error. */
function sum(u: number, v: number): ExactSum {
  const s = u + v;
  let up = s - v;
  let vpp = s - up;
  up -= u;
  vpp -= v;
  // A sum of 0 has an error of 0 with the sign of the sum.
  const t = s ? 0 - (up + vpp) : s;
  return { s, t };
}

/** This function gives the value of the polynomial of the order `order` with the coefficients from `p[start]`. */
function polyval(order: number, p: ArrayLike<number>, start: number, x: number): number {
  let y = p[start] as number;
  for (let i = 1; i <= order; i += 1) y = y * x + (p[start + i] as number);
  return y;
}

/** This function moves an angle that is near 0 to a coarse grid, so that a very small angle becomes 0. */
function angRound(x: number): number {
  const z = 1 / 16;
  let y = Math.abs(x);
  // The order of the operations is important: `z - (z - y)` is not `y`.
  y = y < z ? z - (z - y) : y;
  return copysign(y, x);
}

/** This function gives the remainder of `x` divided by `y`, from `-y / 2` to `y / 2`. */
function remainder(x: number, y: number): number {
  const r = x % y;
  return r < -y / 2 ? r + y : r < y / 2 ? r : r - y;
}

/** This function gives the angle from -180 to 180. A result of -180 or 180 has the sign of `x`. */
function angNormalize(x: number): number {
  const y = remainder(x, 360);
  return Math.abs(y) === 180 ? copysign(180, x) : y;
}

/** This function gives the difference `y - x` of two angles from -180 to 180, as a sum `d + e` with no error. */
function angDiff(x: number, y: number): { readonly d: number; readonly e: number } {
  let r = sum(remainder(-x, 360), remainder(y, 360));
  r = sum(remainder(r.s, 360), r.t);
  let d = r.s;
  const e = r.t;
  if (d === 0 || Math.abs(d) === 180) d = copysign(d, e === 0 ? y - x : -e);
  return { d, e };
}

/** This function gives the sine and the cosine of `d + 90 q` for an angle `d` from -45 to 45. */
function sinCosQuadrant(d: number, q: number, signOf: number): SinCos {
  const r = d * DEGREE;
  let s = Math.sin(r);
  let c = Math.cos(r);
  if (Math.abs(d) === 45) {
    c = Math.sqrt(0.5);
    s = copysign(c, r);
  } else if (Math.abs(d) === 30) {
    c = Math.sqrt(0.75);
    s = copysign(0.5, r);
  }
  let sinx: number;
  let cosx: number;
  switch (q & 3) {
    case 0:
      sinx = s;
      cosx = c;
      break;
    case 1:
      sinx = c;
      cosx = -s;
      break;
    case 2:
      sinx = -s;
      cosx = -c;
      break;
    default:
      sinx = -c;
      cosx = s;
      break;
  }
  cosx += 0;
  if (sinx === 0) sinx = copysign(sinx, signOf);
  return { s: sinx, c: cosx };
}

/** This function gives the sine and the cosine of an angle in degrees, with an exact reduction to -45 to 45. */
function sincosd(x: number): SinCos {
  const d = x % 360;
  const q = Math.round(d / 90);
  return sinCosQuadrant(d - 90 * q, q, x);
}

/** This function gives the sine and the cosine of the angle `x + t` in degrees, for a small correction `t`. */
function sincosde(x: number, t: number): SinCos {
  const d = x % 360;
  const q = Math.round(d / 90);
  return sinCosQuadrant(angRound(d - 90 * q + t), q, x + t);
}

/** This function gives `atan2(y, x)` in degrees, from -180 to 180, with an exact reduction to -45 to 45. */
function atan2d(yIn: number, xIn: number): number {
  let y = yIn;
  let x = xIn;
  let q = 0;
  if (Math.abs(y) > Math.abs(x)) {
    [y, x] = [x, y];
    q = 2;
  }
  if (copysign(1, x) < 0) {
    x = -x;
    q += 1;
  }
  const ang = Math.atan2(y, x) / DEGREE;
  switch (q) {
    case 1:
      return copysign(180, y) - ang;
    case 2:
      return 90 - ang;
    case 3:
      return -90 + ang;
    default:
      return ang;
  }
}

/** This function gives a bearing from 0 to less than 360 for an angle from -180 to 180. The bearing of -0 is 0. */
const bearing = (degrees: number): number => (degrees >= 0 ? degrees + 0 : (degrees + 360) % 360);

const A1M1F_COEFF: readonly number[] = [1, 4, 64, 0, 256];

/** This function gives `A1 - 1`, the mean value of the derivative of `I1`, less 1. */
function a1m1f(eps: number): number {
  const t = polyval(3, A1M1F_COEFF, 0, sq(eps)) / (A1M1F_COEFF[4] as number);
  return (t + eps) / (1 - eps);
}

const C1F_COEFF: readonly number[] = [-1, 6, -16, 32, -9, 64, -128, 2048, 9, -16, 768, 3, -5, 512, -7, 1280, -7, 2048];

const C1PF_COEFF: readonly number[] = [
  205, -432, 768, 1536, 4005, -4736, 3840, 12288, -225, 116, 384, -7173, 2695, 7680, 3467, 7680, 38081, 61440,
];

const A2M1F_COEFF: readonly number[] = [-11, -28, -192, 0, 256];

/** This function gives `A2 - 1`, the mean value of the derivative of `I2`, less 1. */
function a2m1f(eps: number): number {
  const t = polyval(3, A2M1F_COEFF, 0, sq(eps)) / (A2M1F_COEFF[4] as number);
  return (t - eps) / (1 + eps);
}

const C2F_COEFF: readonly number[] = [1, 2, 16, 32, 35, 64, 384, 2048, 15, 80, 768, 7, 35, 512, 63, 1280, 77, 2048];

/** This function puts the coefficients 1 to 6 of a Fourier series of order 6 in `c`. The table is `C1`, `C1p` or `C2`. */
function fourierCoefficients(table: readonly number[], eps: number, c: Float64Array): void {
  const eps2 = sq(eps);
  let d = eps;
  let o = 0;
  for (let l = 1; l <= 6; l += 1) {
    const p = Math.floor((6 - l) / 2);
    c[l] = (d * polyval(p, table, o, eps2)) / (table[o + p + 1] as number);
    o += p + 2;
    d *= eps;
  }
}

const A3_COEFF: readonly number[] = [-3, 128, -2, -3, 64, -1, -3, -1, 16, 3, -1, -2, 8, 1, -1, 2, 1, 1];

const C3_COEFF: readonly number[] = [
  3, 128, 2, 5, 128, -1, 3, 3, 64, -1, 0, 1, 8, -1, 1, 4, 5, 256, 1, 3, 128, -3, -2, 3, 64, 1, -3, 2, 32, 7, 512, -10, 9,
  384, 5, -9, 5, 192, 7, 512, -14, 7, 512, 21, 2560,
];

/** This function gives `A3`, the mean value of the derivative of `I3`. */
const a3f = (shape: Shape, eps: number): number => polyval(5, shape.A3x, 0, eps);

/** This function puts the coefficients `C3[1]` to `C3[5]` in `c`. */
function c3f(shape: Shape, eps: number, c: Float64Array): void {
  let mult = 1;
  let o = 0;
  for (let l = 1; l < 6; l += 1) {
    const p = 6 - l - 1;
    mult *= eps;
    c[l] = mult * polyval(p, shape.C3x, o, eps);
    o += p + 1;
  }
}

/**
 * This function gives the sum of `c[i] * sin(2 i x)` for `i` from 1 to `c.length - 1`, with the Clenshaw summation.
 * The entry `c[0]` is not used.
 */
function sinSeries(sinx: number, cosx: number, c: Float64Array): number {
  let k = c.length;
  let n = k - 1;
  const ar = 2 * (cosx - sinx) * (cosx + sinx);
  let y0 = n & 1 ? (c[--k] as number) : 0;
  let y1 = 0;
  n = Math.floor(n / 2);
  while (n--) {
    y1 = ar * y0 - y1 + (c[--k] as number);
    y0 = ar * y1 - y0 + (c[--k] as number);
  }
  return 2 * sinx * cosx * y0;
}

/** This function examines an ellipsoid, and gives its values and the coefficients of its series. */
function makeShape(a: number, f: number): Shape {
  if (!Number.isFinite(a)) throw new GeoError("not-finite", `The equatorial radius ${a} is not a finite number`);
  if (!Number.isFinite(f)) throw new GeoError("not-finite", `The flattening ${f} is not a finite number`);
  if (!(a > 0)) throw new GeoError("radius", `The equatorial radius ${a} must be more than 0`);
  if (f >= 1) throw new GeoError("radius", `The flattening ${f} must be less than 1, so that the polar radius is more than 0`);
  const f1 = 1 - f;
  const b = a * f1;
  if (!(b > 0 && Number.isFinite(b))) throw new GeoError("radius", `The polar radius ${b} must be a finite number more than 0`);
  const e2 = f * (2 - f);
  const n = f / (2 - f);
  const A3x = new Float64Array(6);
  let o = 0;
  let k = 0;
  for (let j = 5; j >= 0; j -= 1) {
    const p = Math.min(6 - j - 1, j);
    A3x[k++] = polyval(p, A3_COEFF, o, n) / (A3_COEFF[o + p + 1] as number);
    o += p + 2;
  }
  const C3x = new Float64Array(15);
  o = 0;
  k = 0;
  for (let l = 1; l < 6; l += 1) {
    for (let j = 5; j >= l; j -= 1) {
      const p = Math.min(6 - j - 1, j);
      C3x[k++] = polyval(p, C3_COEFF, o, n) / (C3_COEFF[o + p + 1] as number);
      o += p + 2;
    }
  }
  // The limit of `sig12` for a very short line. The factor 0.1 is a margin, and the limit 0.001 keeps it small near a sphere.
  const etol2 = (0.1 * TOL2) / Math.sqrt((Math.max(0.001, Math.abs(f)) * Math.min(1, 1 - f / 2)) / 2);
  return { a, f, f1, ep2: e2 / sq(f1), n, b, etol2, A3x, C3x };
}

const shapes = new WeakMap<Ellipsoid, Shape>();
shapes.set(WGS84, makeShape(WGS84.equatorialRadiusMeters, WGS84.flattening));

/** This function gives the values of an ellipsoid. It keeps them for each ellipsoid, and it sees a change of an ellipsoid. */
function shapeOf(ellipsoid: Ellipsoid): Shape {
  const a = ellipsoid.equatorialRadiusMeters;
  const f = ellipsoid.flattening;
  const known = shapes.get(ellipsoid);
  if (known !== undefined && known.a === a && known.f === f) return known;
  const shape = makeShape(a, f);
  shapes.set(ellipsoid, shape);
  return shape;
}

/** The distance and the reduced length of a geodesic, divided by `b`, and the coefficient of the linear term of the reduced length. */
interface Lengths {
  readonly s12b: number;
  readonly m12b: number;
  readonly m0: number;
}

/** This function gives the lengths of a geodesic: the distance, the reduced length, or the two. */
function lengths(
  eps: number,
  sig12: number,
  ssig1: number,
  csig1: number,
  dn1: number,
  ssig2: number,
  csig2: number,
  dn2: number,
  mode: "distance" | "reduced" | "both",
  C1a: Float64Array,
  C2a: Float64Array,
): Lengths {
  const A1m1 = a1m1f(eps);
  fourierCoefficients(C1F_COEFF, eps, C1a);
  let m0x = 0;
  let A2 = 0;
  if (mode !== "distance") {
    const A2m1 = a2m1f(eps);
    fourierCoefficients(C2F_COEFF, eps, C2a);
    m0x = A1m1 - A2m1;
    A2 = 1 + A2m1;
  }
  const A1 = 1 + A1m1;
  let s12b = Number.NaN;
  let J12 = 0;
  if (mode !== "reduced") {
    const B1 = sinSeries(ssig2, csig2, C1a) - sinSeries(ssig1, csig1, C1a);
    s12b = A1 * (sig12 + B1);
    if (mode === "both") {
      const B2 = sinSeries(ssig2, csig2, C2a) - sinSeries(ssig1, csig1, C2a);
      J12 = m0x * sig12 + (A1 * B1 - A2 * B2);
    }
  } else {
    for (let l = 1; l <= 6; l += 1) C2a[l] = A1 * (C1a[l] as number) - A2 * (C2a[l] as number);
    J12 = m0x * sig12 + (sinSeries(ssig2, csig2, C2a) - sinSeries(ssig1, csig1, C2a));
  }
  // The parentheses keep the cancellation exact for two equal points.
  const m12b = mode === "distance" ? Number.NaN : dn2 * (csig1 * ssig2) - dn1 * (ssig1 * csig2) - csig1 * csig2 * J12;
  return { s12b, m12b, m0: m0x };
}

/** This function gives the positive root `k` of `k^4 + 2 k^3 - (x^2 + y^2 - 1) k^2 - 2 y^2 k - y^2 = 0`. */
function astroid(x: number, y: number): number {
  const p = sq(x);
  const q = sq(y);
  const r = (p + q - 1) / 6;
  if (q === 0 && r <= 0) return 0;
  const S = (p * q) / 4;
  const r2 = sq(r);
  const r3 = r * r2;
  const disc = S * (S + 2 * r3);
  let u = r;
  if (disc >= 0) {
    let T3 = S + r3;
    T3 += T3 < 0 ? -Math.sqrt(disc) : Math.sqrt(disc);
    const T = Math.cbrt(T3);
    u += T + (T !== 0 ? r2 / T : 0);
  } else {
    const ang = Math.atan2(Math.sqrt(-disc), -(S + r3));
    u += 2 * r * Math.cos(ang / 3);
  }
  const v = Math.sqrt(sq(u) + q);
  const uv = u < 0 ? q / (v - u) : u + v;
  const w = (uv - q) / (2 * v);
  return uv / (Math.sqrt(uv + sq(w)) + w);
}

/** The start of the Newton iteration. A `sig12` of 0 or more is the result of a very short line, with its `salp2` and `calp2`. */
interface Start {
  readonly sig12: number;
  readonly salp1: number;
  readonly calp1: number;
  readonly salp2: number;
  readonly calp2: number;
  readonly dnm: number;
}

/** This function gives the start of the Newton iteration, or the result for a very short line. */
function inverseStart(
  shape: Shape,
  sbet1: number,
  cbet1: number,
  dn1: number,
  sbet2: number,
  cbet2: number,
  dn2: number,
  lam12: number,
  slam12: number,
  clam12: number,
  C1a: Float64Array,
  C2a: Float64Array,
): Start {
  const sbet12 = sbet2 * cbet1 - cbet2 * sbet1;
  const cbet12 = cbet2 * cbet1 + sbet2 * sbet1;
  let sbet12a = sbet2 * cbet1;
  sbet12a += cbet2 * sbet1;
  let sig12 = -1;
  let salp2 = Number.NaN;
  let calp2 = Number.NaN;
  let dnm = Number.NaN;
  const shortline = cbet12 >= 0 && sbet12 < 0.5 && cbet2 * lam12 < 0.5;
  let somg12: number;
  let comg12: number;
  if (shortline) {
    let sbetm2 = sq(sbet1 + sbet2);
    sbetm2 /= sbetm2 + sq(cbet1 + cbet2);
    dnm = Math.sqrt(1 + shape.ep2 * sbetm2);
    const omg12 = lam12 / (shape.f1 * dnm);
    somg12 = Math.sin(omg12);
    comg12 = Math.cos(omg12);
  } else {
    somg12 = slam12;
    comg12 = clam12;
  }
  let salp1 = cbet2 * somg12;
  let calp1 =
    comg12 >= 0 ? sbet12 + (cbet2 * sbet1 * sq(somg12)) / (1 + comg12) : sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);
  const ssig12 = hypot(salp1, calp1);
  const csig12 = sbet1 * sbet2 + cbet1 * cbet2 * comg12;
  if (shortline && ssig12 < shape.etol2) {
    salp2 = cbet1 * somg12;
    calp2 = sbet12 - cbet1 * sbet2 * (comg12 >= 0 ? sq(somg12) / (1 + comg12) : 1 - comg12);
    const t = hypot(salp2, calp2);
    salp2 /= t;
    calp2 /= t;
    sig12 = Math.atan2(ssig12, csig12);
  } else if (!(Math.abs(shape.n) > 0.1 || csig12 >= 0 || ssig12 >= 6 * Math.abs(shape.n) * Math.PI * sq(cbet1))) {
    // The points are almost antipodal. The scale puts the antipodal point at the origin and the singular point at (-1, 0).
    const lam12x = Math.atan2(-slam12, -clam12);
    let x: number;
    let y: number;
    let lamscale: number;
    if (shape.f >= 0) {
      const k2 = sq(sbet1) * shape.ep2;
      const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
      lamscale = shape.f * cbet1 * a3f(shape, eps) * Math.PI;
      const betscale = lamscale * cbet1;
      x = lam12x / lamscale;
      y = sbet12a / betscale;
    } else {
      const cbet12a = cbet2 * cbet1 - sbet2 * sbet1;
      const bet12a = Math.atan2(sbet12a, cbet12a);
      const v = lengths(shape.n, Math.PI + bet12a, sbet1, -cbet1, dn1, sbet2, cbet2, dn2, "reduced", C1a, C2a);
      x = -1 + v.m12b / (cbet1 * cbet2 * v.m0 * Math.PI);
      const betscale = x < -0.01 ? sbet12a / x : -shape.f * sq(cbet1) * Math.PI;
      lamscale = betscale / cbet1;
      y = lam12 / lamscale;
    }
    if (y > -TOL1 && x > -1 - XTHRESH) {
      // The point is in the strip near the cut.
      if (shape.f >= 0) {
        salp1 = Math.min(1, -x);
        calp1 = -Math.sqrt(1 - sq(salp1));
      } else {
        calp1 = Math.max(x > -TOL1 ? 0 : -1, x);
        salp1 = Math.sqrt(1 - sq(calp1));
      }
    } else {
      const k = astroid(x, y);
      const omg12a = lamscale * (shape.f >= 0 ? (-x * k) / (1 + k) : (-y * (1 + k)) / k);
      somg12 = Math.sin(omg12a);
      comg12 = -Math.cos(omg12a);
      salp1 = cbet2 * somg12;
      calp1 = sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);
    }
  }
  // This test lets a NaN through.
  if (!(salp1 <= 0)) {
    const t = hypot(salp1, calp1);
    salp1 /= t;
    calp1 /= t;
  } else {
    salp1 = 1;
    calp1 = 0;
  }
  return { sig12, salp1, calp1, salp2, calp2, dnm };
}

/** The result of `lambda12`: the longitude difference for the start azimuth, its derivative, and the values of the line. */
interface Lambda {
  readonly lam12: number;
  readonly salp2: number;
  readonly calp2: number;
  readonly sig12: number;
  readonly ssig1: number;
  readonly csig1: number;
  readonly ssig2: number;
  readonly csig2: number;
  readonly eps: number;
  readonly dlam12: number;
}

/** This function gives the difference of the longitude at the second point and the target longitude, for the start azimuth. */
function lambda12(
  shape: Shape,
  sbet1: number,
  cbet1: number,
  dn1: number,
  sbet2: number,
  cbet2: number,
  dn2: number,
  salp1: number,
  calp1In: number,
  slam120: number,
  clam120: number,
  diffp: boolean,
  C1a: Float64Array,
  C2a: Float64Array,
  C3a: Float64Array,
): Lambda {
  // An equatorial line is a special case of the inverse problem. This value removes its degeneracy.
  const calp1 = sbet1 === 0 && calp1In === 0 ? -TINY : calp1In;
  const salp0 = salp1 * cbet1;
  const calp0 = hypot(calp1, salp1 * sbet1);
  let ssig1 = sbet1;
  const somg1 = salp0 * sbet1;
  let csig1 = calp1 * cbet1;
  const comg1 = csig1;
  let t = hypot(ssig1, csig1);
  ssig1 /= t;
  csig1 /= t;
  // These values keep the symmetries for abs(bet2) = -bet1.
  const salp2 = cbet2 !== cbet1 ? salp0 / cbet2 : salp1;
  const calp2 =
    cbet2 !== cbet1 || Math.abs(sbet2) !== -sbet1
      ? Math.sqrt(sq(calp1 * cbet1) + (cbet1 < -sbet1 ? (cbet2 - cbet1) * (cbet1 + cbet2) : (sbet1 - sbet2) * (sbet1 + sbet2))) / cbet2
      : Math.abs(calp1);
  let ssig2 = sbet2;
  const somg2 = salp0 * sbet2;
  let csig2 = calp2 * cbet2;
  const comg2 = csig2;
  t = hypot(ssig2, csig2);
  ssig2 /= t;
  csig2 /= t;
  const sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2), csig1 * csig2 + ssig1 * ssig2);
  const somg12 = Math.max(0, comg1 * somg2 - somg1 * comg2);
  const comg12 = comg1 * comg2 + somg1 * somg2;
  const eta = Math.atan2(somg12 * clam120 - comg12 * slam120, comg12 * clam120 + somg12 * slam120);
  const k2 = sq(calp0) * shape.ep2;
  const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
  c3f(shape, eps, C3a);
  const B312 = sinSeries(ssig2, csig2, C3a) - sinSeries(ssig1, csig1, C3a);
  const domg12 = -shape.f * a3f(shape, eps) * salp0 * (sig12 + B312);
  let dlam12 = Number.NaN;
  if (diffp) {
    if (calp2 === 0) dlam12 = (-2 * shape.f1 * dn1) / sbet1;
    else {
      dlam12 = lengths(eps, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, "reduced", C1a, C2a).m12b;
      dlam12 *= shape.f1 / (calp2 * cbet2);
    }
  }
  return { lam12: eta + domg12, salp2, calp2, sig12, ssig1, csig1, ssig2, csig2, eps, dlam12 };
}

/** The solution of the inverse problem: the distance in metres and the sines and the cosines of the two azimuths. */
interface InverseSolution {
  readonly s12: number;
  readonly salp1: number;
  readonly calp1: number;
  readonly salp2: number;
  readonly calp2: number;
}

/** This function solves the inverse problem for two points with latitudes from -90 to 90 and finite longitudes. */
function inverse(shape: Shape, lat1In: number, lon1: number, lat2In: number, lon2: number): InverseSolution {
  // A latitude very near the equator becomes 0.
  let lat1 = angRound(lat1In);
  let lat2 = angRound(lat2In);
  const diff = angDiff(lon1, lon2);
  let lon12 = diff.d;
  let lon12s = diff.e;
  // The transformations of `lonsign`, `swapp` and `latsign` give 0 <= lon12 <= 180, -90 <= lat1 <= 0 and lat1 <= lat2 <= -lat1.
  let lonsign = copysign(1, lon12);
  lon12 *= lonsign;
  lon12s *= lonsign;
  const lam12 = lon12 * DEGREE;
  const lam = sincosde(lon12, lon12s);
  const slam12 = lam.s;
  const clam12 = lam.c;
  // The supplementary longitude difference.
  lon12s = 180 - lon12 - lon12s;
  const swapp = Math.abs(lat1) < Math.abs(lat2) ? -1 : 1;
  if (swapp < 0) {
    lonsign *= -1;
    [lat1, lat2] = [lat2, lat1];
  }
  const latsign = copysign(1, -lat1);
  lat1 *= latsign;
  lat2 *= latsign;

  let t = sincosd(lat1);
  let sbet1 = shape.f1 * t.s;
  let cbet1 = t.c;
  let h = hypot(sbet1, cbet1);
  sbet1 /= h;
  cbet1 /= h;
  // A pole has a cosine of +TINY.
  cbet1 = Math.max(TINY, cbet1);
  t = sincosd(lat2);
  let sbet2 = shape.f1 * t.s;
  let cbet2 = t.c;
  h = hypot(sbet2, cbet2);
  sbet2 /= h;
  cbet2 /= h;
  cbet2 = Math.max(TINY, cbet2);
  // A difference that is 0 by rounding becomes an exact bet2 = +/- bet1.
  if (cbet1 < -sbet1) {
    if (cbet2 === cbet1) sbet2 = copysign(sbet1, sbet2);
  } else if (Math.abs(sbet2) === -sbet1) {
    cbet2 = cbet1;
  }
  const dn1 = Math.sqrt(1 + shape.ep2 * sq(sbet1));
  const dn2 = Math.sqrt(1 + shape.ep2 * sq(sbet2));
  // The entry 0 of these arrays is not used.
  const C1a = new Float64Array(7);
  const C2a = new Float64Array(7);
  const C3a = new Float64Array(6);

  let salp1 = 0;
  let calp1 = 0;
  let salp2 = 0;
  let calp2 = 0;
  let s12x = 0;
  let meridian = lat1 === -90 || slam12 === 0;
  if (meridian) {
    // The two points are on one meridian, so the geodesic can be along the meridian.
    calp1 = clam12;
    salp1 = slam12;
    calp2 = 1;
    salp2 = 0;
    const ssig1 = sbet1;
    const csig1 = calp1 * cbet1;
    const ssig2 = sbet2;
    const csig2 = calp2 * cbet2;
    const sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2), csig1 * csig2 + ssig1 * ssig2);
    const v = lengths(shape.n, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, "both", C1a, C2a);
    s12x = v.s12b;
    const m12x = v.m12b;
    if (sig12 < TOL2 || m12x >= 0) {
      // A line of length 0 can give a reduced length less than 0. The test keeps the distance at 0 or more.
      if (sig12 < 3 * TINY || (sig12 < TOL0 && (s12x < 0 || m12x < 0))) s12x = 0;
      s12x *= shape.b;
    } else {
      // The reduced length is less than 0: the ellipsoid is prolate, and the points are almost antipodal.
      meridian = false;
    }
  }
  if (!meridian && sbet1 === 0 && (shape.f <= 0 || lon12s >= shape.f * 180)) {
    // The geodesic is along the equator.
    calp1 = 0;
    calp2 = 0;
    salp1 = 1;
    salp2 = 1;
    s12x = shape.a * lam12;
  } else if (!meridian) {
    const start = inverseStart(shape, sbet1, cbet1, dn1, sbet2, cbet2, dn2, lam12, slam12, clam12, C1a, C2a);
    salp1 = start.salp1;
    calp1 = start.calp1;
    if (start.sig12 >= 0) {
      // A very short line.
      salp2 = start.salp2;
      calp2 = start.calp2;
      s12x = start.sig12 * shape.b * start.dnm;
    } else {
      // The Newton iteration on alp1, with a bracket (alp1a, alp1b) of the root. A bisection step replaces a bad Newton step.
      let salp1a = TINY;
      let calp1a = 1;
      let salp1b = TINY;
      let calp1b = -1;
      let tripn = false;
      let tripb = false;
      for (let numit = 0; ; numit += 1) {
        const v = lambda12(shape, sbet1, cbet1, dn1, sbet2, cbet2, dn2, salp1, calp1, slam12, clam12, numit < MAXIT1, C1a, C2a, C3a);
        // The reversed test lets a NaN stop the loop.
        if (tripb || !(Math.abs(v.lam12) >= (tripn ? 8 : 1) * TOL0) || numit === MAXIT2) {
          salp2 = v.salp2;
          calp2 = v.calp2;
          s12x = lengths(v.eps, v.sig12, v.ssig1, v.csig1, dn1, v.ssig2, v.csig2, dn2, "distance", C1a, C2a).s12b * shape.b;
          break;
        }
        if (v.lam12 > 0 && (numit < MAXIT1 || calp1 / salp1 > calp1b / salp1b)) {
          salp1b = salp1;
          calp1b = calp1;
        } else if (v.lam12 < 0 && (numit < MAXIT1 || calp1 / salp1 < calp1a / salp1a)) {
          salp1a = salp1;
          calp1a = calp1;
        }
        if (numit < MAXIT1 && v.dlam12 > 0) {
          const dalp1 = -v.lam12 / v.dlam12;
          if (Math.abs(dalp1) < Math.PI) {
            const sdalp1 = Math.sin(dalp1);
            const cdalp1 = Math.cos(dalp1);
            const nsalp1 = salp1 * cdalp1 + calp1 * sdalp1;
            if (nsalp1 > 0) {
              calp1 = calp1 * cdalp1 - salp1 * sdalp1;
              salp1 = nsalp1;
              const n = hypot(salp1, calp1);
              salp1 /= n;
              calp1 /= n;
              // Near a slope of 0, the convergence is not quadratic. Then the test uses epsilon, not its square root.
              tripn = Math.abs(v.lam12) <= 16 * TOL0;
              continue;
            }
          }
        }
        // The derivative is not positive, or the Newton step goes out of (0, pi). The next estimate is the middle of the bracket.
        salp1 = (salp1a + salp1b) / 2;
        calp1 = (calp1a + calp1b) / 2;
        const n = hypot(salp1, calp1);
        salp1 /= n;
        calp1 /= n;
        tripn = false;
        tripb = Math.abs(salp1a - salp1) + (calp1a - calp1) < TOLB || Math.abs(salp1 - salp1b) + (calp1 - calp1b) < TOLB;
      }
    }
  }
  if (swapp < 0) {
    [salp1, salp2] = [salp2, salp1];
    [calp1, calp2] = [calp2, calp1];
  }
  salp1 *= swapp * lonsign;
  calp1 *= swapp * latsign;
  salp2 *= swapp * lonsign;
  calp2 *= swapp * latsign;
  return { s12: 0 + s12x, salp1, calp1, salp2, calp2 };
}

/** The solution of the direct problem: the end point and the sine and the cosine of the final azimuth. */
interface DirectSolution {
  readonly lat2: number;
  readonly lon2: number;
  readonly salp2: number;
  readonly calp2: number;
}

/** This function solves the direct problem for a latitude from -90 to 90 and finite values. */
function direct(shape: Shape, lat1: number, lon1: number, azi1: number, s12: number): DirectSolution {
  const alp1 = sincosd(angRound(angNormalize(azi1)));
  const salp1 = alp1.s;
  const calp1 = alp1.c;
  const bet1 = sincosd(angRound(lat1));
  let sbet1 = shape.f1 * bet1.s;
  let cbet1 = bet1.c;
  let h = hypot(sbet1, cbet1);
  sbet1 /= h;
  cbet1 /= h;
  cbet1 = Math.max(TINY, cbet1);
  // The azimuth alp0 at the equator, from sin(alp1) cos(bet1) = sin(alp0).
  const salp0 = salp1 * cbet1;
  const calp0 = hypot(calp1, salp1 * sbet1);
  // The arc length sig1 from the equator, from tan(bet1) = tan(sig1) cos(alp1), and omg1 from tan(omg1) = sin(alp0) tan(sig1).
  let ssig1 = sbet1;
  const somg1 = salp0 * sbet1;
  let csig1 = sbet1 !== 0 || calp1 !== 0 ? cbet1 * calp1 : 1;
  const comg1 = csig1;
  h = hypot(ssig1, csig1);
  ssig1 /= h;
  csig1 /= h;
  const k2 = sq(calp0) * shape.ep2;
  const eps = k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);
  const A1m1 = a1m1f(eps);
  const C1a = new Float64Array(7);
  fourierCoefficients(C1F_COEFF, eps, C1a);
  const B11 = sinSeries(ssig1, csig1, C1a);
  let s = Math.sin(B11);
  let c = Math.cos(B11);
  // tau1 = sig1 + B11
  const stau1 = ssig1 * c + csig1 * s;
  const ctau1 = csig1 * c - ssig1 * s;
  const C1pa = new Float64Array(7);
  fourierCoefficients(C1PF_COEFF, eps, C1pa);
  const C3a = new Float64Array(6);
  c3f(shape, eps, C3a);
  const A3c = -shape.f * salp0 * a3f(shape, eps);
  const B31 = sinSeries(ssig1, csig1, C3a);

  const tau12 = s12 / (shape.b * (1 + A1m1));
  s = Math.sin(tau12);
  c = Math.cos(tau12);
  // tau2 = tau1 + tau12
  const B12 = -sinSeries(stau1 * c + ctau1 * s, ctau1 * c - stau1 * s, C1pa);
  let sig12 = tau12 - (B12 - B11);
  let ssig12 = Math.sin(sig12);
  let csig12 = Math.cos(sig12);
  if (Math.abs(shape.f) > 0.01) {
    // The reverted series of the distance is not accurate for |f| > 1/100. One Newton step corrects sig12.
    const ssig2 = ssig1 * csig12 + csig1 * ssig12;
    const csig2 = csig1 * csig12 - ssig1 * ssig12;
    const B12n = sinSeries(ssig2, csig2, C1a);
    const serr = (1 + A1m1) * (sig12 + (B12n - B11)) - s12 / shape.b;
    sig12 = sig12 - serr / Math.sqrt(1 + k2 * sq(ssig2));
    ssig12 = Math.sin(sig12);
    csig12 = Math.cos(sig12);
  }
  // sig2 = sig1 + sig12
  const ssig2 = ssig1 * csig12 + csig1 * ssig12;
  let csig2 = csig1 * csig12 - ssig1 * ssig12;
  // sin(bet2) = cos(alp0) sin(sig2)
  const sbet2 = calp0 * ssig2;
  let cbet2 = hypot(salp0, calp0 * csig2);
  if (cbet2 === 0) {
    // This occurs for salp0 = 0 and csig2 = 0. The value removes the degeneracy.
    cbet2 = TINY;
    csig2 = TINY;
  }
  // tan(alp0) = cos(sig2) tan(alp2)
  const salp2 = salp0;
  const calp2 = calp0 * csig2;
  // tan(omg2) = sin(alp0) tan(sig2)
  const somg2 = salp0 * ssig2;
  const comg2 = csig2;
  const omg12 = Math.atan2(somg2 * comg1 - comg2 * somg1, comg2 * comg1 + somg2 * somg1);
  const lam12 = omg12 + A3c * (sig12 + (sinSeries(ssig2, csig2, C3a) - B31));
  const lon12 = lam12 / DEGREE;
  return {
    lat2: atan2d(sbet2, shape.f1 * cbet2),
    lon2: angNormalize(angNormalize(lon1) + angNormalize(lon12)),
    salp2,
    calp2,
  };
}

function checkFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new GeoError("not-finite", `The ${name} ${value} is not a finite number`);
}

/**
 * This function gives the geodesic between two points on an ellipsoid: its length and its bearings at the two ends.
 * The geodesic is the shortest path between the two points on the ellipsoid.
 *
 * - The bearings are in degrees clockwise from north, from 0 to less than 360, as `initialBearing` gives them.
 * - The final bearing is the direction of the geodesic at `to`, away from `from`.
 * - Two longitudes that are different by a multiple of 360 are equal.
 * - At a pole, the bearing is measured from the meridian of the longitude of the point, as in `initialBearing`.
 * - For two equal points, the length and the two bearings are 0, as in `initialBearing`.
 * - For two points that are almost antipodal, more than one geodesic can be the shortest. Then the result is one of them.
 *
 * @param from - The first point.
 * @param to - The second point.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @returns The length in metres and the two bearings.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function geodesicInverse(from: LatLon, to: LatLon, ellipsoid: Ellipsoid = WGS84): GeodesicInverse {
  checkPoint(from);
  checkPoint(to);
  const solution = inverse(shapeOf(ellipsoid), from.lat, from.lon, to.lat, to.lon);
  if (solution.s12 === 0) return { meters: 0, initialBearing: 0, finalBearing: 0 };
  return {
    meters: solution.s12,
    initialBearing: bearing(atan2d(solution.salp1, solution.calp1)),
    finalBearing: bearing(atan2d(solution.salp2, solution.calp2)),
  };
}

/**
 * This function gives the point at a distance along the geodesic from a start point with an initial bearing. It also
 * gives the bearing of the geodesic at that point.
 *
 * - The bearings are in degrees clockwise from north. The final bearing is from 0 to less than 360.
 * - A negative distance goes in the opposite direction. A geodesic can go around the ellipsoid more than one time.
 * - At a pole, the bearing is measured from the meridian of `from.lon`, as in `geodesicInverse`.
 * - The longitude of the result is normalized.
 *
 * @param from - The start point.
 * @param bearingDegrees - The initial bearing in degrees clockwise from north. Each finite value is correct.
 * @param meters - The distance along the geodesic in metres. Each finite value is correct.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @returns The end point and the final bearing.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function geodesicDirect(from: LatLon, bearingDegrees: number, meters: number, ellipsoid: Ellipsoid = WGS84): GeodesicDirect {
  checkPoint(from);
  checkFinite(bearingDegrees, "bearing");
  checkFinite(meters, "distance");
  const solution = direct(shapeOf(ellipsoid), from.lat, from.lon, bearingDegrees, meters);
  return { point: latLon(solution.lat2 + 0, solution.lon2), finalBearing: bearing(atan2d(solution.salp2, solution.calp2)) };
}
