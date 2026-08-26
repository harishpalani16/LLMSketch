import { describe, expect, it } from "vitest";
import { NdjsonParser, parseAll, parseLine } from "../src/llm/ndjson.ts";
import { serializeScene } from "../src/llm/serialize.ts";
import { systemPrompt } from "../src/llm/prompt.ts";
import { fixtureStrokes, mkNode, resetNodeSeq } from "./fixture.ts";
import type { Doc, Solid } from "../src/core/types.ts";
import "../src/ops/defs/index.ts";
import { interpret } from "../src/interpret/heuristics.ts";
import { validationScene } from "../src/graph/model.ts";
import { validateOp } from "../src/ops/registry.ts";

/** SPEC tests 14 and 15. */

describe("14. NDJSON parser", () => {
  it("handles a clean stream", () => {
    const lines = parseAll(
      '{"op":"extrude","params":{"stroke":"S1","height":6}}\n' +
        '{"op":"tag","params":{"solid":"B1","label":"tower"}}\n' +
        '{"done":true,"summary":"one tower"}\n',
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ kind: "op", value: { op: "extrude" } });
    expect(lines[2]).toMatchObject({ kind: "done", value: { summary: "one tower" } });
  });

  it("reassembles ops split across chunks", () => {
    const p = new NdjsonParser();
    expect(p.push('{"op":"extr')).toEqual([]);
    expect(p.push('ude","params":{"stroke":"S1","height":')).toEqual([]);
    const out = p.push("6}}\n");
    expect(out).toHaveLength(1);
    expect((out[0] as { value: { params: Record<string, unknown> } }).value.params).toEqual({
      stroke: "S1",
      height: 6,
    });
  });

  it("flushes a final line with no trailing newline", () => {
    const p = new NdjsonParser();
    expect(p.push('{"done":true,"summary":"done"}')).toEqual([]);
    expect(p.end()).toHaveLength(1);
  });

  it("skips prose, blank lines and broken JSON", () => {
    const lines = parseAll(
      "Sure! Here are the operations:\n" +
        "\n" +
        '{"op":"extrude","params":{"stroke":"S1","height":6}}\n' +
        "{ this is not json }\n" +
        "  \n" +
        '{"done":true,"summary":"ok"}\n',
    );
    expect(lines).toHaveLength(2);
  });

  it("strips markdown fences", () => {
    expect(parseLine('```json {"op":"patch","params":{"stroke":"S1"}}')).toMatchObject({
      kind: "op",
      value: { op: "patch" },
    });
    expect(parseLine("```")).toBeNull();
  });

  it("keeps the raw line so rejections can be quoted back", () => {
    const line = parseLine('{"op":"nope","params":{}}');
    expect(line).toMatchObject({ kind: "op", value: { raw: '{"op":"nope","params":{}}' } });
  });
});

function fixtureDoc(): { doc: Doc; solids: Solid[] } {
  resetNodeSeq();
  const doc: Doc = {
    strokes: fixtureStrokes().slice(0, 4),
    nodes: [
      mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"]),
      mkNode("wall", { stroke: "S4", height: 3.2, thickness: 0.25 }, ["B2"]),
      mkNode("tag", { solid: "B1", label: "tower" }, []),
    ],
    intent: "a tower and a wall",
  };
  doc.nodes[1]!.state = "error";
  doc.nodes[1]!.error = "'top-cap' matched no edges after N1 changed";
  const solids: Solid[] = [
    {
      id: "B1",
      node: "N1",
      tags: ["tower"],
      tess: { positions: new Float32Array(), normals: new Float32Array(), edges: new Float32Array() },
      metrics: { bbox: [-6, 0, -4, 6, 6, 4], centroid: [0, 3, 0], volume: 576, faces: 6, edges: 12 },
    },
  ];
  return { doc, solids };
}

describe("15. scene serializer", () => {
  it("renders every section the protocol promises", () => {
    const { doc, solids } = fixtureDoc();
    const text = serializeScene(doc, solids, "make it 40 m and hollow it out");
    expect(text).toMatchInlineSnapshot(`
      "STROKES
        S1  closed rect  ground@0.0  #1  12.0x8.0  area 96.0  (0.0,0.0,0.0)
        S2  closed rect  ground@10.0  #2  8.0x6.0  area 48.0  (0.0,10.0,0.0)
        S3  open line  front@0.0  #3  0.0x9.0  len 9.0  (-8.0,4.5,0.0)
        S4  open freehand  ground@0.0  #4  20.0x4.0  len 22.1  (0.3,0.0,-1.0)

      SOLIDS
        B1  N1 extrude  bbox (-6.0,0.0,-4.0)..(6.0,6.0,4.0)  vol 576.0  faces 6  tags tower
        B2  N2 wall  tags wall

      HISTORY
        N1  extrude  stroke=S1 height=6.0 taper=0.0  -> B1
        N2  wall  stroke=S4 height=3.2 thickness=0.3  -> B2
        N3  tag  solid=B1 label=tower  -> -

      ERRORS
        N2  wall  'top-cap' matched no edges after N1 changed

      USER SAYS
        make it 40 m and hollow it out"
    `);
  });

  it("says so plainly when the scene is empty", () => {
    const text = serializeScene({ strokes: [], nodes: [], intent: "" }, [], "");
    expect(text).toContain("STROKES\n  (none)");
    expect(text).toContain("SOLIDS\n  (none)");
    expect(text).toContain("(nothing yet -- read the sketch)");
  });
});

describe("system prompt", () => {
  it("carries the hard rules, the catalogue and the selector grammar", () => {
    const p = systemPrompt();
    expect(p).toContain("Never emit coordinates");
    expect(p).toContain("extrude(");
    expect(p).toContain("of face <selector>");
    expect(p).toContain('{"done":true,"summary"');
    expect(p.length).toBeLessThan(3600 * 4);
  });
});

describe("heuristic interpreter emits valid ops", () => {
  it("every rule output passes the same validator the model's output does", () => {
    const doc: Doc = { strokes: fixtureStrokes(), nodes: [], intent: "" };
    const ops = interpret(doc);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const r = validateOp({ op: op.op, params: op.params }, validationScene(doc));
      expect(r.errors, `${op.op}: ${r.errors.join("; ")}`).toEqual([]);
    }
  });

  it("never emits selectors or edit (SPEC §10)", () => {
    const doc: Doc = { strokes: fixtureStrokes(), nodes: [], intent: "" };
    for (const op of interpret(doc)) {
      expect(["edit", "remove_op", "fillet", "chamfer", "shell", "push_pull"]).not.toContain(op.op);
      expect(JSON.stringify(op.params)).not.toContain("select");
    }
  });
});
