import type { PlaneKey, Pt2 } from "./types.ts";

export type Vec3 = [number, number, number];

export interface PlaneBasis {
  /** screen-right in the plane's own view */
  u: Vec3;
  /** screen-up in the plane's own view */
  v: Vec3;
  /** normal; offset runs along it. u x v === n (right-handed) */
  n: Vec3;
}

/** SPEC §4 -- verified right-handed bases. Do not "tidy" the signs. */
export const PLANES: Record<PlaneKey, PlaneBasis> = {
  ground: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  side: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
};

export const PLANE_KEYS: PlaneKey[] = ["ground", "front", "side"];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function unit(a: Vec3): Vec3 {
  const l = norm(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Plane-local (a,b) at `offset` along n -> world xyz. */
export function to3D(p: Pt2, plane: PlaneKey, offset: number): Vec3 {
  const { u, v, n } = PLANES[plane];
  return [
    u[0] * p.a + v[0] * p.b + n[0] * offset,
    u[1] * p.a + v[1] * p.b + n[1] * offset,
    u[2] * p.a + v[2] * p.b + n[2] * offset,
  ];
}

/** World xyz -> plane-local (a,b); the n component is the offset. */
export function to2D(p: Vec3, plane: PlaneKey): Pt2 {
  const { u, v } = PLANES[plane];
  return { a: dot(p, u), b: dot(p, v) };
}

export function offsetOf(p: Vec3, plane: PlaneKey): number {
  return dot(p, PLANES[plane].n);
}

/** Basis for an arbitrary face plane (SPEC §5.6): stable u/v from a normal. */
export function basisFromNormal(n: Vec3): PlaneBasis {
  const nn = unit(n);
  const up: Vec3 = Math.abs(nn[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = unit(cross(up, nn));
  const v = cross(nn, u);
  return { u, v, n: nn };
}
