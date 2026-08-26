import type { OC, Shape } from "./oc.ts";
import type { Vec3 } from "../core/planes.ts";
import {
  bboxOf,
  edgeDirection,
  edgeLength,
  edgeMidpoint,
  edgePolyline,
  edges as allEdges,
  faceFrame,
  faces as allFaces,
  explore,
} from "./occ.ts";

/**
 * SPEC §7 -- semantic sub-object selectors.
 *
 * Raw topology indices are unstable across re-evaluation, so every sub-object
 * reference is a declarative query resolved fresh at each evaluation. A query
 * that matches nothing throws with a message the user (and the model) can read.
 *
 * World is Y-up: the ground plane's normal is (0,1,0).
 */

const UP: Vec3 = [0, 1, 0];
const DEFAULT_TOL_DEG = 25;

export interface Selection {
  /** 1-based indices into the shape's stable face/edge order */
  indices: number[];
  /** flat polylines for highlighting: each entry is [x,y,z, x,y,z, ...] */
  polylines: number[][];
}

const AXES: Record<string, Vec3> = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
};

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class SelectorError extends Error {}

function fail(select: string, kind: string): never {
  throw new SelectorError(`'${select}' matched no ${kind}`);
}

function takeN(word: string, rest: string, total: number): number {
  const n = Number.parseInt(rest.trim(), 10);
  if (!Number.isFinite(n) || n < 1) throw new SelectorError(`'${word} ${rest}' needs a count of 1 or more`);
  return Math.min(n, total);
}

interface FaceInfo {
  index: number;
  face: Shape;
  n: Vec3;
  p: Vec3;
  area: number;
}

function faceInfos(oc: OC, shape: Shape): FaceInfo[] {
  return allFaces(oc, shape).map((face, i) => {
    const f = faceFrame(oc, face);
    return { index: i + 1, face, n: f.n, p: f.p, area: f.area };
  });
}

interface EdgeInfo {
  index: number;
  edge: Shape;
  dir: Vec3 | null;
  mid: Vec3;
  len: number;
}

function edgeInfos(oc: OC, shape: Shape): EdgeInfo[] {
  return allEdges(oc, shape).map((edge, i) => ({
    index: i + 1,
    edge,
    dir: edgeDirection(oc, edge),
    mid: edgeMidpoint(oc, edge),
    len: edgeLength(oc, edge),
  }));
}

function selectFaces(oc: OC, shape: Shape, select: string): FaceInfo[] {
  const s = select.trim().toLowerCase();
  const infos = faceInfos(oc, shape);
  if (!infos.length) fail(select, "faces");

  if (s === "all") return infos;
  if (s === "largest") return [infos.reduce((a, b) => (b.area > a.area ? b : a))];
  if (s === "smallest") return [infos.reduce((a, b) => (b.area < a.area ? b : a))];

  if (s === "top" || s === "bottom" || s === "top-cap" || s === "bottom-cap") {
    const sign = s.startsWith("top") ? 1 : -1;
    const facing = infos.filter((f) => dot3(f.n, UP) * sign > 0.7);
    const pool = facing.length ? facing : infos;
    // highest (or lowest) centroid wins, then area
    const best = pool.reduce((a, b) => {
      const da = a.p[1]! * sign;
      const db = b.p[1]! * sign;
      if (Math.abs(da - db) > 1e-6) return db > da ? b : a;
      return b.area > a.area ? b : a;
    });
    return [best];
  }

  if (s === "vertical") {
    const r = infos.filter((f) => Math.abs(dot3(f.n, UP)) < Math.sin((DEFAULT_TOL_DEG * Math.PI) / 180));
    return r.length ? r : fail(select, "faces");
  }
  if (s === "horizontal") {
    const r = infos.filter((f) => Math.abs(dot3(f.n, UP)) > Math.cos((DEFAULT_TOL_DEG * Math.PI) / 180));
    return r.length ? r : fail(select, "faces");
  }

  const facing = /^facing\s+([+-][xyz])(?:\s+([\d.]+))?$/.exec(s);
  if (facing) {
    const axis = AXES[facing[1]!]!;
    const tol = facing[2] ? Number(facing[2]) : DEFAULT_TOL_DEG;
    const lim = Math.cos((tol * Math.PI) / 180);
    const r = infos.filter((f) => dot3(f.n, axis) >= lim);
    return r.length ? r : fail(select, "faces");
  }

  const idx = /^index\s+(\d+)$/.exec(s);
  if (idx) {
    const i = Number(idx[1]);
    const f = infos.find((x) => x.index === i);
    return f ? [f] : fail(select, "faces");
  }

  const big = /^(longest|largest)\s+(\d+)$/.exec(s);
  if (big) {
    const n = takeN(big[1]!, big[2]!, infos.length);
    return [...infos].sort((a, b) => b.area - a.area).slice(0, n);
  }
  const small = /^(shortest|smallest)\s+(\d+)$/.exec(s);
  if (small) {
    const n = takeN(small[1]!, small[2]!, infos.length);
    return [...infos].sort((a, b) => a.area - b.area).slice(0, n);
  }

  throw new SelectorError(`'${select}' is not a face selector`);
}

