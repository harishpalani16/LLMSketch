import type { Pt2, StrokeKind } from "../core/types.ts";
import { bbox2, centroid2, dist2, polylineLength, resample, shoelace } from "./geom.ts";

export interface Fit {
  kind: StrokeKind;
  pts: Pt2[];
  closed: boolean;
  /** 0..1, higher is a better match; the caller keeps the best */
  score: number;
}

const TAU = Math.PI * 2;

function ringOf(n: number, f: (t: number) => Pt2): Pt2[] {
  return new Array(n).fill(0).map((_, i) => f((i / n) * TAU));
}

/** rms distance from the source points to a candidate polyline, normalised by size */
function rmsError(src: Pt2[], cand: Pt2[], closed: boolean): number {
  let sum = 0;
  const segs = closed ? cand.length : cand.length - 1;
  for (const p of src) {
    let best = Infinity;
    for (let i = 0; i < segs; i++) {
      const A = cand[i]!;
      const B = cand[(i + 1) % cand.length]!;
      const dx = B.a - A.a;
      const dy = B.b - A.b;
      const l2 = dx * dx + dy * dy;
      const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.a - A.a) * dx + (p.b - A.b) * dy) / l2));
      const d = Math.hypot(p.a - (A.a + t * dx), p.b - (A.b + t * dy));
      if (d < best) best = d;
    }
    sum += best * best;
  }
  return Math.sqrt(sum / Math.max(1, src.length));
}

function scoreFrom(err: number, size: number): number {
  if (size < 1e-9) return 0;
  return Math.max(0, 1 - (err / size) * 12);
}

function fitLine(src: Pt2[]): Fit {
  const A = src[0]!;
  const B = src[src.length - 1]!;
  const pts = [{ ...A }, { ...B }];
  const size = dist2(A, B);
  return { kind: "line", pts, closed: false, score: scoreFrom(rmsError(src, pts, false), size) };
}

function fitRect(src: Pt2[]): Fit {
  const bb = bbox2(src);
  const pts: Pt2[] = [
    { a: bb.minA, b: bb.minB },
    { a: bb.maxA, b: bb.minB },
    { a: bb.maxA, b: bb.maxB },
    { a: bb.minA, b: bb.maxB },
  ];
  const size = Math.hypot(bb.maxA - bb.minA, bb.maxB - bb.minB);
  return { kind: "rect", pts, closed: true, score: scoreFrom(rmsError(src, pts, true), size) };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r]![i]!) > Math.abs(m[piv]![i]!)) piv = r;
    if (Math.abs(m[piv]![i]!) < 1e-12) return null;
    const tmp = m[i]!;
    m[i] = m[piv]!;
    m[piv] = tmp;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r]![i]! / m[i]![i]!;
      for (let c = i; c < 4; c++) m[r]![c] = m[r]![c]! - f * m[i]![c]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  rms: number;
}

/** Kasa algebraic circle fit; also used by the heuristic interpreter. */
export function circleFit(src: Pt2[]): CircleFit | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = src.length;
  if (n < 3) return null;
  for (const p of src) {
    const z = p.a * p.a + p.b * p.b;
    sx += p.a; sy += p.b; sz += z;
    sxx += p.a * p.a; syy += p.b * p.b; sxy += p.a * p.b;
    sxz += p.a * z; syz += p.b * z;
  }
  const sol = solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], [sxz, syz, sz]);
  if (!sol) return null;
  const cx = sol[0]! / 2;
  const cy = sol[1]! / 2;
  const r = Math.sqrt(Math.max(0, sol[2]! + cx * cx + cy * cy));
  let err = 0;
  for (const p of src) err += (Math.hypot(p.a - cx, p.b - cy) - r) ** 2;
  return { cx, cy, r, rms: Math.sqrt(err / n) };
}

function fitCircle(src: Pt2[]): Fit {
  const f = circleFit(src);
  if (!f) return { kind: "circle", pts: [], closed: true, score: 0 };
  const pts = ringOf(48, (t) => ({ a: f.cx + f.r * Math.cos(t), b: f.cy + f.r * Math.sin(t) }));
  return { kind: "circle", pts, closed: true, score: scoreFrom(f.rms, 2 * f.r) };
}

