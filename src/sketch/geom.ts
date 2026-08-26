import type { Pt2, PlaneKey, Stroke, StrokeMetrics } from "../core/types.ts";
import { to3D } from "../core/planes.ts";

export const dist2 = (p: Pt2, q: Pt2): number => Math.hypot(p.a - q.a, p.b - q.b);

/** Signed area, CCW positive. Test 5: a 20x14 rect -> 280. */
export function shoelace(pts: Pt2[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    s += p.a * q.b - q.a * p.b;
  }
  return s / 2;
}

export function polylineLength(pts: Pt2[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist2(pts[i - 1]!, pts[i]!);
  if (closed && pts.length > 1) l += dist2(pts[pts.length - 1]!, pts[0]!);
  return l;
}

export function bbox2(pts: Pt2[]): { minA: number; minB: number; maxA: number; maxB: number } {
  let minA = Infinity, minB = Infinity, maxA = -Infinity, maxB = -Infinity;
  for (const p of pts) {
    if (p.a < minA) minA = p.a;
    if (p.b < minB) minB = p.b;
    if (p.a > maxA) maxA = p.a;
    if (p.b > maxB) maxB = p.b;
  }
  if (!pts.length) return { minA: 0, minB: 0, maxA: 0, maxB: 0 };
  return { minA, minB, maxA, maxB };
}

export function centroid2(pts: Pt2[]): Pt2 {
  let a = 0, b = 0;
  for (const p of pts) { a += p.a; b += p.b; }
  const n = pts.length || 1;
  return { a: a / n, b: b / n };
}

/** Ramer-Douglas-Peucker, run once on commit. */
export function rdp(pts: Pt2[], eps: number): Pt2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const A = pts[lo]!, B = pts[hi]!;
    const dx = B.a - A.a, dy = B.b - A.b;
    const len = Math.hypot(dx, dy);
    let best = -1, bestD = -1;
    for (let i = lo + 1; i < hi; i++) {
      const P = pts[i]!;
      const d = len < 1e-12
        ? Math.hypot(P.a - A.a, P.b - A.b)
        : Math.abs(dy * (P.a - A.a) - dx * (P.b - A.b)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD > eps && best > 0) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/**
 * Uniform arc-length resample to exactly `n` points.
 * Test 3: 72-pt resample of a 20x14 rect keeps perimeter within 0.5 of 68.
 */
export function resample(pts: Pt2[], n: number, closed = false): Pt2[] {
  if (pts.length === 0 || n < 2) return pts.slice();
  const src = closed ? [...pts, pts[0]!] : pts;
  const cum: number[] = [0];
  for (let i = 1; i < src.length; i++) cum.push(cum[i - 1]! + dist2(src[i - 1]!, src[i]!));
  const total = cum[cum.length - 1]!;
  if (total < 1e-12) return new Array(n).fill(0).map(() => ({ ...src[0]! }));
  const out: Pt2[] = [];
  const steps = closed ? n : n - 1;
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / steps;
    while (seg < cum.length - 1 && cum[seg]! < target) seg++;
    const t0 = cum[seg - 1]!, t1 = cum[seg]!;
    const f = t1 - t0 < 1e-12 ? 0 : (target - t0) / (t1 - t0);
    const P = src[seg - 1]!, Q = src[seg]!;
    out.push({ a: P.a + (Q.a - P.a) * f, b: P.b + (Q.b - P.b) * f, w: P.w });
  }
  return out;
}

/**
 * Loft ring pre-alignment. Rings arrive from freehand strokes with arbitrary
 * winding and arbitrary seam; ThruSections twists badly without this.
 * Test 4: reversed + rotated copies of one ring realign with zero drift.
 */
export function alignRings(rings: Pt2[][], n = 64): Pt2[][] {
  if (rings.length === 0) return [];
  // Rings that already share a vertex count are left alone: lofting a 4-point
  // rectangle to a 4-point rectangle should give a solid with four side faces,
  // not sixty-four. Mixed rings are resampled to a common count first.
  const first = rings[0]!.length;
  const uniform = rings.every((r) => r.length === first) && first >= 3 && first <= 48;
  const count = uniform ? first : n;
  const sampled = rings.map((r) => (uniform ? r.map((p) => ({ ...p })) : resample(r, count, true)));
  const ref0 = sampled[0]!;
  if (shoelace(ref0) < 0) ref0.reverse();
  const out: Pt2[][] = [ref0];
  for (let i = 1; i < sampled.length; i++) {
    let ring = sampled[i]!;
    if (shoelace(ring) < 0) ring = ring.slice().reverse();
    const prev = out[i - 1]!;
    // centre both so the rotation search compares shape, not position
    const cp = centroid2(prev), cr = centroid2(ring);
    let bestK = 0, bestErr = Infinity;
    for (let k = 0; k < count; k++) {
      let err = 0;
      for (let j = 0; j < count; j++) {
        const P = prev[j]!;
        const Q = ring[(j + k) % count]!;
        const da = (P.a - cp.a) - (Q.a - cr.a);
        const db = (P.b - cp.b) - (Q.b - cr.b);
        err += da * da + db * db;
        if (err >= bestErr) break;
      }
      if (err < bestErr) { bestErr = err; bestK = k; }
    }
    out.push(ring.slice(bestK).concat(ring.slice(0, bestK)));
  }
  return out;
}

/** One-euro filter -- live pointer smoothing (SPEC §5.1). */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;
  constructor(private minCutoff = 1.0, private beta = 0.007, private dCutoff = 1.0) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tSec: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;
    const dx = (x - this.xPrev) / dt;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuro.alpha(cutoff, dt);
    const x2 = a * x + (1 - a) * this.xPrev;
    this.xPrev = x2;
    return x2;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

export function strokeMetrics(pts: Pt2[], closed: boolean, plane: PlaneKey, offset: number): StrokeMetrics {
  const bb = bbox2(pts);
  const c = centroid2(pts);
  const c3 = to3D(c, plane, offset);
  return {
    w: bb.maxA - bb.minA,
    h: bb.maxB - bb.minB,
    len: polylineLength(pts, closed),
    area: closed ? Math.abs(shoelace(pts)) : 0,
    centroid: [c3[0], c3[1], c3[2]],
  };
}

export function recomputeMetrics(s: Stroke): Stroke {
  return { ...s, metrics: strokeMetrics(s.pts, s.closed, s.plane, s.offset) };
}

export function bboxDiagonal(pts: Pt2[]): number {
  const bb = bbox2(pts);
  return Math.hypot(bb.maxA - bb.minA, bb.maxB - bb.minB);
}