function selectEdges(oc: OC, shape: Shape, select: string): EdgeInfo[] {
  const s = select.trim().toLowerCase();
  const infos = edgeInfos(oc, shape);
  if (!infos.length) fail(select, "edges");

  if (s === "all") return infos;

  const ofFace = /^of\s+face\s+(.+)$/.exec(s);
  if (ofFace) {
    const target = selectFaces(oc, shape, ofFace[1]!);
    const wanted = new Set<number>();
    for (const f of target) {
      for (const e of explore(oc, f.face, "EDGE")) {
        const hit = infos.find((info) => info.edge.IsSame(e));
        if (hit) wanted.add(hit.index);
      }
    }
    const r = infos.filter((e) => wanted.has(e.index));
    return r.length ? r : fail(select, "edges");
  }

  if (s === "top-cap" || s === "bottom-cap" || s === "top" || s === "bottom") {
    const bb = bboxOf(oc, shape);
    const span = Math.max(1e-6, bb[4]! - bb[1]!);
    const tol = Math.max(1e-4, span * 0.02);
    const level = s.startsWith("top") ? bb[4]! : bb[1]!;
    const r = infos.filter((e) => Math.abs(e.mid[1]! - level) <= tol);
    return r.length ? r : fail(select, "edges");
  }

  if (s === "vertical") {
    const r = infos.filter((e) => e.dir && Math.abs(dot3(e.dir, UP)) > 0.9);
    return r.length ? r : fail(select, "edges");
  }
  if (s === "horizontal") {
    const r = infos.filter((e) => e.dir && Math.abs(dot3(e.dir, UP)) < 0.1);
    return r.length ? r : fail(select, "edges");
  }

  const facing = /^facing\s+([+-][xyz])(?:\s+([\d.]+))?$/.exec(s);
  if (facing) {
    const axis = AXES[facing[1]!]!;
    const tol = facing[2] ? Number(facing[2]) : DEFAULT_TOL_DEG;
    const lim = Math.cos((tol * Math.PI) / 180);
    const r = infos.filter((e) => e.dir && Math.abs(dot3(e.dir, axis)) >= lim);
    return r.length ? r : fail(select, "edges");
  }

  const long = /^(longest|largest)\s*(\d*)$/.exec(s);
  if (long) {
    const n = long[2] ? takeN(long[1]!, long[2]!, infos.length) : 1;
    return [...infos].sort((a, b) => b.len - a.len).slice(0, n);
  }
  const short = /^(shortest|smallest)\s*(\d*)$/.exec(s);
  if (short) {
    const n = short[2] ? takeN(short[1]!, short[2]!, infos.length) : 1;
    return [...infos].sort((a, b) => a.len - b.len).slice(0, n);
  }

  const idx = /^index\s+(\d+)$/.exec(s);
  if (idx) {
    const i = Number(idx[1]);
    const e = infos.find((x) => x.index === i);
    return e ? [e] : fail(select, "edges");
  }

  throw new SelectorError(`'${select}' is not an edge selector`);
}

/** Resolve to the actual OCCT sub-shapes an op will consume. */
export function resolveShapes(oc: OC, shape: Shape, kind: "face" | "edges", select: string): Shape[] {
  return kind === "face"
    ? selectFaces(oc, shape, select).map((f) => f.face)
    : selectEdges(oc, shape, select).map((e) => e.edge);
}

/** Resolve to indices + display polylines, for highlighting in the viewport. */
export function resolveSelector(
  oc: OC,
  shape: Shape,
  kind: "face" | "edges",
  select: string,
): Selection {
  const bb = bboxOf(oc, shape);
  const diag = Math.hypot(bb[3]! - bb[0]!, bb[4]! - bb[1]!, bb[5]! - bb[2]!) || 1;
  const defl = diag * 0.004;
  if (kind === "face") {
    const picked = selectFaces(oc, shape, select);
    return {
      indices: picked.map((f) => f.index),
      polylines: picked.flatMap((f) =>
        explore(oc, f.face, "EDGE").map((e) => edgePolyline(oc, oc.TopoDS.Edge_1(e), defl)),
      ),
    };
  }
  const picked = selectEdges(oc, shape, select);
  return {
    indices: picked.map((e) => e.index),
    polylines: picked.map((e) => edgePolyline(oc, e.edge, defl)),
  };
}

/**
 * Best semantic selector for a clicked face (SPEC §7). Falls back to
 * `index i`, which is honest: an upstream edit will error the node rather than
 * silently re-point at a different face.
 */
export function describeFace(oc: OC, shape: Shape, faceIndex: number): string {
  const infos = faceInfos(oc, shape);
  const me = infos.find((f) => f.index === faceIndex);
  if (!me) return `index ${faceIndex}`;
  const unique = (sel: string): boolean => {
    try {
      const got = selectFaces(oc, shape, sel);
      return got.length === 1 && got[0]!.index === faceIndex;
    } catch {
      return false;
    }
  };
  for (const sel of ["top", "bottom", "largest", "smallest"]) if (unique(sel)) return sel;
  for (const key of Object.keys(AXES)) if (unique(`facing ${key}`)) return `facing ${key}`;
  return `index ${faceIndex}`;
}
