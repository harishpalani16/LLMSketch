import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { fixtureNodes, fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { OC } from "../src/kernel/oc.ts";
import { Evaluator } from "../src/kernel/evaluate.ts";
import "../src/ops/defs/index.ts";
import { catalog, emptyScene, validateOp, promptCatalog } from "../src/ops/registry.ts";
import { BUILDERS } from "../src/kernel/build.ts";
import { expectedOutputCount } from "../src/ops/outputs.ts";

let oc: OC;
beforeAll(async () => {
  oc = await occt();
});

const strokes = fixtureStrokes();

function sceneForExamples() {
  const scene = emptyScene();
  for (const s of strokes) {
    scene.strokeIds.add(s.id);
    if (s.closed) scene.closedStrokes.add(s.id);
  }
  scene.solidIds.add("B1");
  scene.solidIds.add("B2");
  scene.nodeIds.add("N1");
  scene.nodeIds.add("N2");
  scene.nodeOps.set("N1", "extrude");
  scene.nodeOps.set("N2", "cylinder");
  return scene;
}

describe("registry (SPEC tests 6-9)", () => {
  it("every op appears in promptCatalog()", () => {
    const text = promptCatalog();
    for (const def of catalog()) expect(text).toContain(`${def.name}(`);
  });

  it("the prompt catalogue stays inside its token budget", () => {
    // ~4 chars per token is the usual rule of thumb; budget is ~3,000 tokens.
    expect(promptCatalog().length).toBeLessThan(3000 * 4);
  });

  it("every op has a builder and every builder has an op", () => {
    const names = new Set(catalog().map((d) => d.name));
    for (const name of names) expect(BUILDERS[name], `builder for ${name}`).toBeTypeOf("function");
    for (const name of Object.keys(BUILDERS)) expect(names.has(name), `def for ${name}`).toBe(true);
  });

  it("every def example passes validation against the fixture scene", () => {
    const scene = sceneForExamples();
    for (const def of catalog()) {
      for (const ex of def.examples) {
        const r = validateOp({ op: def.name, params: ex.params }, scene);
        expect(r.errors, `${def.name}: ${r.errors.join("; ")}`).toEqual([]);
      }
    }
  });

  it("every geometry example builds non-empty geometry through the kernel", () => {
    const scene = sceneForExamples();
    for (const def of catalog()) {
      if (def.produces === "none") continue;
      for (const ex of def.examples) {
        resetNodeSeq();
        const nodes = fixtureNodes();
        const { params } = validateOp({ op: def.name, params: ex.params }, scene);
        const n = expectedOutputCount(def.name, params);
        nodes.push(mkNode(def.name, params, Array.from({ length: n }, (_, i) => `X${i + 1}`)));
        const ev = new Evaluator(oc);
        const out = ev.evaluate(nodes, strokes);
        const report = out.nodes[out.nodes.length - 1]!;
        expect(report.state, `${def.name}: ${report.error ?? ""}`).toBe("ok");
        expect(report.outputs.length, `${def.name} produced no solid`).toBeGreaterThan(0);
        for (const id of report.outputs) {
          const solid = out.solids.find((s) => s.id === id)!;
          expect(solid, `${def.name} ${id} missing`).toBeTruthy();
          expect(solid.tess!.positions.length, `${def.name} ${id} has no triangles`).toBeGreaterThan(0);
        }
      }
    }
  });
});
