import type { Doc, Solid, Stroke } from "../core/types.ts";
import { liveSolids } from "../graph/model.ts";
import { opDef } from "../ops/registry.ts";

/** The serializer needs measurements, not meshes. */
export type SolidFacts = Pick<Solid, "id" | "tags" | "metrics">;

/**
 * SPEC §9.3 -- the scene as compact text tables. The model never sees raw
 * coordinates it could copy; it sees ids, shapes, sizes and history, which is
 * exactly what it needs to emit operations.
 */

const r1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
const v3 = (v: number[]): string => `(${r1(v[0] ?? 0)},${r1(v[1] ?? 0)},${r1(v[2] ?? 0)})`;

function strokeRow(s: Stroke): string {
  const size = `${r1(s.metrics.w)}x${r1(s.metrics.h)}`;
  const measure = s.closed ? `area ${r1(s.metrics.area)}` : `len ${r1(s.metrics.len)}`;
  const bits = [
    s.id,
    s.closed ? `closed ${s.kind}` : `open ${s.kind}`,
    `${s.plane}@${r1(s.offset)}`,
    `#${s.order + 1}`,
    size,
    measure,
    v3(s.metrics.centroid),
  ];
  if (s.onFace) bits.push(`on ${s.onFace.solid}:${s.onFace.select}`);
  if (s.note) bits.push(`"${s.note}"`);
  return bits.join("  ");
}

function paramSummary(op: string, params: Record<string, unknown>): string {
  const def = opDef(op);
  const order = def ? def.params.map((p) => p.name) : Object.keys(params);
  const parts: string[] = [];
  for (const name of order) {
    const v = params[name];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") parts.push(`${name}=${r1(v)}`);
    else if (typeof v === "string" || typeof v === "boolean") parts.push(`${name}=${v}`);
    else if (Array.isArray(v)) parts.push(`${name}=[${v.join(",")}]`);
    else if (typeof v === "object" && "select" in (v as object)) {
      const r = v as { solid: string; kind: string; select: string };
      parts.push(`${name}=${r.solid}.${r.kind}:${r.select}`);
    } else parts.push(`${name}=${JSON.stringify(v)}`);
  }
  return parts.join(" ");
}

export function serializeScene(doc: Doc, solids: SolidFacts[], userSays: string): string {
  const out: string[] = [];

  out.push("STROKES");
  if (!doc.strokes.length) out.push("  (none)");
  for (const s of [...doc.strokes].sort((a, b) => a.order - b.order)) out.push("  " + strokeRow(s));

  out.push("");
  out.push("SOLIDS");
  const live = liveSolids(doc.nodes);
  if (!live.length) out.push("  (none)");
  for (const l of live) {
    const solid = solids.find((s) => s.id === l.id);
    const node = doc.nodes.find((n) => n.id === l.node);
    const from = node ? `${node.id} ${node.op}` : l.node;
    const bits = [l.id, from];
    if (solid) {
      const b = solid.metrics.bbox;
      bits.push(`bbox ${v3(b.slice(0, 3))}..${v3(b.slice(3, 6))}`);
      bits.push(`vol ${r1(solid.metrics.volume)}`);
      bits.push(`faces ${solid.metrics.faces}`);
    }
    if (l.tags.length) bits.push(`tags ${l.tags.join(",")}`);
    out.push("  " + bits.join("  "));
  }

  out.push("");
  out.push("HISTORY");
  if (!doc.nodes.length) out.push("  (none)");
  for (const n of doc.nodes) {
    out.push(`  ${n.id}  ${n.op}  ${paramSummary(n.op, n.params)}  -> ${n.outputs.join(",") || "-"}`);
  }

  const broken = doc.nodes.filter((n) => n.state === "error");
  if (broken.length) {
    out.push("");
    out.push("ERRORS");
    for (const n of broken) out.push(`  ${n.id}  ${n.op}  ${n.error ?? "failed"}`);
  }

  out.push("");
  out.push("USER SAYS");
  out.push("  " + (userSays.trim() || "(nothing yet -- read the sketch)"));

  return out.join("\n");
}
