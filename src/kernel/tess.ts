import type { OC, Shape } from "./oc.ts";
import type { Tess } from "../core/types.ts";
import { bboxDiagonal, bboxOf, edgePolyline, edges, faces } from "./occ.ts";

/** SPEC §6: deflection scaled to the bbox -- 0.2% of the diagonal, angular 20°. */
export function deflectionFor(bb: number[], coarse = false): { lin: number; ang: number } {
  const diag = bboxDiagonal(bb) || 1;
  return { lin: Math.max(1e-4, diag * (coarse ? 0.008 : 0.002)), ang: (coarse ? 30 : 20) * (Math.PI / 180) };
}

export function meshShape(oc: OC, shape: Shape, coarse = false): { lin: number; ang: number } {
  const bb = bboxOf(oc, shape);
  const d = deflectionFor(bb, coarse);
  const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, d.lin, false, d.ang, false);
  mesher.delete();
  return d;
}

/**
 * Triangles + display edges as flat transferable arrays.
 * Positions and normals are non-indexed triples; edges are line-segment pairs.
 */
export function tessellate(oc: OC, shape: Shape, coarse = false): Tess {
  const d = meshShape(oc, shape, coarse);

  const pos: number[] = [];
  const nrm: number[] = [];

  for (const face of faces(oc, shape)) {
    const loc = new oc.TopLoc_Location_1();
    const handle = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (handle.IsNull()) {
      handle.delete();
      loc.delete();
      continue;
    }
    const tri = handle.get();
    const trsf = loc.Transformation();
    const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

    const nbNodes = tri.NbNodes();
    const nodes: number[] = new Array(nbNodes * 3);
    for (let i = 1; i <= nbNodes; i++) {
      const p = tri.Node(i).Transformed(trsf);
      nodes[(i - 1) * 3] = p.X();
      nodes[(i - 1) * 3 + 1] = p.Y();
      nodes[(i - 1) * 3 + 2] = p.Z();
    }

    // Smooth normals from the surface where UV nodes exist; flat otherwise.
    let vnorm: number[] | null = null;
    if (tri.HasUVNodes()) {
      try {
        const gf = new oc.BRepGProp_Face_2(face, false);
        const at = new oc.gp_Pnt_1();
        const nv = new oc.gp_Vec_1();
        vnorm = new Array(nbNodes * 3);
        for (let i = 1; i <= nbNodes; i++) {
          const uv = tri.UVNode(i);
          gf.Normal(uv.X(), uv.Y(), at, nv);
          let x = nv.X();
          let y = nv.Y();
          let z = nv.Z();
          const l = Math.hypot(x, y, z) || 1;
          x /= l;
          y /= l;
          z /= l;
          vnorm[(i - 1) * 3] = x;
          vnorm[(i - 1) * 3 + 1] = y;
          vnorm[(i - 1) * 3 + 2] = z;
        }
        gf.delete();
        at.delete();
        nv.delete();
      } catch {
        vnorm = null;
      }
    }

    const nbTri = tri.NbTriangles();
    for (let t = 1; t <= nbTri; t++) {
      const tr = tri.Triangle(t);
      let i1 = tr.Value(1);
      const i2 = tr.Value(2);
      let i3 = tr.Value(3);
      if (reversed) {
        const tmp = i1;
        i1 = i3;
        i3 = tmp;
      }
      const idx = [i1, i2, i3];
      const p: number[][] = idx.map((i) => [
        nodes[(i - 1) * 3]!,
        nodes[(i - 1) * 3 + 1]!,
        nodes[(i - 1) * 3 + 2]!,
      ]);
      let flat: number[];
      {
        const ux = p[1]![0]! - p[0]![0]!;
        const uy = p[1]![1]! - p[0]![1]!;
        const uz = p[1]![2]! - p[0]![2]!;
        const vx = p[2]![0]! - p[0]![0]!;
        const vy = p[2]![1]! - p[0]![1]!;
        const vz = p[2]![2]! - p[0]![2]!;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        flat = [nx / l, ny / l, nz / l];
      }
      for (let k = 0; k < 3; k++) {
        pos.push(p[k]![0]!, p[k]![1]!, p[k]![2]!);
        if (vnorm) {
          const i = idx[k]!;
          let nx = vnorm[(i - 1) * 3]!;
          let ny = vnorm[(i - 1) * 3 + 1]!;
          let nz = vnorm[(i - 1) * 3 + 2]!;
          // keep the smooth normal on the same side as the triangle winding
          if (nx * flat[0]! + ny * flat[1]! + nz * flat[2]! < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          nrm.push(nx, ny, nz);
        } else {
          nrm.push(flat[0]!, flat[1]!, flat[2]!);
        }
      }
    }

    handle.delete();
    loc.delete();
  }

  const lines: number[] = [];
  for (const e of edges(oc, shape)) {
    const poly = edgePolyline(oc, e, d.lin);
    for (let i = 0; i + 5 < poly.length; i += 3) {
      lines.push(poly[i]!, poly[i + 1]!, poly[i + 2]!, poly[i + 3]!, poly[i + 4]!, poly[i + 5]!);
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    edges: new Float32Array(lines),
  };
}
