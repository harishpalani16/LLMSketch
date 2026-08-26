import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import type { OC } from "../src/kernel/oc.ts";
import { describeFace, resolveSelector, resolveShapes, SelectorError } from "../src/kernel/selectors.ts";
import { edgeLength, faceFrame, faces } from "../src/kernel/occ.ts";

/** SPEC test 11: the selector engine on a fixture box and cylinder. */

let oc: OC;
let box: any;
let cylinder: any;

beforeAll(async () => {
  oc = await occt();
  // 12 wide (x), 6 tall (y), 8 deep (z) -- world is Y-up
  box = new oc.BRepPrimAPI_MakeBox_2(12, 6, 8).Shape();
  cylinder = new oc.BRepPrimAPI_MakeCylinder_3(
    new oc.gp_Ax2_3(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(0, 1, 0)),
    3,
    10,
  ).Shape();
});

describe("face selectors", () => {
  it("top and bottom pick the horizontal caps", () => {
    const top = resolveShapes(oc, box, "face", "top");
    expect(top).toHaveLength(1);
    expect(faceFrame(oc, top[0]).p[1]).toBeCloseTo(6, 6);
    expect(faceFrame(oc, top[0]).n[1]).toBeGreaterThan(0.99);

    const bottom = resolveShapes(oc, box, "face", "bottom");
    expect(faceFrame(oc, bottom[0]).p[1]).toBeCloseTo(0, 6);
  });

  it("largest picks the biggest face", () => {
    const largest = resolveShapes(oc, box, "face", "largest");
    expect(faceFrame(oc, largest[0]).area).toBeCloseTo(12 * 8, 6);
  });

  it("facing +x picks one wall, and honours a tolerance", () => {
    const f = resolveShapes(oc, box, "face", "facing +x");
    expect(f).toHaveLength(1);
    expect(faceFrame(oc, f[0]).p[0]).toBeCloseTo(12, 6);
    // a wide tolerance sweeps in the perpendicular faces too
    expect(resolveShapes(oc, box, "face", "facing +x 95").length).toBe(5);
  });

  it("vertical picks the four walls, horizontal the two caps", () => {
    expect(resolveShapes(oc, box, "face", "vertical")).toHaveLength(4);
    expect(resolveShapes(oc, box, "face", "horizontal")).toHaveLength(2);
  });

  it("all returns every face", () => {
    expect(resolveShapes(oc, box, "face", "all")).toHaveLength(faces(oc, box).length);
  });
});

describe("edge selectors", () => {
  it("vertical picks the four upright edges", () => {
    expect(resolveShapes(oc, box, "edges", "vertical")).toHaveLength(4);
  });

  it("top-cap picks the four edges at the top", () => {
    const top = resolveShapes(oc, box, "edges", "top-cap");
    expect(top).toHaveLength(4);
    const total = top.reduce((n, e) => n + edgeLength(oc, e), 0);
    expect(total).toBeCloseTo(2 * (12 + 8), 5);
  });

  it("of face top picks that face's own edges", () => {
    const edges = resolveShapes(oc, box, "edges", "of face top");
    expect(edges).toHaveLength(4);
  });

  it("longest N sorts by length", () => {
    const longest = resolveShapes(oc, box, "edges", "longest 4");
    expect(longest).toHaveLength(4);
    for (const e of longest) expect(edgeLength(oc, e)).toBeCloseTo(12, 5);
  });

  it("works on a cylinder's top cap", () => {
    const top = resolveShapes(oc, cylinder, "edges", "top-cap");
    expect(top.length).toBeGreaterThan(0);
    expect(resolveShapes(oc, cylinder, "face", "top")).toHaveLength(1);
  });
});

describe("failure is honest", () => {
  it("an empty resolution throws a readable SelectorError", () => {
    // a cylinder standing on +y has no faces pointing along +x
    expect(() => resolveShapes(oc, cylinder, "face", "facing +x 5")).toThrowError(SelectorError);
    try {
      resolveShapes(oc, cylinder, "face", "facing +x 5");
    } catch (err) {
      expect((err as Error).message).toMatch(/matched no faces/);
    }
  });

  it("nonsense selectors are rejected, not guessed at", () => {
    expect(() => resolveShapes(oc, box, "face", "topmost")).toThrowError(/not a face selector/);
  });
});

describe("selector highlighting and naming", () => {
  it("resolveSelector returns indices and display polylines", () => {
    const sel = resolveSelector(oc, box, "edges", "vertical");
    expect(sel.indices).toHaveLength(4);
    expect(sel.polylines).toHaveLength(4);
    expect(sel.polylines[0]!.length).toBeGreaterThanOrEqual(6);
  });

  it("describeFace prefers a semantic name over an index", () => {
    const all = faces(oc, box);
    const topIndex = all.findIndex((f) => faceFrame(oc, f).n[1]! > 0.99) + 1;
    expect(describeFace(oc, box, topIndex)).toBe("top");
  });
});
