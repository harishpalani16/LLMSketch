import * as THREE from "three";
import type { PlaneKey, Pt2, Stroke } from "../core/types.ts";
import { PLANES, to2D, to3D } from "../core/planes.ts";
import type { Viewport } from "./viewport.ts";

/** Minimum |n . forward| before drawing on a sheet is refused (SPEC §15 P0). */
export const EDGE_ON_LIMIT = 0.12;

export function isEdgeOn(plane: PlaneKey, viewport: Viewport): boolean {
  const n = new THREE.Vector3(...PLANES[plane].n);
  return Math.abs(n.dot(viewport.forward())) < EDGE_ON_LIMIT;
}

/** Where a screen point lands on the given sketch plane, in plane coordinates. */
export function pointOnPlane(
  viewport: Viewport,
  plane: PlaneKey,
  offset: number,
  x: number,
  y: number,
): Pt2 | null {
  const n = PLANES[plane].n;
  const three = new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), -offset);
  const ray = viewport.screenToRay(x, y);
  const hit = ray.intersectPlane(three, new THREE.Vector3());
  if (!hit) return null;
  return to2D([hit.x, hit.y, hit.z], plane);
}

export interface SnapResult {
  point: Pt2;
  kind: "free" | "grid" | "endpoint" | "axis" | "close";
}

export interface SnapContext {
  strokes: Stroke[];
  plane: PlaneKey;
  offset: number;
  /** screen pixels per world unit, for the pixel-radius snaps */
  ppu: number;
  gridStep: number;
  axisLock: boolean;
  /** the stroke being drawn, for the auto-close ring */
  livePts: Pt2[];
}

/** SPEC §5.2 -- snapping, with the cue the caller draws returned as `kind`. */
export function snap(p: Pt2, ctx: SnapContext): SnapResult {
  const px = (n: number) => n / Math.max(1e-6, ctx.ppu);

  // auto-close ring at 14 px from the stroke's own start
  if (ctx.livePts.length > 8) {
    const start = ctx.livePts[0]!;
    if (Math.hypot(p.a - start.a, p.b - start.b) < px(14)) {
      return { point: { ...start }, kind: "close" };
    }
  }

  // endpoint / corner snap at 12 px
  let best: Pt2 | null = null;
  let bestD = px(12);
  for (const s of ctx.strokes) {
    if (s.plane !== ctx.plane || Math.abs(s.offset - ctx.offset) > 1e-6) continue;
    for (const q of s.pts) {
      const d = Math.hypot(p.a - q.a, p.b - q.b);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  if (best) return { point: { a: best.a, b: best.b, w: p.w }, kind: "endpoint" };

  if (ctx.axisLock && ctx.livePts.length) {
    const start = ctx.livePts[0]!;
    const da = Math.abs(p.a - start.a);
    const db = Math.abs(p.b - start.b);
    return {
      point: da > db ? { a: p.a, b: start.b, w: p.w } : { a: start.a, b: p.b, w: p.w },
      kind: "axis",
    };
  }

  if (ctx.gridStep > 0) {
    const g = ctx.gridStep;
    const snapped = { a: Math.round(p.a / g) * g, b: Math.round(p.b / g) * g, w: p.w };
    if (Math.hypot(p.a - snapped.a, p.b - snapped.b) < Math.min(g * 0.3, px(10))) {
      return { point: snapped, kind: "grid" };
    }
  }

  return { point: p, kind: "free" };
}

/** Offset levels already in use, for the offset slider's detents (SPEC §5.2). */
export function offsetDetents(strokes: Stroke[], plane: PlaneKey): number[] {
  const set = new Set<number>([0]);
  for (const s of strokes) if (s.plane === plane) set.add(Math.round(s.offset * 100) / 100);
  return [...set].sort((a, b) => a - b);
}

export function worldPoint(p: Pt2, plane: PlaneKey, offset: number): THREE.Vector3 {
  const v = to3D(p, plane, offset);
  return new THREE.Vector3(v[0], v[1], v[2]);
}
