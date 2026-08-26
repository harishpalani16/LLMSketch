import type { OC, Scope, Shape } from "./oc.ts";
import type { Vec3 } from "../core/planes.ts";

/* -------------------------------------------------------------------------- */
/* tiny constructors                                                          */
/* -------------------------------------------------------------------------- */

export const pnt = (oc: OC, p: Vec3) => new oc.gp_Pnt_3(p[0], p[1], p[2]);
export const dir = (oc: OC, d: Vec3) => new oc.gp_Dir_4(d[0], d[1], d[2]);
export const vec = (oc: OC, v: Vec3) => new oc.gp_Vec_4(v[0], v[1], v[2]);
export const progress = (oc: OC) => new oc.Message_ProgressRange_1();

export function ax1(oc: OC, origin: Vec3, d: Vec3) {
  return new oc.gp_Ax1_2(pnt(oc, origin), dir(oc, d));
}

export function ax2(oc: OC, origin: Vec3, n: Vec3) {
  return new oc.gp_Ax2_3(pnt(oc, origin), dir(oc, n));
}

export function pln(oc: OC, origin: Vec3, n: Vec3) {
  return new oc.gp_Pln_3(pnt(oc, origin), dir(oc, n));
}

/* -------------------------------------------------------------------------- */
/* topology traversal                                                          */
/* -------------------------------------------------------------------------- */

export type ShapeKind = "FACE" | "EDGE" | "WIRE" | "VERTEX" | "SOLID" | "SHELL" | "COMPOUND";

const enumFor = (oc: OC, k: ShapeKind) => oc.TopAbs_ShapeEnum[`TopAbs_${k}`];

/**
 * Sub-shapes of `kind` in stable, de-duplicated topological order.
 * TopExp::MapShapes is used rather than a raw explorer so the ordering is
 * deterministic -- that is what makes `index i` selectors meaningful at all
 * (SPEC §7).
 */
export function explore(oc: OC, shape: Shape, kind: ShapeKind): Shape[] {
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, enumFor(oc, kind), map);
  const out: Shape[] = [];
  for (let i = 1; i <= map.Size(); i++) out.push(map.FindKey(i));
  map.delete();
  return out;
}

export function faces(oc: OC, shape: Shape): Shape[] {
  return explore(oc, shape, "FACE").map((f) => oc.TopoDS.Face_1(f));
}

export function edges(oc: OC, shape: Shape): Shape[] {
  return explore(oc, shape, "EDGE").map((e) => oc.TopoDS.Edge_1(e));
}

export function countFaces(oc: OC, shape: Shape): number {
  return explore(oc, shape, "FACE").length;
}

export function countEdges(oc: OC, shape: Shape): number {
  return explore(oc, shape, "EDGE").length;
}

export function isEmpty(oc: OC, shape: Shape): boolean {
  if (!shape || shape.IsNull()) return true;
  return explore(oc, shape, "FACE").length === 0;
}

/* -------------------------------------------------------------------------- */
/* measurement                                                                 */
/* -------------------------------------------------------------------------- */

export function volumeOf(oc: OC, shape: Shape): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
  const v = props.Mass();
  props.delete();
  return Math.abs(v);
}

export function areaOf(oc: OC, shape: Shape): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(shape, props, false, false);
  const v = props.Mass();
  props.delete();
  return Math.abs(v);
}

export function edgeLength(oc: OC, edge: Shape): number {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.LinearProperties(edge, props, false, false);
  const v = props.Mass();
  props.delete();
  return Math.abs(v);
}

export function centroidOf(oc: OC, shape: Shape): Vec3 {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
  let c = props.CentreOfMass();
  if (props.Mass() < 1e-12) {
    props.delete();
    const sp = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(shape, sp, false, false);
    c = sp.CentreOfMass();
    const r: Vec3 = [c.X(), c.Y(), c.Z()];
    sp.delete();
    return r;
  }
  const r: Vec3 = [c.X(), c.Y(), c.Z()];
  props.delete();
  return r;
}

/** [xmin, ymin, zmin, xmax, ymax, zmax] */
export function bboxOf(oc: OC, shape: Shape): number[] {
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, box, true);
  if (box.IsVoid()) {
    box.delete();
    return [0, 0, 0, 0, 0, 0];
  }
  const lo = box.CornerMin();
  const hi = box.CornerMax();
  const r = [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()].map((n) => (n === 0 ? 0 : n));
  box.delete();
  return r;
}

export function bboxDiagonal(bb: number[]): number {
  return Math.hypot(bb[3]! - bb[0]!, bb[4]! - bb[1]!, bb[5]! - bb[2]!);
}

/** Outward normal + centroid of a face, honouring its orientation. */
export function faceFrame(oc: OC, face: Shape): { p: Vec3; n: Vec3; area: number } {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
  const area = props.Mass();
  const com = props.CentreOfMass();
  const p: Vec3 = [com.X(), com.Y(), com.Z()];
  props.delete();

  const gf = new oc.BRepGProp_Face_2(face, false);
  const uv = uvMid(oc, face);
  const at = new oc.gp_Pnt_1();
  const nv = new oc.gp_Vec_1();
  gf.Normal(uv[0], uv[1], at, nv);
  let n: Vec3 = [nv.X(), nv.Y(), nv.Z()];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / l, n[1] / l, n[2] / l];
  // BRepGProp_Face::Normal already accounts for face orientation (it is what
  // OCCT's own volume integration relies on), so no manual flip here.
  gf.delete();
  at.delete();
  nv.delete();
  return { p, n, area: Math.abs(area) };
}

