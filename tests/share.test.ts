import { beforeAll, describe, expect, it } from "vitest";
import { occt } from "./occt.ts";
import { fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { Doc } from "../src/core/types.ts";
import type { OC } from "../src/kernel/oc.ts";
import { Evaluator } from "../src/kernel/evaluate.ts";
import { deserializeDoc, docFromJson, docToJson, serializeDoc } from "../src/graph/serialize.ts";
import { decodeDoc, encodeDoc, WARN_BYTES } from "../src/share/urlhash.ts";
import "../src/ops/defs/index.ts";

/** SPEC §12: the document is strokes + graph, and a link is that document. */

let oc: OC;
beforeAll(async () => {
  oc = await occt();
});

function doc(): Doc {
  resetNodeSeq();
  return {
    strokes: fixtureStrokes(),
    nodes: [
      mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"]),
      mkNode("cylinder", { stroke: "S6", height: 12 }, ["B2"]),
      mkNode("boolean", { kind: "subtract", a: "B1", b: "B2" }, ["B3"]),
      mkNode("tag", { solid: "B3", label: "block" }, []),
    ],
    intent: "a block with a hole",
  };
}

describe("document format", () => {
  it("round-trips strokes, nodes and intent", () => {
    const original = doc();
    const back = docFromJson(docToJson(original));
    expect(back.intent).toBe(original.intent);
    expect(back.nodes).toEqual(original.nodes.map((n) => ({ ...n, state: "ok" })));
    expect(back.strokes.map((s) => s.id)).toEqual(original.strokes.map((s) => s.id));
    for (const [i, s] of back.strokes.entries()) {
      const src = original.strokes[i]!;
      expect(s.plane).toBe(src.plane);
      expect(s.closed).toBe(src.closed);
      expect(s.kind).toBe(src.kind);
      expect(s.pts).toHaveLength(src.pts.length);
      expect(s.metrics.area).toBeCloseTo(src.metrics.area, 2);
    }
  });

  it("carries proposed nodes too, so a mid-proposal link shows what the sender sees", () => {
    const d = doc();
    d.nodes[3]!.ghost = true;
    expect(serializeDoc(d).n).toHaveLength(4);
  });

  it("rejects a payload that is not a model", () => {
    expect(() => deserializeDoc({ hello: "world" })).toThrowError(/does not contain a model/);
  });
});

describe("url hash", () => {
  it("deflates and inflates the whole document", () => {
    const original = doc();
    const payload = encodeDoc(original);
    expect(payload).not.toMatch(/[+/=]/);
    const back = decodeDoc(payload);
    expect(back.intent).toBe(original.intent);
    expect(back.nodes).toHaveLength(original.nodes.length);
  });

  it("keeps a real sketch well under the 8 KB warning", () => {
    expect(encodeDoc(doc()).length).toBeLessThan(WARN_BYTES);
  });
});

describe("sharing a model as a program", () => {
  it("the receiver's re-evaluation matches the sender's geometry", () => {
    const original = doc();
    const sender = new Evaluator(oc).evaluate(original.nodes, original.strokes);

    const received = decodeDoc(encodeDoc(original));
    const receiver = new Evaluator(oc).evaluate(received.nodes, received.strokes);

    expect(receiver.solids.map((s) => s.id)).toEqual(sender.solids.map((s) => s.id));
    for (const [i, solid] of receiver.solids.entries()) {
      const mine = sender.solids[i]!;
      // stroke coordinates are stored to 0.1 mm, so volumes agree to ~0.01%
      expect(Math.abs(solid.metrics.volume - mine.metrics.volume) / mine.metrics.volume)
        .toBeLessThan(0.001);
      expect(solid.metrics.faces).toBe(mine.metrics.faces);
      expect(solid.tags).toEqual(mine.tags);
    }
  });
});
