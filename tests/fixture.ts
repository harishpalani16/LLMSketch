import type { OpNode, PlaneKey, Pt2, Stroke, StrokeKind } from "../src/core/types.ts";
import { strokeMetrics } from "../src/sketch/geom.ts";

let order = 0;

export function mkStroke(
  id: string,
  plane: PlaneKey,
  offset: number,
  pts: [number, number][],
  closed: boolean,
  kind: StrokeKind = "freehand",
): Stroke {
  const p: Pt2[] = pts.map(([a, b]) => ({ a, b }));
  return {
    id,
    plane,
    offset,
    pts: p,
    closed,
    kind,
    order: order++,
    metrics: strokeMetrics(p, closed, plane, offset),
  };
}

const rect = (w: number, h: number): [number, number][] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

const circle = (cx: number, cy: number, r: number, n = 32): [number, number][] =>
  new Array(n).fill(0).map((_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number];
  });

const arc = (cx: number, cy: number, r: number, from: number, to: number, n = 16): [number, number][] =>
  new Array(n).fill(0).map((_, i) => {
    const t = from + ((to - from) * i) / (n - 1);
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number];
  });

/**
 * The scene every registry example is validated and built against (SPEC §8,
 * tests 6-9). Ids match the ids used in the op def examples.
 */
export function fixtureStrokes(): Stroke[] {
  order = 0;
  return [
    mkStroke("S1", "ground", 0, rect(12, 8), true, "rect"),
    mkStroke("S2", "ground", 10, rect(8, 6), true, "rect"),
    mkStroke("S3", "front", 0, [[-8, 0], [-8, 9]], false, "line"),
    mkStroke("S4", "ground", 0, [[-10, 0], [-3, 2], [4, -1], [10, 3]], false, "freehand"),
    mkStroke("S5", "front", 0, circle(0, 4, 1.5), true, "circle"),
    mkStroke("S6", "ground", 0, circle(0, 0, 3), true, "circle"),
    mkStroke("S7", "front", 0, rect(6, 4), true, "rect"),
    mkStroke("S8", "front", -6, arc(0, 0, 7, Math.PI, Math.PI * 1.9), false),
    mkStroke("S9", "front", 6, arc(0, 0, 7, Math.PI, Math.PI * 1.9), false),
    mkStroke("S10", "side", -7, arc(0, 0, 6, Math.PI, Math.PI * 1.9), false),
    mkStroke("S11", "side", 7, arc(0, 0, 6, Math.PI, Math.PI * 1.9), false),
  ];
}

let nodeSeq = 0;

export function mkNode(op: string, params: Record<string, unknown>, outputs: string[]): OpNode {
  return { id: `N${++nodeSeq}`, op, params, outputs, state: "ok" };
}

export function resetNodeSeq(): void {
  nodeSeq = 0;
}

/** B1 = a 12x8x6 block, B2 = an r3 cylinder through it. Enough for every modify op. */
export function fixtureNodes(): OpNode[] {
  resetNodeSeq();
  return [
    mkNode("extrude", { stroke: "S1", height: 6, taper: 0 }, ["B1"]),
    mkNode("cylinder", { stroke: "S6", height: 8 }, ["B2"]),
  ];
}
