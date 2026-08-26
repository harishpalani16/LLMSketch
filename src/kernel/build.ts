import type { OC, Scope, Shape } from "./oc.ts";
import type { PlaneKey, Pt2, Stroke } from "../core/types.ts";
import { PLANES, to3D, type Vec3 } from "../core/planes.ts";
import { alignRings, bbox2, resample } from "../sketch/geom.ts";
import { circleFit } from "../sketch/beautify.ts";
import { resolveShapes } from "./selectors.ts";
import {
  areaOf,
  ax1,
  ax2,
  bboxOf,
  boolOp,
  centroidOf,
  compoundOf,
  edgeLength,
  faceFromWire,
  faceFrame,
  faces,
  isEmpty,
  listOf,
  pln,
  pnt,
  prism,
  progress,
  transformed,
  vec,
  wireFromPoints,
} from "./occ.ts";

/**
 * Every operation's geometry. One builder per registered op (SPEC §8.1);
 * a registry test asserts the two lists stay in step.
 *
 * Builders never mutate: they return new shapes plus which inputs they consume.
 */

export interface BuildCtx {
  oc: OC;
  scope: Scope;
  stroke(id: string): Stroke;
  shape(id: string): Shape;
  /** display tags already on a solid, used by ops that carry them forward */
  tagsOf(id: string): string[];
}

export interface BuildResult {
  shapes: Shape[];
  tags?: string[];
}

export type Builder = (ctx: BuildCtx, p: Record<string, any>) => BuildResult;

/* -------------------------------------------------------------------------- */
/* stroke -> topology                                                          */
/* -------------------------------------------------------------------------- */

const pts3 = (s: Stroke): Vec3[] => s.pts.map((p) => to3D(p, s.plane, s.offset));

function requireClosed(s: Stroke): void {
  if (!s.closed) throw new Error(`${s.id} is an open stroke; this op needs a closed outline`);
}

function requireOpen(s: Stroke): void {
  if (s.closed) throw new Error(`${s.id} is a closed stroke; this op needs an open path`);
}

function wireOf(ctx: BuildCtx, s: Stroke): Shape {
  const pts = pts3(s);
  if (pts.length < 2) throw new Error(`${s.id} has too few points`);
  return wireFromPoints(ctx.oc, ctx.scope, pts, s.closed);
}

function faceOf(ctx: BuildCtx, s: Stroke): Shape {
  requireClosed(s);
  return faceFromWire(ctx.oc, ctx.scope, wireOf(ctx, s));
}

const normalOf = (s: Stroke): Vec3 => PLANES[s.plane].n;

/** Rings, resampled and pre-aligned so lofts do not twist (SPEC §8.1). */
function alignedWires(ctx: BuildCtx, strokes: Stroke[]): Shape[] {
  strokes.forEach(requireClosed);
  const rings = alignRings(strokes.map((s) => s.pts));
  return rings.map((ring, i) => {
    const s = strokes[i]!;
    return wireFromPoints(ctx.oc, ctx.scope, ring.map((p) => to3D(p, s.plane, s.offset)), true);
  });
}

/** Miter offset of an open polyline, used by `wall`. */
function offsetPolyline(pts: Pt2[], d: number): Pt2[] {
  const n = pts.length;
  const segN: Pt2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.a - pts[i]!.a;
    const dy = pts[i + 1]!.b - pts[i]!.b;
    const l = Math.hypot(dx, dy) || 1;
    segN.push({ a: -dy / l, b: dx / l });
  }
  const out: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const a = segN[Math.max(0, i - 1)]!;
    const b = segN[Math.min(segN.length - 1, i)]!;
    let mx = a.a + b.a;
    let my = a.b + b.b;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = b.a;
      my = b.b;
    } else {
      const cos = Math.max(0.2, (a.a * b.a + a.b * b.b + 1) / 2);
      mx = (mx / ml) / Math.sqrt(cos);
      my = (my / ml) / Math.sqrt(cos);
    }
    out.push({ a: pts[i]!.a + mx * d, b: pts[i]!.b + my * d });
  }
  return out;
}

