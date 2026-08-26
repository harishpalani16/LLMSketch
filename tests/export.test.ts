import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { OC } from "../src/kernel/oc.ts";
import { Evaluator } from "../src/kernel/evaluate.ts";
import { exportShapes, importStep } from "../src/kernel/export.ts";
import { countFaces, volumeOf } from "../src/kernel/occ.ts";

/** SPEC test 13: a STEP export/import round-trip preserves solids and volume. */

let oc: OC;
let ev: Evaluator;
const strokes = fixtureStrokes();

beforeAll(async () => {
  oc = await occt();
  resetNodeSeq();
  ev = new Evaluator(oc);
  ev.evaluate(
    [
      mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"]),
      mkNode("cylinder", { stroke: "S6", height: 12 }, ["B2"]),
      mkNode("boolean", { kind: "subtract", a: "B1", b: "B2" }, ["B3"]),
    ],
    strokes,
  );
});

const items = () => [{ id: "B3", tags: ["tower"], shape: ev.shapeOf("B3")! }];

describe("STEP", () => {
  it("round-trips a boolean result with its volume intact", () => {
    const before = volumeOf(oc, items()[0]!.shape);
    expect(before).toBeGreaterThan(0);

    const file = exportShapes(oc, "step", items());
    expect(file.name).toBe("model.step");
    expect(new TextDecoder().decode(file.bytes.slice(0, 13))).toBe("ISO-10303-21;");

    const back = importStep(oc, file.bytes);
    expect(back).toHaveLength(1);
    const after = volumeOf(oc, back[0]);
    expect(Math.abs(after - before) / before).toBeLessThan(0.001);
    expect(countFaces(oc, back[0])).toBe(countFaces(oc, items()[0]!.shape));
  });
});

describe("mesh formats", () => {
  it("writes an OBJ with vertices, normals and faces", () => {
    const text = new TextDecoder().decode(exportShapes(oc, "obj", items()).bytes);
    expect(text).toContain("o B3_tower");
    expect(text.split("\n").filter((l) => l.startsWith("v ")).length).toBeGreaterThan(30);
    expect(text.split("\n").filter((l) => l.startsWith("vn ")).length).toBeGreaterThan(30);
    expect(text.split("\n").filter((l) => l.startsWith("f ")).length).toBeGreaterThan(10);
  });

  it("writes a binary STL", () => {
    const bytes = exportShapes(oc, "stl", items()).bytes;
    expect(bytes.byteLength).toBeGreaterThan(84);
  });

  it("writes a valid GLB container", () => {
    const bytes = exportShapes(oc, "glb", items()).bytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes[0].name).toBe("B3_tower");
    expect(json.accessors[0].type).toBe("VEC3");
    expect(json.accessors[0].min).toHaveLength(3);
  });

  it("refuses to export nothing", () => {
    expect(() => exportShapes(oc, "step", [])).toThrowError(/nothing to export/);
  });
});
