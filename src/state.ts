import type { Doc, OpNode, PlaneKey, Solid, Stroke } from "./core/types.ts";
import type { NodeReport } from "./kernel/evaluate.ts";
import { kernel, type KernelProgress } from "./kernel/api.ts";
import { applyOp, nextStrokeId } from "./graph/model.ts";
import { recomputeMetrics } from "./sketch/geom.ts";

export type ViewKey = "iso" | "top" | "front" | "side";
export type Tool = "orbit" | "draw" | "line" | "rect" | "circle" | "select" | "erase" | "pushpull";

export interface ViewState {
  camera: ViewKey;
  plane: PlaneKey;
  workplaneMode: "axis" | "view" | "face";
  offset: number;
  tool: Tool;
  snap: boolean;
  showSheet: boolean;
  showStrokes: boolean;
}

export interface Session {
  /** typed by the user, held for this session only -- never persisted (SPEC §1.2) */
  apiKey: string;
  model: string;
  messages: { role: "user" | "assistant"; content: string }[];
  status: string;
  busy: boolean;
}

export interface Selection {
  strokes: string[];
  solids: string[];
  node: string | null;
}

export interface AppState {
  doc: Doc;
  solids: Solid[];
  reports: NodeReport[];
  selection: Selection;
  view: ViewState;
  session: Session;
  kernel: KernelProgress;
  /** nodes proposed by the current LLM turn, shown as cyan ghosts */
  ghosts: string[];
  error: string | null;
}

export const MODEL_DEFAULT = "claude-sonnet-5";

function initialState(): AppState {
  return {
    doc: { strokes: [], nodes: [], intent: "" },
    solids: [],
    reports: [],
    selection: { strokes: [], solids: [], node: null },
    view: {
      camera: "iso",
      plane: "ground",
      workplaneMode: "axis",
      offset: 0,
      tool: "draw",
      snap: true,
      showSheet: true,
      showStrokes: true,
    },
    session: { apiKey: "", model: MODEL_DEFAULT, messages: [], status: "", busy: false },
    kernel: { loaded: 0, total: 0, message: "waiting for the modelling kernel", done: false },
    ghosts: [],
    error: null,
  };
}

/** Drop selected ids that the new document no longer contains. */
function prune(selection: Selection, doc: Doc): Selection {
  const strokes = new Set(doc.strokes.map((s) => s.id));
  const nodes = new Set(doc.nodes.map((n) => n.id));
  return {
    strokes: selection.strokes.filter((id) => strokes.has(id)),
    solids: selection.solids,
    node: selection.node && nodes.has(selection.node) ? selection.node : null,
  };
}

type Listener = (s: AppState) => void;

class Store {
  private state = initialState();
  private listeners = new Set<Listener>();
  private past: Doc[] = [];
  private future: Doc[] = [];
  private pendingEval: number | null = null;
  private running: Promise<void> | null = null;
  private queued = false;
  private gestureBase: Doc | null = null;

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  patch(part: Partial<AppState>): void {
    this.state = { ...this.state, ...part };
    this.emit();
  }

  patchView(part: Partial<ViewState>): void {
    this.patch({ view: { ...this.state.view, ...part } });
  }

  patchSession(part: Partial<Session>): void {
    this.patch({ session: { ...this.state.session, ...part } });
  }

  select(part: Partial<Selection>): void {
    this.patch({ selection: { ...this.state.selection, ...part } });
  }

  /* ---------------------------------------------------------------- document */

  /**
   * Every document change goes through here, so undo/redo is graph-versioned:
   * strokes and history-graph mutations share one stack (SPEC §5.4).
   */
  commit(next: Doc, opts: { silent?: boolean } = {}): void {
    if (!opts.silent) {
      this.past.push(this.state.doc);
      if (this.past.length > 200) this.past.shift();
      this.future.length = 0;
    }
    this.state = { ...this.state, doc: next, selection: prune(this.state.selection, next) };
    this.emit();
    this.scheduleEvaluate();
  }

  addStroke(stroke: Stroke): void {
    this.commit({ ...this.state.doc, strokes: [...this.state.doc.strokes, stroke] });
  }

  updateStroke(id: string, fn: (s: Stroke) => Stroke): void {
    this.commit({
      ...this.state.doc,
      strokes: this.state.doc.strokes.map((s) => (s.id === id ? fn(s) : s)),
    });
  }

  /**
   * A pointer gesture (dragging strokes about) makes many document versions but
   * should be one undo step, so the base version is held until the pointer is
   * released.
   */
  beginGesture(): void {
    this.gestureBase = this.state.doc;
  }

  endGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (!base || base === this.state.doc) return;
    this.past.push(base);
    if (this.past.length > 200) this.past.shift();
    this.future.length = 0;
  }

  /** Move strokes within their own plane (SPEC §5.4). */
  moveStrokes(ids: string[], da: number, db: number, opts: { silent?: boolean } = {}): void {
    const set = new Set(ids);
    this.commit(
      {
        ...this.state.doc,
        strokes: this.state.doc.strokes.map((s) =>
          set.has(s.id)
            ? recomputeMetrics({ ...s, pts: s.pts.map((p) => ({ ...p, a: p.a + da, b: p.b + db })) })
            : s,
        ),
      },
      opts,
    );
  }

  /** Re-level: same outline, different height along its plane normal. */
  relevelStrokes(ids: string[], offset: number): void {
    const set = new Set(ids);
    this.commit({
      ...this.state.doc,
      strokes: this.state.doc.strokes.map((s) =>
        set.has(s.id)
          ? recomputeMetrics(
              s.frame
                ? {
                    ...s,
                    offset,
                    frame: {
                      ...s.frame,
                      origin: [
                        s.frame.origin[0] + s.frame.n[0] * (offset - s.offset),
                        s.frame.origin[1] + s.frame.n[1] * (offset - s.offset),
                        s.frame.origin[2] + s.frame.n[2] * (offset - s.offset),
                      ],
                    },
                  }
                : { ...s, offset },
            )
          : s,
      ),
    });
  }

  duplicateStrokes(ids: string[]): string[] {
    const set = new Set(ids);
    const source = this.state.doc.strokes.filter((s) => set.has(s.id));
    if (!source.length) return [];
    let strokes = [...this.state.doc.strokes];
    const made: string[] = [];
    for (const s of source) {
      const id = nextStrokeId(strokes);
      made.push(id);
      strokes = [
        ...strokes,
        recomputeMetrics({
          ...s,
          id,
          order: strokes.length,
          pts: s.pts.map((p) => ({ ...p, a: p.a + 1, b: p.b - 1 })),
        }),
      ];
    }
    this.commit({ ...this.state.doc, strokes });
    this.select({ strokes: made });
    return made;
  }

  /** Per-stroke "as drawn / as fit" toggle (SPEC §5.3). */
  toggleFit(id: string): void {
    this.updateStroke(id, (s) => (s.raw ? { ...s, fitted: s.fitted === false } : s));
  }

  removeStrokes(ids: string[]): void {
    const gone = new Set(ids);
    this.commit({
      ...this.state.doc,
      strokes: this.state.doc.strokes.filter((s) => !gone.has(s.id)),
    });
    this.select({ strokes: [] });
  }

  applyOp(op: string, params: Record<string, unknown>, opts: { ghost?: boolean } = {}): OpNode | null {
    const before = this.state.doc.nodes.length;
    const next = applyOp(this.state.doc, op, params);
    this.commit(next);
    const added = next.nodes.length > before ? next.nodes[next.nodes.length - 1]! : null;
    if (added && opts.ghost) {
      this.patch({ ghosts: [...this.state.ghosts, added.id] });
    }
    return added;
  }

  acceptGhosts(): void {
    this.patch({ ghosts: [] });
  }

  discardGhosts(): void {
    const ghosts = new Set(this.state.ghosts);
    if (!ghosts.size) return;
    this.patch({ ghosts: [] });
    this.commit({ ...this.state.doc, nodes: this.state.doc.nodes.filter((n) => !ghosts.has(n.id)) });
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.doc);
    this.state = { ...this.state, doc: prev, ghosts: [], selection: prune(this.state.selection, prev) };
    this.emit();
    this.scheduleEvaluate();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.doc);
    this.state = { ...this.state, doc: next, ghosts: [], selection: prune(this.state.selection, next) };
    this.emit();
    this.scheduleEvaluate();
  }

  /* ---------------------------------------------------------------- geometry */

  /** Redo is a re-evaluation, never a restore of stale meshes (SPEC §5.4). */
  scheduleEvaluate(): void {
    if (this.pendingEval !== null) return;
    this.pendingEval = requestAnimationFrame(() => {
      this.pendingEval = null;
      void this.evaluate();
    });
  }

  /**
   * Exactly one evaluation is ever in flight. The worker skips re-meshing a
   * solid whose shape has not changed, which only works if the main thread
   * kept the mesh it was last sent -- so a superseded request must never be
   * thrown away mid-flight. Overlapping requests coalesce into one re-run.
   */
  async evaluate(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.runEvaluation().finally(() => {
      this.running = null;
    });
    await this.running;
    if (this.queued) {
      this.queued = false;
      await this.evaluate();
    }
  }

  private async runEvaluation(): Promise<void> {
    const { doc } = this.state;
    if (!doc.nodes.length) {
      this.patch({ solids: [], reports: [] });
      return;
    }
    try {
      const result = await kernel().evaluate(doc.nodes, doc.strokes);
      const previous = new Map(this.state.solids.map((s) => [s.id, s]));
      const solids: Solid[] = [];
      for (const s of result.solids) {
        const tess = s.tess ?? previous.get(s.id)?.tess;
        if (!tess) continue;
        solids.push({ id: s.id, node: s.node, tags: s.tags, metrics: s.metrics, tess });
      }
      const nodes = this.state.doc.nodes.map((n) => {
        const r = result.nodes.find((x) => x.id === n.id);
        return r ? { ...n, state: r.state, error: r.error } : n;
      });
      this.state = {
        ...this.state,
        doc: { ...this.state.doc, nodes },
        solids,
        reports: result.nodes,
        error: null,
      };
      this.emit();
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const store = new Store();

kernel().onProgress((p) => store.patch({ kernel: p }));
