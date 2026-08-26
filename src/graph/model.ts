import type { Doc, OpNode, Stroke } from "../core/types.ts";
import { consumedSolids } from "../ops/effects.ts";
import { expectedOutputCount } from "../ops/outputs.ts";
import { emptyScene, opDef, type ValidationScene } from "../ops/registry.ts";

/**
 * The history graph is the document (SPEC §1.6). Geometry is always a
 * re-evaluation; nothing here touches the kernel. These functions are pure so
 * undo/redo can simply keep document versions.
 */

export interface LiveSolid {
  id: string;
  node: string;
  tags: string[];
}

/**
 * Which solids exist after running `nodes`, in creation order. Mirrors the
 * kernel's environment exactly -- both read consumedSolids().
 */
export function liveSolids(nodes: OpNode[]): LiveSolid[] {
  const env = new Map<string, LiveSolid>();
  for (const node of nodes) {
    if (node.op === "tag") {
      const target = env.get(node.params.solid as string);
      const label = node.params.label as string;
      if (target && label && !target.tags.includes(label)) target.tags.push(label);
      continue;
    }
    const carried = carriedTags(node, env);
    for (const id of consumedSolids(node.op, node.params)) env.delete(id);
    for (const id of node.outputs) env.set(id, { id, node: node.id, tags: [...carried] });
  }
  return [...env.values()];
}

function carriedTags(node: OpNode, env: Map<string, LiveSolid>): string[] {
  const source =
    (node.params.solid as string) ??
    (node.params.a as string) ??
    (node.params.edges as { solid?: string } | undefined)?.solid ??
    (node.params.face as { solid?: string } | undefined)?.solid;
  const inherited = source ? (env.get(source)?.tags ?? []) : [];
  const own =
    node.op === "slab" ? ["slab"] : node.op === "wall" ? ["wall"] : node.op === "stack" ? ["floorplate"] : [];
  const extra = node.op === "shell" ? ["shelled"] : [];
  return [...new Set([...inherited, ...own, ...extra])];
}

export function nextStrokeId(strokes: Stroke[]): string {
  let max = 0;
  for (const s of strokes) {
    const n = Number.parseInt(s.id.slice(1), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `S${max + 1}`;
}

export function nextNodeId(nodes: OpNode[]): string {
  let max = 0;
  for (const n of nodes) {
    const v = Number.parseInt(n.id.slice(1), 10);
    if (Number.isFinite(v)) max = Math.max(max, v);
  }
  return `N${max + 1}`;
}

/** Solid ids are never reused; the counter runs over every id the graph ever made. */
export function nextSolidNumber(nodes: OpNode[]): number {
  let max = 0;
  for (const n of nodes) {
    for (const o of n.outputs) {
      const v = Number.parseInt(o.slice(1), 10);
      if (o.startsWith("B") && Number.isFinite(v)) max = Math.max(max, v);
    }
  }
  return max + 1;
}

export function makeNode(nodes: OpNode[], op: string, params: Record<string, unknown>): OpNode {
  const count = expectedOutputCount(op, params);
  let next = nextSolidNumber(nodes);
  const outputs = Array.from({ length: count }, () => `B${next++}`);
  return { id: nextNodeId(nodes), op, params, outputs, state: "ok" };
}

/** Re-allocate outputs when an edit changes how many solids a node makes. */
export function reconcileOutputs(nodes: OpNode[], node: OpNode): OpNode {
  const want = expectedOutputCount(node.op, node.params);
  if (node.outputs.length === want) return node;
  if (want < node.outputs.length) return { ...node, outputs: node.outputs.slice(0, want) };
  let next = nextSolidNumber(nodes);
  const outputs = [...node.outputs];
  while (outputs.length < want) outputs.push(`B${next++}`);
  return { ...node, outputs };
}

export function validationScene(doc: Doc): ValidationScene {
  const scene = emptyScene();
  for (const s of doc.strokes) {
    scene.strokeIds.add(s.id);
    if (s.closed) scene.closedStrokes.add(s.id);
  }
  for (const s of liveSolids(doc.nodes)) scene.solidIds.add(s.id);
  for (const n of doc.nodes) {
    scene.nodeIds.add(n.id);
    scene.nodeOps.set(n.id, n.op);
  }
  return scene;
}

/**
 * Apply an op to a document. `edit` and `remove_op` rewrite the graph in place
 * rather than appending -- that is what makes them the history superpower
 * (SPEC §8.1).
 */
export function applyOp(doc: Doc, op: string, params: Record<string, unknown>): Doc {
  if (op === "edit") {
    const target = doc.nodes.find((n) => n.id === params.node);
    if (!target) return doc;
    const set = (params.set ?? {}) as Record<string, unknown>;
    const nodes = doc.nodes.map((n) =>
      n.id === target.id
        ? reconcileOutputs(doc.nodes, { ...n, params: { ...n.params, ...set }, state: "ok", error: undefined })
        : n,
    );
    return { ...doc, nodes };
  }
  if (op === "remove_op") {
    return { ...doc, nodes: doc.nodes.filter((n) => n.id !== params.node) };
  }
  return { ...doc, nodes: [...doc.nodes, makeNode(doc.nodes, op, params)] };
}

export function describeNode(node: OpNode): string {
  const def = opDef(node.op);
  const shown = (def?.params ?? [])
    .map((p) => {
      const v = node.params[p.name];
      if (v === undefined) return null;
      if (typeof v === "number") return `${p.name} ${round(v)}`;
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.join("+");
      if (v && typeof v === "object" && "select" in v) {
        return `${(v as { solid: string }).solid}:${(v as { select: string }).select}`;
      }
      return null;
    })
    .filter(Boolean)
    .join(" ");
  return `${node.op} ${shown}`.trim();
}

export const round = (n: number): number => Math.round(n * 10) / 10;
