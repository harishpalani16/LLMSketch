import type { Doc, OpNode, PlaneKey, Stroke, StrokeKind, SubRef } from "../core/types.ts";
import { strokeMetrics } from "../sketch/geom.ts";

/**
 * The document format (SPEC §12): strokes + history graph + intent. Metrics are
 * derived, so they are recomputed on load rather than stored. Coordinates go to
 * 3 decimals -- a tenth of a millimetre, well past sketch precision, and it
 * roughly halves the URL.
 */

const VERSION = 2;

interface WireStroke {
  i: string;
  p: PlaneKey;
  o: number;
  k: StrokeKind;
  c: 0 | 1;
  d: number[];
  r?: number[];
  n?: string;
  f?: SubRef;
  t?: 0 | 1;
}

interface WireNode {
  i: string;
  o: string;
  p: Record<string, unknown>;
  b: string[];
}

interface WireDoc {
  v: number;
  s: WireStroke[];
  n: WireNode[];
  t?: string;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export function serializeDoc(doc: Doc): WireDoc {
  return {
    v: VERSION,
    s: doc.strokes.map((s) => {
      const w: WireStroke = {
        i: s.id,
        p: s.plane,
        o: r3(s.offset),
        k: s.kind,
        c: s.closed ? 1 : 0,
        d: s.pts.flatMap((q) => [r3(q.a), r3(q.b)]),
      };
      if (s.raw && s.raw !== s.pts) w.r = s.raw.flatMap((q) => [r3(q.a), r3(q.b)]);
      if (s.note) w.n = s.note;
      if (s.onFace) w.f = s.onFace;
      if (s.fitted === false) w.t = 0;
      return w;
    }),
    // Proposed (ghost) nodes are part of the history too: sharing mid-proposal
    // should show the receiver exactly what the sender is looking at. Discarding
    // a proposal removes its node, so nothing unwanted can survive.
    n: doc.nodes.map((n) => ({ i: n.id, o: n.op, p: n.params, b: n.outputs })),
    ...(doc.intent ? { t: doc.intent } : {}),
  };
}

function unpack(d: number[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (let i = 0; i + 1 < d.length; i += 2) out.push({ a: d[i]!, b: d[i + 1]! });
  return out;
}

export function deserializeDoc(raw: unknown): Doc {
  const w = raw as WireDoc;
  if (!w || typeof w !== "object" || !Array.isArray(w.s) || !Array.isArray(w.n)) {
    throw new Error("that link does not contain a model");
  }
  const strokes: Stroke[] = w.s.map((s, index) => {
    const pts = unpack(s.d);
    const closed = s.c === 1;
    return {
      id: s.i,
      plane: s.p,
      offset: s.o,
      pts,
      closed,
      kind: s.k,
      order: index,
      note: s.n,
      onFace: s.f,
      raw: s.r ? unpack(s.r) : undefined,
      fitted: s.t === 0 ? false : undefined,
      metrics: strokeMetrics(pts, closed, s.p, s.o),
    };
  });
  const nodes: OpNode[] = w.n.map((n) => ({
    id: n.i,
    op: n.o,
    params: n.p,
    outputs: n.b ?? [],
    state: "ok",
  }));
  return { strokes, nodes, intent: w.t ?? "" };
}

export function docToJson(doc: Doc): string {
  return JSON.stringify(serializeDoc(doc));
}

export function docFromJson(text: string): Doc {
  return deserializeDoc(JSON.parse(text));
}
