import type { OC, Shape } from "./oc.ts";
import { Scope } from "./oc.ts";
import type { OpNode, SolidMetrics, Stroke, SubRef, Tess } from "../core/types.ts";
import { BUILDERS, type BuildCtx } from "./build.ts";
import { tessellate } from "./tess.ts";
import { bboxOf, centroidOf, countEdges, countFaces, volumeOf } from "./occ.ts";
import { resolveSelector, type Selection } from "./selectors.ts";
import { consumedSolids } from "../ops/effects.ts";

/**
 * SPEC §6 -- topological evaluation with memoisation.
 *
 * Nodes are stored in dependency order (a node may only reference ids produced
 * before it), so evaluation walks the list against a mutable environment of
 * live solids. The chain hash of node i covers everything up to and including
 * it; when it matches the previous run, the whole environment after that node
 * is reused and the kernel is not touched. Editing node 5 of 10 therefore
 * re-runs 5 nodes, not 10.
 */

export interface SolidPayload {
  id: string;
  node: string;
  /** null means "unchanged since the last evaluation, reuse what you have" */
  tess: Tess | null;
  tags: string[];
  metrics: SolidMetrics;
}

export interface NodeReport {
  id: string;
  state: "ok" | "error";
  error?: string;
  outputs: string[];
}

export interface EvalResult {
  nodes: NodeReport[];
  solids: SolidPayload[];
  /** how many nodes actually reached the kernel; tests assert on this */
  kernelCalls: number;
}

interface LiveSolid {
  shape: Shape;
  tags: string[];
  node: string;
}

type Env = Map<string, LiveSolid>;

interface Frame {
  hash: string;
  env: Env;
  report: NodeReport;
}

function hashOf(...parts: unknown[]): string {
  const str = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("");
  // FNV-1a, 64 bits across two lanes: cheap and collision-safe enough for a cache
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5811;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export class Evaluator {
  private frames: Frame[] = [];
  private strokeHash = "";
  private last: Env = new Map();
  /** shape last tessellated and sent per solid id, so unchanged solids are not re-meshed */
  private sent = new Map<string, Shape>();

  constructor(private oc: OC) {}

  /** Live solids from the most recent evaluation, for selectors and export. */
  shapeOf(id: string): Shape | undefined {
    return this.last.get(id)?.shape;
  }

  liveIds(): string[] {
    return [...this.last.keys()];
  }

  resolve(ref: SubRef): Selection {
    const shape = this.shapeOf(ref.solid);
    if (!shape) throw new Error(`${ref.solid} is not in the model`);
    return resolveSelector(this.oc, shape, ref.kind, ref.select);
  }

  evaluate(nodes: OpNode[], strokes: Stroke[]): EvalResult {
    const byId = new Map(strokes.map((s) => [s.id, s]));
    const sHash = hashOf(strokes.map((s) => [s.id, s.plane, s.offset, s.closed, s.pts]));
    if (sHash !== this.strokeHash) {
      this.frames = [];
      this.strokeHash = sHash;
    }

    let kernelCalls = 0;
    let env: Env = new Map();
    let prevHash = "root";
    const reports: NodeReport[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const hash = hashOf(prevHash, node.op, node.params, node.outputs);
      const cached = this.frames[i];
      if (cached && cached.hash === hash) {
        env = cached.env;
        reports.push(cached.report);
        prevHash = hash;
        continue;
      }

      // this node and everything after it must be rebuilt
      this.frames.length = i;
      env = new Map(env);
      const report = this.runNode(node, env, byId);
      kernelCalls++;
      reports.push(report);
      this.frames[i] = { hash, env, report };
      prevHash = hash;
    }
    this.frames.length = nodes.length;
    this.last = env;

    const solids: SolidPayload[] = [];
    for (const [id, live] of env) {
      const unchanged = this.sent.get(id) === live.shape;
      if (!unchanged) this.sent.set(id, live.shape);
      solids.push({
        id,
        node: live.node,
        tags: live.tags,
        tess: unchanged ? null : tessellate(this.oc, live.shape),
        metrics: this.metrics(live.shape),
      });
    }
    for (const id of [...this.sent.keys()]) if (!env.has(id)) this.sent.delete(id);
    return { nodes: reports, solids, kernelCalls };
  }

  private metrics(shape: Shape): SolidMetrics {
    return {
      bbox: bboxOf(this.oc, shape),
      centroid: centroidOf(this.oc, shape),
      volume: volumeOf(this.oc, shape),
      faces: countFaces(this.oc, shape),
      edges: countEdges(this.oc, shape),
    };
  }

  private runNode(node: OpNode, env: Env, strokes: Map<string, Stroke>): NodeReport {
    const builder = BUILDERS[node.op];
    if (!builder) {
      return { id: node.id, state: "error", error: `no builder for op "${node.op}"`, outputs: [] };
    }
    const scope = new Scope();
    const ctx: BuildCtx = {
      oc: this.oc,
      scope,
      stroke: (id) => {
        const s = strokes.get(id);
        if (!s) throw new Error(`stroke ${id} no longer exists`);
        return s;
      },
      shape: (id) => {
        const live = env.get(id);
        if (!live) throw new Error(`${id} is not in the model any more`);
        return live.shape;
      },
      tagsOf: (id) => env.get(id)?.tags ?? [],
    };

    try {
      const out = builder(ctx, node.params as Record<string, unknown>);

      // `tag` writes labels back onto its target rather than making a solid
      if (node.op === "tag") {
        const target = env.get(node.params.solid as string);
        if (target) target.tags = out.tags ?? target.tags;
        return { id: node.id, state: "ok", outputs: [] };
      }

      for (const id of consumedSolids(node.op, node.params)) env.delete(id);

      const ids: string[] = [];
      out.shapes.forEach((shape, i) => {
        const id = node.outputs[i] ?? `${node.id}#${i}`;
        env.set(id, { shape, tags: out.tags ? [...out.tags] : [], node: node.id });
        ids.push(id);
      });
      return { id: node.id, state: "ok", outputs: ids };
    } catch (err) {
      return {
        id: node.id,
        state: "error",
        error: err instanceof Error ? err.message : String(err),
        outputs: [],
      };
    } finally {
      scope.free();
    }
  }
}
