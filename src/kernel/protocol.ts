import type { OpNode, Stroke, SubRef } from "../core/types.ts";
import type { EvalResult } from "./evaluate.ts";
import type { ExportKind } from "./export.ts";
import type { Selection } from "./selectors.ts";
import type { Vec3 } from "../core/planes.ts";

/** Worker message protocol (SPEC §6). Every call is promise-wrapped in api.ts. */

export type Request =
  | { id: number; kind: "init" }
  | { id: number; kind: "evaluate"; nodes: OpNode[]; strokes: Stroke[] }
  | { id: number; kind: "resolveSelector"; ref: SubRef }
  | { id: number; kind: "faceAt"; solid: string; point: Vec3 }
  | { id: number; kind: "export"; format: ExportKind; solids: { id: string; tags: string[] }[] };

export interface FaceHit {
  index: number;
  /** best semantic selector for the face, else `index i` */
  select: string;
  normal: Vec3;
  centroid: Vec3;
  /** in-plane basis for drawing on this face (SPEC §5.6) */
  u: Vec3;
  v: Vec3;
}

export interface ExportPayload {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export type ResultFor = {
  init: { ok: true };
  evaluate: EvalResult;
  resolveSelector: Selection;
  faceAt: FaceHit | null;
  export: ExportPayload;
};

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { kind: "progress"; loaded: number; total: number; message: string };
