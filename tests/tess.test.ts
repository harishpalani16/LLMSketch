import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import type { OC } from "../src/kernel/oc.ts";
import { tessellate } from "../src/kernel/tess.ts";

let oc: OC;
beforeAll(async () => { oc = await occt(); });

describe("tessellation", () => {
  it("meshes a box into triangles and edge lines", () => {
    const b = new oc.BRepPrimAPI_MakeBox_2(2, 3, 4).Shape();
    const t = tessellate(oc, b);
    expect(t.positions.length).toBe(12 * 9);
    expect(t.normals.length).toBe(t.positions.length);
    expect(t.edges.length).toBeGreaterThanOrEqual(12 * 6);
    for (let i = 0; i < t.normals.length; i += 3) {
      expect(Math.hypot(t.normals[i]!, t.normals[i + 1]!, t.normals[i + 2]!)).toBeCloseTo(1, 4);
    }
  });

  it("meshes a cylinder with smooth side normals", () => {
    const c = new oc.BRepPrimAPI_MakeCylinder_1(1, 2).Shape();
    const t = tessellate(oc, c);
    expect(t.positions.length).toBeGreaterThan(300);
    expect(t.edges.length).toBeGreaterThan(0);
  });
});
