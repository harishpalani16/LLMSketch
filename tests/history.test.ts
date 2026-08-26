import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { OC } from "../src/kernel/oc.ts";
import { Evaluator } from "../src/kernel/evaluate.ts";
import type { Doc, OpNode } from "../src/core/types.ts";
import { applyOp, liveSolids, validationScene } from "../src/graph/model.ts";
import "../src/ops/defs/index.ts";
import { validateOp } from "../src/ops/registry.ts";

/** SPEC test 12: memoisation, `edit` propagation, and graph-versioned undo. */

let oc: OC;
const strokes = fixtureStrokes();

beforeAll(async () => {
  oc = await occt();
});

function chain(): OpNode[] {
  resetNodeSeq();
  return [
    mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"]),
    mkNode("cylinder", { stroke: "S6", height: 12 }, ["B2"]),
    mkNode("boolean", { kind: "subtract", a: "B1", b: "B2" }, ["B3"]),
    mkNode("fillet", { edges: { solid: "B3", kind: "edges", select: "vertical" }, radius: 0.4 }, ["B4"]),
  ];
}

describe("memoisation", () => {
  it("does not re-evaluate an unchanged graph", () => {
    const ev = new Evaluator(oc);
    const nodes = chain();
    expect(ev.evaluate(nodes, strokes).kernelCalls).toBe(4);
    expect(ev.evaluate(nodes, strokes).kernelCalls).toBe(0);
  });

  it("re-evaluates only from the edited node onwards", () => {
    const ev = new Evaluator(oc);
    const nodes = chain();
    ev.evaluate(nodes, strokes);
    // change the third node: nodes 1-2 are untouched, 3-4 rebuild
    const edited = nodes.map((n) =>
      n.id === "N3" ? { ...n, params: { ...n.params, kind: "union" } } : n,
    );
    expect(ev.evaluate(edited, strokes).kernelCalls).toBe(2);
  });

  it("re-evaluates everything when a stroke moves", () => {
    const ev = new Evaluator(oc);
    const nodes = chain();
    ev.evaluate(nodes, strokes);
    const moved = strokes.map((s) =>
      s.id === "S1" ? { ...s, pts: s.pts.map((p) => ({ a: p.a * 1.1, b: p.b })) } : s,
    );
    expect(ev.evaluate(nodes, moved).kernelCalls).toBe(4);
  });
});

describe("edit propagation (SPEC §9.5)", () => {
  it("changing an upstream height re-evaluates the boolean and the fillet", () => {
    const ev = new Evaluator(oc);
    let doc: Doc = { strokes, nodes: chain(), intent: "" };
    const before = ev.evaluate(doc.nodes, strokes);
    const b4 = before.solids.find((s) => s.id === "B4")!;
    expect(before.nodes.every((n) => n.state === "ok")).toBe(true);
    expect(b4.metrics.bbox[4]).toBeCloseTo(6, 1);

    const scene = validationScene(doc);
    const check = validateOp({ op: "edit", params: { node: "N1", set: { height: 40 } } }, scene);
    expect(check.errors).toEqual([]);
    doc = applyOp(doc, "edit", check.params);

    const after = ev.evaluate(doc.nodes, strokes);
    expect(after.nodes.every((n) => n.state === "ok")).toBe(true);
    const grown = after.solids.find((s) => s.id === "B4")!;
    expect(grown.metrics.bbox[4]).toBeCloseTo(40, 1);
    expect(grown.metrics.volume).toBeGreaterThan(b4.metrics.volume * 5);
  });

  it("rejects an edit whose value is out of the target op's range", () => {
    const doc: Doc = { strokes, nodes: chain(), intent: "" };
    const bad = validateOp(
      { op: "edit", params: { node: "N4", set: { radius: -3 } } },
      validationScene(doc),
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/radius/);
  });
});

describe("broken selectors stall honestly (SPEC §7)", () => {
  it("puts the node in error and leaves the app alive", () => {
    const ev = new Evaluator(oc);
    const nodes = [
      mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B9"]),
      mkNode("fillet", { edges: { solid: "B9", kind: "edges", select: "longest 40" }, radius: 90 }, [
        "B10",
      ]),
    ];
    const out = ev.evaluate(nodes, strokes);
    expect(out.nodes[0]!.state).toBe("ok");
    expect(out.nodes[1]!.state).toBe("error");
    expect(out.nodes[1]!.error).toMatch(/too large/);
    // the upstream solid survives, so the user can fix the radius and carry on
    expect(out.solids.some((s) => s.id === "B9")).toBe(true);
  });

  it("reports a selector that matched nothing, with the selector quoted", () => {
    const ev = new Evaluator(oc);
    const nodes = [
      mkNode("cylinder", { stroke: "S6", height: 8 }, ["B11"]),
      mkNode("shell", {
        solid: "B11",
        open_faces: { solid: "B11", kind: "face", select: "facing +x 4" },
        thickness: 0.3,
      }, ["B12"]),
    ];
    const out = ev.evaluate(nodes, strokes);
    expect(out.nodes[1]!.state).toBe("error");
    expect(out.nodes[1]!.error).toMatch(/'facing \+x 4' matched no faces/);
  });
});

describe("graph bookkeeping", () => {
  it("liveSolids matches what the kernel actually holds", () => {
    const ev = new Evaluator(oc);
    const nodes = chain();
    const out = ev.evaluate(nodes, strokes);
    const kernelIds = out.solids.map((s) => s.id).sort();
    const graphIds = liveSolids(nodes).map((s) => s.id).sort();
    expect(graphIds).toEqual(kernelIds);
  });

  it("re-allocates outputs when an edit changes an array's count", () => {
    let doc: Doc = {
      strokes,
      nodes: [mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"])],
      intent: "",
    };
    doc = applyOp(doc, "array", { solid: "B1", count: 3, axis: "x", spacing: 14 });
    expect(doc.nodes[1]!.outputs).toHaveLength(2);
    doc = applyOp(doc, "edit", { node: doc.nodes[1]!.id, set: { count: 5 } });
    expect(doc.nodes[1]!.outputs).toHaveLength(4);
    const out = new Evaluator(oc).evaluate(doc.nodes, strokes);
    expect(out.solids).toHaveLength(5);
  });

  it("remove_op deletes a node and the rest re-evaluates", () => {
    let doc: Doc = { strokes, nodes: chain(), intent: "" };
    doc = applyOp(doc, "remove_op", { node: "N4" });
    expect(doc.nodes.map((n) => n.id)).toEqual(["N1", "N2", "N3"]);
    const out = new Evaluator(oc).evaluate(doc.nodes, strokes);
    expect(out.nodes.every((n) => n.state === "ok")).toBe(true);
    expect(out.solids.map((s) => s.id)).toEqual(["B3"]);
  });
});
