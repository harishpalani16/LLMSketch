/** Shared document types. SPEC §4. */

export type PlaneKey = "ground" | "front" | "side";

export type StrokeKind =
  | "freehand"
  | "line"
  | "rect"
  | "circle"
  | "ellipse"
  | "arc"
  | "polygon";

export interface Pt2 {
  a: number;
  b: number;
  /** pressure 0..1, if the pointer reported any */
  w?: number;
}

export interface StrokeMetrics {
  w: number;
  h: number;
  len: number;
  area: number;
  centroid: [number, number, number];
}

export interface Stroke {
  id: string;
  plane: PlaneKey;
  offset: number;
  pts: Pt2[];
  closed: boolean;
  kind: StrokeKind;
  order: number;
  onFace?: SubRef;
  note?: string;
  metrics: StrokeMetrics;
  /** points as captured, kept when beautify replaced `pts` */
  raw?: Pt2[];
  /** false = show/serialize `raw` instead of the fitted ideal */
  fitted?: boolean;
}

export interface OpNode {
  id: string;
  op: string;
  params: Record<string, unknown>;
  outputs: string[];
  state: "ok" | "error";
  error?: string;
  /** ghost nodes came from an LLM turn and are not yet accepted */
  ghost?: boolean;
}

export interface SolidMetrics {
  bbox: number[];
  centroid: number[];
  volume: number;
  faces: number;
  edges: number;
}

export interface Tess {
  positions: Float32Array;
  normals: Float32Array;
  edges: Float32Array;
}

export interface Solid {
  id: string;
  node: string;
  tess: Tess;
  tags: string[];
  metrics: SolidMetrics;
}

export type SubRef = {
  solid: string;
  kind: "face" | "edges";
  select: string;
};

/** Document = strokes + history graph (+ intent). SPEC §12. */
export interface Doc {
  strokes: Stroke[];
  nodes: OpNode[];
  intent: string;
}
