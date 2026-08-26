import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { withScope, type OC } from "../src/kernel/oc.ts";
import {
  bboxOf,
  boolOp,
  centroidOf,
  countEdges,
  countFaces,
  edgeDirection,
  edgeLength,
  edgePolyline,
  faceFrame,
  faces,
  edges as edgesOf,
  volumeOf,
} from "../src/kernel/occ.ts";

let oc: OC;
const box = (dx: number, dy: number, dz: number, at: [number, number, number] = [0, 0, 0]) =>
  new oc.BRepPrimAPI_MakeBox_3(new oc.gp_Pnt_3(at[0], at[1], at[2]), dx, dy, dz).Shape();

beforeAll(async () => {
  oc = await occt();
});

describe("occ utilities", () => {
  it("measures a unit cube", () => {
    const b = box(1, 1, 1);
    expect(volumeOf(oc, b)).toBeCloseTo(1, 9);
    expect(countFaces(oc, b)).toBe(6);
    expect(countEdges(oc, b)).toBe(12);
    const c = centroidOf(oc, b);
    expect(c[0]).toBeCloseTo(0.5, 9);
    expect(c[2]).toBeCloseTo(0.5, 9);
    const bb = bboxOf(oc, b);
    [0, 0, 0, 1, 1, 1].forEach((want, i) => expect(bb[i]).toBeCloseTo(want, 5));
  });

  it("gives outward face normals", () => {
    const b = box(2, 3, 4);
    const fs = faces(oc, b);
    expect(fs).toHaveLength(6);
    const frames = fs.map((f) => faceFrame(oc, f));
    const top = frames.find((f) => f.n[2]! > 0.99);
    expect(top).toBeTruthy();
    expect(top!.p[2]).toBeCloseTo(4, 6);
    expect(top!.area).toBeCloseTo(6, 6);
    const bottom = frames.find((f) => f.n[2]! < -0.99);
    expect(bottom!.p[2]).toBeCloseTo(0, 6);
  });

  it("describes edges", () => {
    const b = box(2, 3, 4);
    const es = edgesOf(oc, b);
    expect(es).toHaveLength(12);
    const lens = es.map((e) => edgeLength(oc, e)).sort((a, z) => a - z);
    expect(lens[0]).toBeCloseTo(2, 6);
    expect(lens[11]).toBeCloseTo(4, 6);
    const vertical = es.filter((e) => Math.abs(edgeDirection(oc, e)![2]!) > 0.99);
    expect(vertical).toHaveLength(4);
    expect(edgePolyline(oc, es[0]!, 0.01).length).toBeGreaterThanOrEqual(6);
  });

  it("does exact booleans (SPEC test 10)", () => {
    withScope((s) => {
      const a = box(1, 1, 1);
      const b = box(1, 1, 1, [0.5, 0.5, 0.5]);
      expect(volumeOf(oc, boolOp(oc, s, "union", a, b))).toBeCloseTo(2 - 0.125, 6);
      expect(volumeOf(oc, boolOp(oc, s, "subtract", a, b))).toBeCloseTo(1 - 0.125, 6);
      expect(volumeOf(oc, boolOp(oc, s, "intersect", a, b))).toBeCloseTo(0.125, 6);
    });
  });

  it("surfaces a failed boolean as an error, not a crash (SPEC test 10)", () => {
    withScope((s) => {
      const a = box(1, 1, 1);
      const b = box(1, 1, 1, [50, 50, 50]);
      expect(() => boolOp(oc, s, "intersect", a, b)).toThrowError(/produced nothing|failed/i);
    });
  });
});