function circleWire(ctx: BuildCtx, centre: Vec3, normal: Vec3, radius: number): Shape {
  const { oc, scope } = ctx;
  const circ = scope.t(new oc.gp_Circ_2(scope.t(ax2(oc, centre, normal)), radius));
  const edge = scope.t(new oc.BRepBuilderAPI_MakeEdge_8(circ)).Edge();
  return scope.t(new oc.BRepBuilderAPI_MakeWire_2(edge)).Wire();
}

function tangentAt(pts: Vec3[], i: number): Vec3 {
  const a = pts[Math.max(0, i - 1)]!;
  const b = pts[Math.min(pts.length - 1, i + 1)]!;
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

function sweepAlong(ctx: BuildCtx, spine: Shape, profile: Shape, frenet: boolean): Shape {
  const { oc, scope } = ctx;
  const mk = scope.t(new oc.BRepOffsetAPI_MakePipeShell(spine));
  if (frenet) mk.SetMode_1(true);
  else mk.SetMode_3(scope.t(new oc.gp_Dir_4(0, 1, 0)));
  mk.Add_1(profile, true, true);
  if (!mk.IsReady()) throw new Error("the rail and profile could not be combined into a sweep");
  mk.Build(scope.t(progress(oc)));
  if (!mk.IsDone()) throw new Error("sweep failed -- try a smoother rail");
  mk.MakeSolid();
  return mk.Shape();
}

function thruSections(ctx: BuildCtx, wires: Shape[], solid: boolean, ruled: boolean): Shape {
  const { oc, scope } = ctx;
  const ts = scope.t(new oc.BRepOffsetAPI_ThruSections(solid, ruled, 1e-6));
  for (const w of wires) ts.AddWire(w);
  ts.CheckCompatibility(false);
  ts.Build(scope.t(progress(oc)));
  if (!ts.IsDone()) throw new Error("loft failed -- the sections may be incompatible");
  return ts.Shape();
}

/** Box covering `bb` inflated by `pad`, clipped at `plane`+`offset` on one side. */
function halfBox(ctx: BuildCtx, bb: number[], plane: PlaneKey, offset: number, below: boolean): Shape {
  const { oc, scope } = ctx;
  const pad = Math.max(1, Math.hypot(bb[3]! - bb[0]!, bb[4]! - bb[1]!, bb[5]! - bb[2]!));
  const lo = [bb[0]! - pad, bb[1]! - pad, bb[2]! - pad];
  const hi = [bb[3]! + pad, bb[4]! + pad, bb[5]! + pad];
  const axis = plane === "ground" ? 1 : plane === "front" ? 2 : 0;
  if (below) hi[axis] = offset;
  else lo[axis] = offset;
  if (hi[axis]! <= lo[axis]!) throw new Error("that cut plane is outside the solid");
  return scope
    .t(new oc.BRepPrimAPI_MakeBox_4(
      scope.t(pnt(oc, lo as Vec3)),
      scope.t(pnt(oc, hi as Vec3)),
    ))
    .Shape();
}

function translateCopy(ctx: BuildCtx, shape: Shape, d: Vec3): Shape {
  const { oc, scope } = ctx;
  const t = scope.t(new oc.gp_Trsf_1());
  t.SetTranslation_1(scope.t(vec(oc, d)));
  return transformed(oc, scope, shape, t);
}

/* -------------------------------------------------------------------------- */
/* builders                                                                    */
/* -------------------------------------------------------------------------- */

export const BUILDERS: Record<string, Builder> = {
  extrude(ctx, p) {
    const s = ctx.stroke(p.stroke);
    const n = normalOf(s);
    const h = p.height as number;
    const face = faceOf(ctx, s);
    const solid = prism(ctx.oc, ctx.scope, face, [n[0] * h, n[1] * h, n[2] * h]);
    const taper = (p.taper as number) ?? 0;
    if (!taper) return { shapes: [solid] };
    return { shapes: [applyDraft(ctx, solid, face, n, taper)] };
  },

  loft(ctx, p) {
    const strokes = (p.strokes as string[]).map((id) => ctx.stroke(id));
    const wires = alignedWires(ctx, strokes);
    return { shapes: [thruSections(ctx, wires, true, Boolean(p.ruled))] };
  },

  revolve(ctx, p) {
    const { oc, scope } = ctx;
    const profile = ctx.stroke(p.profile);
    const axisStroke = ctx.stroke(p.axis);
    requireClosed(profile);
    requireOpen(axisStroke);
    const ap = pts3(axisStroke);
    const a0 = ap[0]!;
    const a1 = ap[ap.length - 1]!;
    const d: Vec3 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l < 1e-6) throw new Error(`${axisStroke.id} is too short to be an axis`);
    const face = faceOf(ctx, profile);
    const mk = scope.t(
      new oc.BRepPrimAPI_MakeRevol_1(
        face,
        scope.t(ax1(oc, a0, [d[0] / l, d[1] / l, d[2] / l])),
        ((p.angle as number) * Math.PI) / 180,
        false,
      ),
    );
    mk.Build(scope.t(progress(oc)));
    if (!mk.IsDone()) throw new Error("revolve failed -- the axis may cross the profile");
    return { shapes: [mk.Shape()] };
  },

  sweep(ctx, p) {
    const profile = ctx.stroke(p.profile);
    const rail = ctx.stroke(p.rail);
    requireClosed(profile);
    requireOpen(rail);
    const spine = wireOf(ctx, rail);
    const prof = wireOf(ctx, profile);
    return { shapes: [sweepAlong(ctx, spine, prof, !p.keep_normal)] };
  },

  pipe(ctx, p) {
    const s = ctx.stroke(p.stroke);
    const pts = pts3(s);
    const spine = wireOf(ctx, s);
    const prof = circleWire(ctx, pts[0]!, tangentAt(pts, 0), p.radius as number);
    return { shapes: [sweepAlong(ctx, spine, prof, true)] };
  },

  wall(ctx, p) {
    const s = ctx.stroke(p.stroke);
    requireOpen(s);
    const t = (p.thickness as number) / 2;
    const left = offsetPolyline(s.pts, t);
    const right = offsetPolyline(s.pts, -t);
    const ring = [...left, ...right.slice().reverse()];
    const wire = wireFromPoints(
      ctx.oc,
      ctx.scope,
      ring.map((q) => to3D(q, s.plane, s.offset)),
      true,
    );
    const face = faceFromWire(ctx.oc, ctx.scope, wire);
    const n = normalOf(s);
    const h = p.height as number;
    return { shapes: [prism(ctx.oc, ctx.scope, face, [n[0] * h, n[1] * h, n[2] * h])], tags: ["wall"] };
  },

  slab(ctx, p) {
    const s = ctx.stroke(p.stroke);
    const n = normalOf(s);
    const t = p.thickness as number;
    const face = faceOf(ctx, s);
    return {
      shapes: [prism(ctx.oc, ctx.scope, face, [n[0] * t, n[1] * t, n[2] * t])],
      tags: ["slab"],
    };
  },

  patch(ctx, p) {
    return { shapes: [faceOf(ctx, ctx.stroke(p.stroke))] };
  },

  network_surface(ctx, p) {
    const u = (p.u_strokes as string[]).map((id) => ctx.stroke(id));
    const v = (p.v_strokes as string[]).map((id) => ctx.stroke(id));
    // Skin through whichever direction has more sections; the other direction's
    // strokes set the sample count, so both families shape the result.
    const [sections, rails] = u.length >= v.length ? [u, v] : [v, u];
    const n = Math.max(8, Math.min(64, rails.length * 8));
    const wires = sections.map((s) => {
      const pts = resample(s.pts, n, s.closed);
      return wireFromPoints(ctx.oc, ctx.scope, pts.map((q) => to3D(q, s.plane, s.offset)), s.closed);
    });
    return { shapes: [thruSections(ctx, wires, false, false)] };
  },

  stack(ctx, p) {
    const s = ctx.stroke(p.stroke);
    const n = normalOf(s);
    const floors = p.floors as number;
    const fh = p.floor_height as number;
    const t = Math.min(0.3, fh * 0.12);
    const face = faceOf(ctx, s);
    const plates: Shape[] = [];
    for (let i = 0; i < floors; i++) {
      const base = i === 0 ? face : translateCopy(ctx, face, [n[0] * fh * i, n[1] * fh * i, n[2] * fh * i]);
      plates.push(prism(ctx.oc, ctx.scope, base, [n[0] * t, n[1] * t, n[2] * t]));
    }
    return { shapes: [compoundOf(ctx.oc, ctx.scope, plates)], tags: ["floorplate"] };
  },

  box(ctx, p) {
    const { oc, scope } = ctx;
    const s = ctx.stroke(p.stroke);
    const bb = bbox2(s.pts);
    const w = bb.maxA - bb.minA;
    const d = bb.maxB - bb.minB;
    const h = (p.height as number) ?? Math.max(w, d) * 0.55;
    const n = normalOf(s);
    const corner = to3D({ a: bb.minA, b: bb.minB }, s.plane, s.offset);
    const far = to3D({ a: bb.maxA, b: bb.maxB }, s.plane, s.offset);
    const hi: Vec3 = [far[0] + n[0] * h, far[1] + n[1] * h, far[2] + n[2] * h];
    return {
      shapes: [
        scope
          .t(new oc.BRepPrimAPI_MakeBox_4(scope.t(pnt(oc, corner)), scope.t(pnt(oc, hi))))
          .Shape(),
      ],
    };
  },

  cylinder(ctx, p) {
    const { oc, scope } = ctx;
    const s = ctx.stroke(p.stroke);
    const fit = circleFit(s.pts);
    if (!fit || fit.r < 1e-6) throw new Error(`${s.id} is not circular enough for a cylinder`);
    const h = (p.height as number) ?? fit.r * 2.2;
    const centre = to3D({ a: fit.cx, b: fit.cy }, s.plane, s.offset);
    return {
      shapes: [
        scope
          .t(new oc.BRepPrimAPI_MakeCylinder_3(scope.t(ax2(oc, centre, normalOf(s))), fit.r, h))
          .Shape(),
      ],
    };
  },

  sphere(ctx, p) {
    const { oc, scope } = ctx;
    const s = ctx.stroke(p.stroke);
    const fit = circleFit(s.pts);
    if (!fit || fit.r < 1e-6) throw new Error(`${s.id} is not circular enough for a sphere`);
    const centre = to3D({ a: fit.cx, b: fit.cy }, s.plane, s.offset);
    return {
      shapes: [scope.t(new oc.BRepPrimAPI_MakeSphere_5(scope.t(pnt(oc, centre)), fit.r)).Shape()],
    };
  },

  boolean(ctx, p) {
    const r = boolOp(ctx.oc, ctx.scope, p.kind, ctx.shape(p.a), ctx.shape(p.b));
    return { shapes: [r], tags: ctx.tagsOf(p.a) };
  },

  fillet(ctx, p) {
    const { oc, scope } = ctx;
    const ref = p.edges as { solid: string; select: string };
    const target = ctx.shape(ref.solid);
    const picked = resolveShapes(oc, target, "edges", ref.select);
    const radius = p.radius as number;
    const shortest = Math.min(...picked.map((e) => edgeLength(oc, e)));
    if (radius >= shortest / 2) {
      throw new Error(
        `fillet radius ${radius} m is too large for the selected edges (shortest is ${shortest.toFixed(2)} m)`,
      );
    }
    const mk = scope.t(new oc.BRepFilletAPI_MakeFillet(target, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    for (const e of picked) mk.Add_2(radius, oc.TopoDS.Edge_1(e));
    mk.Build(scope.t(progress(oc)));
    if (!mk.IsDone()) throw new Error("fillet failed -- try a smaller radius");
    return { shapes: [mk.Shape()], tags: ctx.tagsOf(ref.solid) };
  },

  chamfer(ctx, p) {
    const { oc, scope } = ctx;
    const ref = p.edges as { solid: string; select: string };
    const target = ctx.shape(ref.solid);
    const picked = resolveShapes(oc, target, "edges", ref.select);
    const dist = p.distance as number;
    const mk = scope.t(new oc.BRepFilletAPI_MakeChamfer(target));
    for (const e of picked) mk.Add_2(dist, oc.TopoDS.Edge_1(e));
    mk.Build(scope.t(progress(oc)));
    if (!mk.IsDone()) throw new Error("chamfer failed -- try a smaller distance");
    return { shapes: [mk.Shape()], tags: ctx.tagsOf(ref.solid) };
  },

  shell(ctx, p) {
    const { oc, scope } = ctx;
    const ref = p.open_faces as { solid: string; select: string };
    const target = ctx.shape(p.solid);
    const open = resolveShapes(oc, ctx.shape(ref.solid), "face", ref.select);
    const mk = scope.t(new oc.BRepOffsetAPI_MakeThickSolid());
    mk.MakeThickSolidByJoin(
      target,
      scope.t(listOf(oc, scope, open.map((f) => oc.TopoDS.Face_1(f)))),
      -Math.abs(p.thickness as number),
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      scope.t(progress(oc)),
    );
    mk.Build(scope.t(progress(oc)));
    if (!mk.IsDone()) throw new Error("shell failed -- the wall may be thicker than the solid");
    return { shapes: [mk.Shape()], tags: [...ctx.tagsOf(p.solid), "shelled"] };
  },

  offset_solid(ctx, p) {
    const { oc, scope } = ctx;
    const mk = scope.t(new oc.BRepOffsetAPI_MakeOffsetShape());
    mk.PerformByJoin(
      ctx.shape(p.solid),
      p.distance as number,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      scope.t(progress(oc)),
    );
    mk.Build(scope.t(progress(oc)));
    if (!mk.IsDone()) throw new Error("offset failed -- try a smaller distance");
    return { shapes: [mk.Shape()], tags: ctx.tagsOf(p.solid) };
  },

  cut_plane(ctx, p) {
    const { oc, scope } = ctx;
    const target = ctx.shape(p.solid);
    const bb = bboxOf(oc, target);
    if (p.keep === "both") {
      const tool = halfBox(ctx, bb, p.plane, p.offset, true);
      const a = boolOp(oc, scope, "intersect", target, tool);
      const b = boolOp(oc, scope, "subtract", target, tool);
      return { shapes: [a, b], tags: ctx.tagsOf(p.solid) };
    }
    const tool = halfBox(ctx, bb, p.plane, p.offset, p.keep === "below");
    return {
      shapes: [boolOp(oc, scope, "intersect", target, tool)],
      tags: ctx.tagsOf(p.solid),
    };
  },

  split(ctx, p) {
    const { oc, scope } = ctx;
    const a = ctx.shape(p.a);
    const b = ctx.shape(p.b);
    const inside = boolOp(oc, scope, "intersect", a, b);
    const outside = boolOp(oc, scope, "subtract", a, b);
    return { shapes: [inside, outside], tags: ctx.tagsOf(p.a) };
  },

  push_pull(ctx, p) {
    const { oc, scope } = ctx;
    const ref = p.face as { solid: string; select: string };
    const target = ctx.shape(ref.solid);
    const picked = resolveShapes(oc, target, "face", ref.select);
    const face = oc.TopoDS.Face_1(picked[0]);
    const { n } = faceFrame(oc, face);
    const d = p.distance as number;
    const tool = prism(oc, scope, face, [n[0] * Math.abs(d), n[1] * Math.abs(d), n[2] * Math.abs(d)]);
    const flipped =
      d < 0
        ? prism(oc, scope, face, [-n[0] * Math.abs(d), -n[1] * Math.abs(d), -n[2] * Math.abs(d)])
        : tool;
    const out = d >= 0
      ? boolOp(oc, scope, "union", target, tool)
      : boolOp(oc, scope, "subtract", target, flipped);
    return { shapes: [out], tags: ctx.tagsOf(ref.solid) };
  },

  mirror(ctx, p) {
    const { oc, scope } = ctx;
    const n = PLANES[p.plane as PlaneKey].n;
    const o = p.offset as number;
    const t = scope.t(new oc.gp_Trsf_1());
    t.SetMirror_3(scope.t(ax2(oc, [n[0] * o, n[1] * o, n[2] * o], n)));
    return { shapes: [transformed(oc, scope, ctx.shape(p.solid), t)], tags: ctx.tagsOf(p.solid) };
  },

  array(ctx, p) {
    const src = ctx.shape(p.solid);
    const axis = p.axis as "x" | "y" | "z";
    const out: Shape[] = [];
    for (let i = 1; i < (p.count as number); i++) {
      const d = (p.spacing as number) * i;
      out.push(translateCopy(ctx, src, [axis === "x" ? d : 0, axis === "y" ? d : 0, axis === "z" ? d : 0]));
    }
    return { shapes: out, tags: ctx.tagsOf(p.solid) };
  },

  array_along(ctx, p) {
    const src = ctx.shape(p.solid);
    const rail = ctx.stroke(p.rail);
    const count = p.count as number;
    const samples = resample(rail.pts, count, rail.closed);
    const base = to3D(samples[0]!, rail.plane, rail.offset);
    const out: Shape[] = [];
    for (let i = 1; i < count; i++) {
      const q = to3D(samples[i]!, rail.plane, rail.offset);
      out.push(translateCopy(ctx, src, [q[0] - base[0], q[1] - base[1], q[2] - base[2]]));
    }
    return { shapes: out, tags: ctx.tagsOf(p.solid) };
  },

  move(ctx, p) {
    return {
      shapes: [translateCopy(ctx, ctx.shape(p.solid), [p.dx ?? 0, p.dy ?? 0, p.dz ?? 0])],
      tags: ctx.tagsOf(p.solid),
    };
  },

  rotate(ctx, p) {
    const { oc, scope } = ctx;
    const src = ctx.shape(p.solid);
    const c = centroidOf(oc, src);
    const axis = p.axis as "x" | "y" | "z";
    const dirv: Vec3 = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const t = scope.t(new oc.gp_Trsf_1());
    t.SetRotation_1(scope.t(ax1(oc, c, dirv)), ((p.angle as number) * Math.PI) / 180);
    return { shapes: [transformed(oc, scope, src, t)], tags: ctx.tagsOf(p.solid) };
  },

  scale(ctx, p) {
    const { oc, scope } = ctx;
    const src = ctx.shape(p.solid);
    const c = centroidOf(oc, src);
    const t = scope.t(new oc.gp_Trsf_1());
    t.SetScale(scope.t(pnt(oc, c)), p.factor as number);
    return { shapes: [transformed(oc, scope, src, t)], tags: ctx.tagsOf(p.solid) };
  },

  duplicate(ctx, p) {
    const { oc, scope } = ctx;
    const copy = scope.t(new oc.BRepBuilderAPI_Copy_2(ctx.shape(p.solid), true, false)).Shape();
    return { shapes: [copy], tags: ctx.tagsOf(p.solid) };
  },

  delete() {
    return { shapes: [] };
  },

  tag(ctx, p) {
    return { shapes: [], tags: [...ctx.tagsOf(p.solid), p.label as string] };
  },

  // `edit` and `remove_op` rewrite the graph rather than build geometry; the
  // graph layer handles them before evaluation ever reaches the kernel.
  edit() {
    return { shapes: [] };
  },
  remove_op() {
    return { shapes: [] };
  },
};

function applyDraft(ctx: BuildCtx, solid: Shape, base: Shape, n: Vec3, taperDeg: number): Shape {
  const { oc, scope } = ctx;
  const { p: basePoint } = faceFrame(oc, oc.TopoDS.Face_1(base));
  const mk = scope.t(new oc.BRepOffsetAPI_DraftAngle_2(solid));
  const neutral = scope.t(pln(oc, basePoint, n));
  const pull = scope.t(new oc.gp_Dir_4(n[0], n[1], n[2]));
  const angle = (taperDeg * Math.PI) / 180;
  let added = 0;
  const fs = faces(oc, solid);
  for (const f of fs) {
    const fr = faceFrame(oc, f);
    if (Math.abs(fr.n[0] * n[0] + fr.n[1] * n[1] + fr.n[2] * n[2]) > 0.2) continue; // caps
    try {
      mk.Add(f, pull, angle, neutral, true);
      added++;
    } catch {
      /* a face that cannot take draft is skipped */
    }
  }
  if (!added) return solid;
  mk.Build(scope.t(progress(oc)));
  if (!mk.IsDone()) throw new Error("taper failed -- try a smaller angle");
  return mk.Shape();
}


/** Solids that carry no volume (patch, network_surface) are still valid output. */
export function resultIsUsable(oc: OC, shape: Shape): boolean {
  return !isEmpty(oc, shape) && areaOf(oc, shape) > 1e-9;
}
