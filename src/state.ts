import type { Doc, OpNode, PlaneKey, Solid, Stroke } from "./core/types.ts";
import type { NodeReport } from "./kernel/evaluate.ts";
import { kernel, type KernelProgress } from "./kernel/api.ts";
import { applyOp } from "./graph/model.ts";

export type ViewKey = "iso" | "top" | "front" | "side";
export type Tool = "draw" | "select" | "erase" | "pushpull";

export interface ViewState {
  camera: ViewKey;
  plane: PlaneKey;
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

type Listener = (s: AppState) => void;

class Store {
  private state = initialState();
  private listeners = new Set<Listener>();
  private past: Doc[] = [];
  private future: Doc[] = [];
  private evalSeq = 0;
  private pendingEval: number | null = null;

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
    this.state = { ...this.state, doc: next };
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
    this.state = { ...this.state, doc: prev, ghosts: [] };
    this.emit();
    this.scheduleEvaluate();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.doc);
    this.state = { ...this.state, doc: next, ghosts: [] };
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

  async evaluate(): Promise<void> {
    const seq = ++this.evalSeq;
    const { doc } = this.state;
    if (!doc.nodes.length) {
      this.patch({ solids: [], reports: [] });
      return;
    }
    try {
      const result = await kernel().evaluate(doc.nodes, doc.strokes);
      if (seq !== this.evalSeq) return;
      const previous = new Map(this.state.solids.map((s) => [s.id, s]));
      const solids: Solid[] = result.solids.map((s) => ({
        id: s.id,
        node: s.node,
        tags: s.tags,
        metrics: s.metrics,
        tess: s.tess ?? previous.get(s.id)!.tess,
      }));
      const nodes = doc.nodes.map((n) => {
        const r = result.nodes.find((x) => x.id === n.id);
        return r ? { ...n, state: r.state, error: r.error } : n;
      });
      this.state = { ...this.state, doc: { ...doc, nodes }, solids, reports: result.nodes, error: null };
      this.emit();
    } catch (err) {
      if (seq !== this.evalSeq) return;
      this.patch({ error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const store = new Store();

kernel().onProgress((p) => store.patch({ kernel: p }));
