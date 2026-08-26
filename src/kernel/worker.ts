/// <reference lib="webworker" />
import ocFullJS from "opencascade.js/dist/opencascade.full.js";
import wasmUrl from "opencascade.js/dist/opencascade.full.wasm?url";

import type { OC, Shape } from "./oc.ts";
import { Evaluator } from "./evaluate.ts";
import { exportShapes } from "./export.ts";
import { faceFrame, faces } from "./occ.ts";
import { describeFace } from "./selectors.ts";
import { basisFromNormal, type Vec3 } from "../core/planes.ts";
import type { FaceHit, Request, Response } from "./protocol.ts";

/**
 * OCCT lives here and nowhere else. The worker exists to keep the UI thread
 * alive while the kernel thinks -- Pages cannot set COOP/COEP, so the WASM is
 * single-threaded and there is no parallelism to be had (SPEC §6, §14).
 */

let oc: OC | null = null;
let evaluator: Evaluator | null = null;
let booting: Promise<void> | null = null;

const post = (m: Response, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

async function fetchWasm(): Promise<ArrayBuffer> {
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`could not load the modelling kernel (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ kind: "progress", loaded, total, message: "loading modelling kernel" });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

async function boot(): Promise<void> {
  if (oc) return;
  if (booting) return booting;
  booting = (async () => {
    const wasmBinary = await fetchWasm();
    post({ kind: "progress", loaded: 1, total: 1, message: "starting modelling kernel" });
    const Ctor = ocFullJS as unknown as new (mod: Record<string, unknown>) => Promise<OC>;
    oc = await new Ctor({ wasmBinary, locateFile: () => wasmUrl });
    evaluator = new Evaluator(oc);
  })();
  return booting;
}

function need(): { oc: OC; ev: Evaluator } {
  if (!oc || !evaluator) throw new Error("the modelling kernel is still loading");
  return { oc, ev: evaluator };
}

function faceAt(solid: string, point: Vec3): FaceHit | null {
  const { oc: k, ev } = need();
  const shape = ev.shapeOf(solid);
  if (!shape) return null;
  const list = faces(k, shape);
  let best = -1;
  let bestD = Infinity;
  const vertex = new k.BRepBuilderAPI_MakeVertex(new k.gp_Pnt_3(point[0], point[1], point[2])).Vertex();
  list.forEach((face: Shape, i: number) => {
    const dist = new k.BRepExtrema_DistShapeShape_1();
    dist.LoadS1(vertex);
    dist.LoadS2(face);
    dist.Perform(new k.Message_ProgressRange_1());
    if (dist.IsDone()) {
      const d = dist.Value();
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    dist.delete();
  });
  if (best < 0) return null;
  const face = list[best]!;
  const fr = faceFrame(k, face);
  const basis = basisFromNormal(fr.n);
  return {
    index: best + 1,
    select: describeFace(k, shape, best + 1),
    normal: fr.n,
    centroid: fr.p,
    u: basis.u,
    v: basis.v,
  };
}

function transferablesFor(value: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<ArrayBufferLike>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (ArrayBuffer.isView(v)) {
      const buf = v.buffer;
      if (!seen.has(buf)) {
        seen.add(buf);
        out.push(buf as ArrayBuffer);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const k of Object.keys(v as Record<string, unknown>)) walk((v as Record<string, unknown>)[k]);
  };
  walk(value);
  return out;
}

self.addEventListener("message", (ev: MessageEvent<Request>) => {
  const req = ev.data;
  void (async () => {
    try {
      let value: unknown;
      switch (req.kind) {
        case "init":
          await boot();
          value = { ok: true };
          break;
        case "evaluate": {
          await boot();
          const { ev: e } = need();
          value = e.evaluate(req.nodes, req.strokes);
          break;
        }
        case "resolveSelector": {
          const { ev: e } = need();
          value = e.resolve(req.ref);
          break;
        }
        case "faceAt":
          value = faceAt(req.solid, req.point);
          break;
        case "export": {
          const { oc: k, ev: e } = need();
          const items = req.solids
            .map((s) => ({ id: s.id, tags: s.tags, shape: e.shapeOf(s.id) }))
            .filter((s): s is { id: string; tags: string[]; shape: Shape } => Boolean(s.shape));
          value = exportShapes(k, req.format, items);
          break;
        }
      }
      post({ id: req.id, ok: true, value }, transferablesFor(value));
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