function uvMid(oc: OC, face: Shape): [number, number] {
  const s = new oc.BRepAdaptor_Surface_2(face, true);
  const u = (s.FirstUParameter() + s.LastUParameter()) / 2;
  const v = (s.FirstVParameter() + s.LastVParameter()) / 2;
  s.delete();
  return [Number.isFinite(u) ? u : 0, Number.isFinite(v) ? v : 0];
}

/** Direction of an edge measured end-to-end (null for a closed edge). */
export function edgeDirection(oc: OC, edge: Shape): Vec3 | null {
  const c = new oc.BRepAdaptor_Curve_2(edge);
  const a = c.Value(c.FirstParameter());
  const b = c.Value(c.LastParameter());
  const d: Vec3 = [b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()];
  c.delete();
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-9) return null;
  return [d[0] / l, d[1] / l, d[2] / l];
}

export function edgeMidpoint(oc: OC, edge: Shape): Vec3 {
  const c = new oc.BRepAdaptor_Curve_2(edge);
  const p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
  const r: Vec3 = [p.X(), p.Y(), p.Z()];
  c.delete();
  return r;
}

/** Polyline for display / highlighting, deflection-adaptive. */
export function edgePolyline(oc: OC, edge: Shape, deflection: number): number[] {
  const out: number[] = [];
  const c = new oc.BRepAdaptor_Curve_2(edge);
  try {
    const d = new oc.GCPnts_QuasiUniformDeflection_2(c, deflection, oc.GeomAbs_Shape.GeomAbs_C1);
    if (d.IsDone() && d.NbPoints() >= 2) {
      for (let i = 1; i <= d.NbPoints(); i++) {
        const p = d.Value(i);
        out.push(p.X(), p.Y(), p.Z());
      }
    }
    d.delete();
  } catch {
    /* fall through to the sampled path below */
  }
  if (out.length < 6) {
    const u0 = c.FirstParameter();
    const u1 = c.LastParameter();
    for (let i = 0; i <= 12; i++) {
      const p = c.Value(u0 + ((u1 - u0) * i) / 12);
      out.push(p.X(), p.Y(), p.Z());
    }
  }
  c.delete();
  return out;
}

/* -------------------------------------------------------------------------- */
/* construction helpers                                                        */
/* -------------------------------------------------------------------------- */

export function wireFromPoints(oc: OC, s: Scope, pts: Vec3[], closed: boolean): Shape {
  const poly = s.t(new oc.BRepBuilderAPI_MakePolygon_1());
  for (const p of pts) poly.Add_1(s.t(pnt(oc, p)));
  if (closed) poly.Close();
  if (!poly.IsDone()) throw new Error("could not build a wire from that stroke");
  return poly.Wire();
}

export function faceFromWire(oc: OC, s: Scope, wire: Shape): Shape {
  const mf = s.t(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  if (!mf.IsDone()) throw new Error("that outline is not planar enough to make a face");
  return mf.Face();
}

export function prism(oc: OC, s: Scope, base: Shape, v: Vec3): Shape {
  const mk = s.t(new oc.BRepPrimAPI_MakePrism_1(base, s.t(vec(oc, v)), false, true));
  mk.Build(s.t(progress(oc)));
  if (!mk.IsDone()) throw new Error("extrusion failed");
  return mk.Shape();
}

export function transformed(oc: OC, s: Scope, shape: Shape, trsf: Shape): Shape {
  const t = s.t(new oc.BRepBuilderAPI_Transform_2(shape, trsf, true));
  if (!t.IsDone()) throw new Error("transform failed");
  return t.Shape();
}

export function listOf(oc: OC, s: Scope, shapes: Shape[]): Shape {
  const l = s.t(new oc.TopTools_ListOfShape_1());
  for (const sh of shapes) l.Append_1(sh);
  return l;
}

export function compoundOf(oc: OC, s: Scope, shapes: Shape[]): Shape {
  const builder = s.t(new oc.BRep_Builder());
  const comp = new oc.TopoDS_Compound();
  builder.MakeCompound(comp);
  for (const sh of shapes) builder.Add(comp, sh);
  return comp;
}

export function boolOp(
  oc: OC,
  s: Scope,
  kind: "union" | "subtract" | "intersect",
  a: Shape,
  b: Shape,
): Shape {
  const range = s.t(progress(oc));
  const op = s.t(
    kind === "union"
      ? new oc.BRepAlgoAPI_Fuse_3(a, b, range)
      : kind === "subtract"
        ? new oc.BRepAlgoAPI_Cut_3(a, b, range)
        : new oc.BRepAlgoAPI_Common_3(a, b, range),
  );
  op.Build(s.t(progress(oc)));
  if (!op.IsDone()) throw new Error(`${kind} failed -- the two solids may not overlap cleanly`);
  const r = op.Shape();
  if (isEmpty(oc, r)) throw new Error(`${kind} produced nothing`);
  return r;
}

/** Fuse a list down to one shape; returns a compound if fusing fails. */
export function fuseAll(oc: OC, s: Scope, shapes: Shape[]): Shape {
  if (shapes.length === 0) throw new Error("nothing to fuse");
  if (shapes.length === 1) return shapes[0]!;
  let acc = shapes[0]!;
  for (let i = 1; i < shapes.length; i++) {
    try {
      acc = boolOp(oc, s, "union", acc, shapes[i]!);
    } catch {
      return compoundOf(oc, s, shapes);
    }
  }
  return acc;
}
