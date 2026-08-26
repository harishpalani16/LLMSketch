import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { Doc } from "../src/core/types.ts";
import type { OC } from "../src/kernel/oc.ts";
import { Evaluator } from "../src/kernel/evaluate.ts";
import { applyTurn } from "../src/llm/turn.ts";
import { serializeScene } from "../src/llm/serialize.ts";
import "../src/ops/defs/index.ts";

/**
 * SPEC §9.5 -- the acceptance test for the whole protocol.
 *
 * "Make the tower 40 m and hollow it out, 300 mm walls" must come back as
 * `edit` (height on the tower's node) + `shell`, and must actually build.
 * The network call is the only part not exercised here; everything from the
 * model's first token to the finished solid is.
 */

let oc: OC;
const strokes = fixtureStrokes();

beforeAll(async () => {
  oc = await occt();
});

function towerDoc(): Doc {
  resetNodeSeq();
  return {
    strokes,
    nodes: [
      mkNode("extrude", { stroke: "S1", height: 12, taper: 0 }, ["B1"]),
      mkNode("tag", { solid: "B1", label: "tower" }, []),
    ],
    intent: "a tower",
  };
}

describe("the §9.5 exchange", () => {
  it("edits the tower's height and hollows it out", () => {
    const doc = towerDoc();
    const ev = new Evaluator(oc);
    const before = ev.evaluate(doc.nodes, strokes);
    const solidBefore = before.solids.find((s) => s.id === "B1")!;
    expect(solidBefore.metrics.bbox[4]).toBeCloseTo(12, 1);
    expect(solidBefore.tags).toEqual(["tower"]);

    // what the model is shown
    const scene = serializeScene(doc, before.solids, "make the tower 40 m and hollow it out, 300 mm walls");
    expect(scene).toContain("N1  extrude  stroke=S1 height=12.0");
    expect(scene).toContain("B1");
    expect(scene).toContain("tags tower");

    // what the model emits
    const response = [
      '{"op":"edit","params":{"node":"N1","set":{"height":40}}}',
      '{"op":"shell","params":{"solid":"B1","open_faces":{"solid":"B1","kind":"face","select":"top"},"thickness":0.3}}',
      '{"done":true,"summary":"tower raised to 40 m and hollowed with 300 mm walls"}',
      "",
    ].join("\n");

    const turn = applyTurn(doc, response);
    expect(turn.rejected).toEqual([]);
    expect(turn.applied).toEqual(["edit", "N3"]);
    expect(turn.summary).toMatch(/40 m/);

    // and what the kernel makes of it
    const after = ev.evaluate(turn.doc.nodes, strokes);
    expect(after.nodes.every((n) => n.state === "ok")).toBe(true);
    const hollow = after.solids.find((s) => s.id === "B2")!;
    expect(hollow).toBeTruthy();
    expect(hollow.metrics.bbox[4]).toBeCloseTo(40, 1);
    expect(hollow.tags).toEqual(["tower", "shelled"]);

    // a 12x8 footprint 40 m tall, hollowed to 300 mm walls, is mostly air
    const solidVolume = 12 * 8 * 40;
    expect(hollow.metrics.volume).toBeLessThan(solidVolume * 0.2);
    expect(hollow.metrics.volume).toBeGreaterThan(solidVolume * 0.02);
    // the original solid is consumed by the shell
    expect(after.solids.some((s) => s.id === "B1")).toBe(false);
  });

  it("rejects an op that references something that does not exist, and says why", () => {
    const turn = applyTurn(
      towerDoc(),
      '{"op":"fillet","params":{"edges":{"solid":"B9","kind":"edges","select":"vertical"},"radius":0.2}}\n' +
        '{"done":true,"summary":"nope"}\n',
    );
    expect(turn.applied).toEqual([]);
    expect(turn.rejected).toHaveLength(1);
    expect(turn.rejected[0]!.reason).toMatch(/B9.*not an existing solid/);
    expect(turn.rejected[0]!.line).toContain("fillet");
  });

  it("rejects a coordinate-shaped param instead of guessing", () => {
    const turn = applyTurn(
      towerDoc(),
      '{"op":"extrude","params":{"stroke":"S1","height":6,"origin":[0,0,0]}}\n',
    );
    expect(turn.rejected[0]!.reason).toMatch(/unknown param "origin"/);
  });

  it("keeps validating against the graph as it grows within one turn", () => {
    // B2 does not exist until the loft on line one has been applied
    const turn = applyTurn(
      towerDoc(),
      '{"op":"loft","params":{"strokes":["S1","S2"]}}\n' +
        '{"op":"tag","params":{"solid":"B2","label":"skin"}}\n' +
        '{"done":true,"summary":"lofted"}\n',
    );
    expect(turn.rejected).toEqual([]);
    expect(turn.applied).toEqual(["N3", "N4"]);
  });
});
