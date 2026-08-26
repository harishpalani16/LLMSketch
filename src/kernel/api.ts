import type { OpNode, Stroke, SubRef } from "../core/types.ts";
import type { EvalResult } from "./evaluate.ts";
import type { ExportKind } from "./export.ts";
import type { Selection } from "./selectors.ts";
import type { Vec3 } from "../core/planes.ts";
import type { ExportPayload, FaceHit, Request, Response } from "./protocol.ts";

/**
 * Main-thread facade over the kernel worker. Everything is a promise; calls
 * made before the kernel has finished loading queue rather than fail, so the
 * sketch side of the app stays fully interactive while the WASM downloads
 * (SPEC §2d).
 */

export interface KernelProgress {
  loaded: number;
  total: number;
  message: string;
  done: boolean;
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void };

export class Kernel {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void>;
  private listeners = new Set<(p: KernelProgress) => void>();

  ready = false;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (ev: MessageEvent<Response>) => this.onMessage(ev.data));
    this.worker.addEventListener("error", (ev) => {
      for (const [, p] of this.pending) p.reject(new Error(ev.message || "kernel worker crashed"));
      this.pending.clear();
    });
    this.readyPromise = this.send("init").then(() => {
      this.ready = true;
      this.emit({ loaded: 1, total: 1, message: "kernel ready", done: true });
    });
  }

  onProgress(fn: (p: KernelProgress) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  evaluate(nodes: OpNode[], strokes: Stroke[]): Promise<EvalResult> {
    return this.send("evaluate", { nodes, strokes }) as Promise<EvalResult>;
  }

  resolveSelector(ref: SubRef): Promise<Selection> {
    return this.send("resolveSelector", { ref }) as Promise<Selection>;
  }

  faceAt(solid: string, point: Vec3): Promise<FaceHit | null> {
    return this.send("faceAt", { solid, point }) as Promise<FaceHit | null>;
  }

  exportSolids(format: ExportKind, solids: { id: string; tags: string[] }[]): Promise<ExportPayload> {
    return this.send("export", { format, solids }) as Promise<ExportPayload>;
  }

  private emit(p: KernelProgress): void {
    for (const fn of this.listeners) fn(p);
  }

  private onMessage(msg: Response): void {
    if ("kind" in msg && msg.kind === "progress") {
      this.emit({ ...msg, done: false });
      return;
    }
    if (!("id" in msg)) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(msg.error));
  }

  private send(kind: Request["kind"], payload: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, kind, ...payload });
    });
  }
}

let singleton: Kernel | null = null;

export function kernel(): Kernel {
  if (!singleton) singleton = new Kernel();
  return singleton;
}