function fitEllipse(src: Pt2[]): Fit {
  // axis-aligned ellipse through the bbox -- enough for a sketch tool
  const bb = bbox2(src);
  const cx = (bb.minA + bb.maxA) / 2;
  const cy = (bb.minB + bb.maxB) / 2;
  const ra = (bb.maxA - bb.minA) / 2;
  const rb = (bb.maxB - bb.minB) / 2;
  const pts = ringOf(48, (t) => ({ a: cx + ra * Math.cos(t), b: cy + rb * Math.sin(t) }));
  let err = 0;
  for (const p of src) {
    const k = Math.hypot((p.a - cx) / (ra || 1), (p.b - cy) / (rb || 1));
    err += ((k - 1) * Math.max(ra, rb)) ** 2;
  }
  err = Math.sqrt(err / src.length);
  return { kind: "ellipse", pts, closed: true, score: scoreFrom(err, Math.max(ra, rb) * 2) };
}

function fitArc(src: Pt2[]): Fit {
  const f = circleFit(src);
  if (!f || f.r < 1e-9) return { kind: "arc", pts: [], closed: false, score: 0 };
  const ang = (p: Pt2) => Math.atan2(p.b - f.cy, p.a - f.cx);
  const a0 = ang(src[0]!);
  let sweep = 0;
  let prev = a0;
  for (let i = 1; i < src.length; i++) {
    let d = ang(src[i]!) - prev;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    sweep += d;
    prev += d;
  }
  if (Math.abs(sweep) < 0.35) return { kind: "arc", pts: [], closed: false, score: 0 };
  const n = 32;
  const pts = new Array(n).fill(0).map((_, i) => {
    const t = a0 + (sweep * i) / (n - 1);
    return { a: f.cx + f.r * Math.cos(t), b: f.cy + f.r * Math.sin(t) };
  });
  return { kind: "arc", pts, closed: false, score: scoreFrom(f.rms, 2 * f.r) };
}

function fitPolygon(src: Pt2[]): Fit {
  const cen = centroid2(src);
  let rSum = 0;
  for (const p of src) rSum += dist2(p, cen);
  const r = rSum / src.length;
  let best: Fit = { kind: "polygon", pts: [], closed: true, score: 0 };
  const phase = Math.atan2(src[0]!.b - cen.b, src[0]!.a - cen.a);
  for (let sides = 3; sides <= 8; sides++) {
    const pts = new Array(sides).fill(0).map((_, i) => ({
      a: cen.a + r * Math.cos(phase + (i / sides) * TAU),
      b: cen.b + r * Math.sin(phase + (i / sides) * TAU),
    }));
    const s = scoreFrom(rmsError(src, pts, true), r * 2);
    if (s > best.score) best = { kind: "polygon", pts, closed: true, score: s };
  }
  return best;
}

/**
 * Classify a committed freehand stroke and return the ideal fit, or null to
 * keep it freehand. SPEC §5.3.
 */
export function beautify(src: Pt2[], closedHint: boolean): Fit | null {
  if (src.length < 3) return null;
  const sampled = resample(src, Math.min(96, Math.max(24, src.length)), false);
  const bb = bbox2(sampled);
  const size = Math.hypot(bb.maxA - bb.minA, bb.maxB - bb.minB);
  if (size < 1e-6) return null;

  const gap = dist2(sampled[0]!, sampled[sampled.length - 1]!);
  const closed = closedHint || gap < size * 0.18;

  const candidates: Fit[] = closed
    ? [fitRect(sampled), fitCircle(sampled), fitEllipse(sampled), fitPolygon(sampled)]
    : [fitLine(sampled), fitArc(sampled)];

  candidates.sort((x, y) => y.score - x.score);
  const best = candidates[0]!;
  if (!best || best.score < 0.55 || best.pts.length === 0) return null;

  // prefer a circle over an ellipse when the two axes agree
  if (best.kind === "ellipse") {
    const c = candidates.find((f) => f.kind === "circle");
    if (c && c.score > best.score - 0.06) return c;
  }
  // a "polygon" with a near-as-good rect twin reads as a rect
  if (best.kind === "polygon") {
    const r = candidates.find((f) => f.kind === "rect");
    if (r && r.score > best.score - 0.05) return r;
  }
  return best;
}

/** Straightness helper used by the heuristic interpreter (SPEC §10). */
export function straightness(pts: Pt2[]): number {
  if (pts.length < 2) return 1;
  const chord = dist2(pts[0]!, pts[pts.length - 1]!);
  const len = polylineLength(pts, false);
  return len < 1e-9 ? 1 : chord / len;
}

export function circularity(pts: Pt2[]): number {
  const len = polylineLength(pts, true);
  const area = Math.abs(shoelace(pts));
  if (len < 1e-9) return 0;
  return (4 * Math.PI * area) / (len * len);
}
