import type { Doc, PlaneKey, Pt2, Stroke, StrokeKind } from "../core/types.ts";
import { strokeMetrics } from "../sketch/geom.ts";

/**
 * The scene the app opens with (SPEC §15 P0): a tapering tower over a
 * courtyard wall, plus a round stair core. It reads well through the
 * heuristic interpreter, so a first-time visitor with no API key can press
 * Interpret and immediately get solids.
 */

let order = 0;

function stroke(
  id: string,
  plane: PlaneKey,
  offset: number,
  pts: [number, number][],
  closed: boolean,
  kind: StrokeKind,
  note?: string,
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
    note,
    metrics: strokeMetrics(p, closed, plane, offset),
  };
}

const rect = (cx: number, cy: number, w: number, h: number): [number, number][] => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

const circle = (cx: number, cy: number, r: number, n = 32): [number, number][] =>
  new Array(n).fill(0).map((_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number];
  });

export function exampleDoc(): Doc {
  order = 0;
  return {
    strokes: [
      stroke("S1", "ground", 0, rect(0, 0, 14, 10), true, "rect", "tower footprint"),
      stroke("S2", "ground", 24, rect(1, 0, 9, 7), true, "rect", "tower crown"),
      stroke("S3", "ground", 0, circle(-13, 6, 3), true, "circle", "stair core"),
      stroke(
        "S4",
        "ground",
        0,
        [
          [-18, -9],
          [10, -9],
          [16, -4],
          [16, 4],
        ],
        false,
        "freehand",
        "courtyard wall",
      ),
    ],
    nodes: [],
    intent: "a tower over a courtyard, with a round stair core",
  };
}
