import * as THREE from "three";
import "./styles/app.css";
import "./ops/defs/index.ts";

import { store, type ViewKey } from "./state.ts";
import { kernel } from "./kernel/api.ts";
import { Viewport } from "./scene/viewport.ts";
import { Sheet } from "./scene/sheet.ts";
import { Display, Highlight } from "./scene/display.ts";
import { StrokeLayer } from "./sketch/render.ts";
import { SketchCapture } from "./sketch/capture.ts";
import { mountRail } from "./ui/rail.ts";
import { mountHud, setStatus } from "./ui/hud.ts";
import { mountPanel } from "./ui/panel.ts";
import { showCapabilities, showHelp, showShare } from "./ui/dialogs.ts";
import { byId } from "./ui/dom.ts";
import { interpret } from "./interpret/heuristics.ts";
import { exampleDoc } from "./interpret/example.ts";
import { runTurn } from "./llm/conversation.ts";
import { validationScene } from "./graph/model.ts";
import { validateOp } from "./ops/registry.ts";
import { downloadModel } from "./share/export.ts";
import { docFromLocation, shareUrl } from "./share/urlhash.ts";
import type { ExportKind } from "./kernel/export.ts";
import type { OpNode } from "./core/types.ts";

const canvas = byId<HTMLCanvasElement>("view");
const viewport = new Viewport(canvas);
const sheet = new Sheet();
const display = new Display();
const highlight = new Highlight();
const strokes = new StrokeLayer();

viewport.scene.add(sheet.group, display.group, strokes.group, highlight.group);

const capture = new SketchCapture(canvas, viewport, sheet, strokes, display);
capture.onStatus = setStatus;
capture.onPushPullPreview = (d) => {
  if (d) setStatus(`push/pull ${d.toFixed(1)} m — release to commit`);
};

const marquee = document.createElement("div");
marquee.className = "marquee";
marquee.hidden = true;
canvas.parentElement?.append(marquee);
capture.onMarquee = (box) => {
  marquee.hidden = !box;
  if (!box) return;
  marquee.style.left = `${box.x}px`;
  marquee.style.top = `${box.y}px`;
  marquee.style.width = `${box.w}px`;
  marquee.style.height = `${box.h}px`;
};

/* ------------------------------------------------------------------ render */

let framed = false;
store.subscribe((s) => {
  sheet.visible = s.view.showSheet && s.view.workplaneMode !== "face";
  if (s.view.workplaneMode === "view") sheet.placeFrame(viewport.viewFrame(s.view.offset));
  else sheet.place(s.view.plane, s.view.offset);
  strokes.visible = s.view.showStrokes;
  strokes.halfWidth = 2.2 / Math.max(1e-6, viewport.pixelsPerUnit());
  strokes.sync(s.doc.strokes, new Set(s.selection.strokes));
  display.sync(s.solids, new Set(s.ghosts), new Set(s.selection.solids));
  if (!framed && s.solids.length) {
    framed = true;
    frameAll();
  }
  viewport.invalidate();
});

// keep stroke ribbons at a constant screen width while zooming
viewport.addFrameHook(() => {
  if (store.get().view.workplaneMode === "view") {
    sheet.placeFrame(viewport.viewFrame(store.get().view.offset));
  }
  const want = 2.2 / Math.max(1e-6, viewport.pixelsPerUnit());
  if (Math.abs(want - strokes.halfWidth) / (strokes.halfWidth || 1) > 0.08) {
    strokes.halfWidth = want;
    strokes.sync(store.get().doc.strokes, new Set(store.get().selection.strokes));
  }
});

/* --------------------------------------------------------------- interpret */

async function doInterpret(): Promise<void> {
  const state = store.get();
  if (!state.doc.strokes.length) {
    setStatus("draw something first");
    return;
  }
  await kernel().whenReady();

  if (state.session.apiKey) {
    try {
      const result = await runTurn(state.doc.intent || "interpret this sketch");
      setStatus(result.summary || `${result.applied.length} operations`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  store.discardGhosts();
  const ops = interpret(state.doc);
  if (!ops.length) {
    setStatus("nothing in this sketch matched a rule");
    return;
  }
  let applied = 0;
  for (const op of ops) {
    const scene = validationScene(store.get().doc);
    const result = validateOp({ op: op.op, params: op.params }, scene);
    if (!result.ok) continue;
    store.applyOp(op.op, result.params, { ghost: true });
    applied++;
  }
  setStatus(`${applied} operations from the built-in rules — ${ops[0]!.because}`);
}

/* -------------------------------------------------------------------- chrome */

function setView(v: ViewKey): void {
  store.patchView({ camera: v });
  const box = display.bounds();
  viewport.setView(v, box.isEmpty() ? undefined : box.getCenter(new THREE.Vector3()));
}

mountRail({
  undo: () => store.undo(),
  redo: () => store.redo(),
  help: showHelp,
  capabilities: showCapabilities,
});

mountHud({ setView, interpret: () => void doInterpret() });

mountPanel({
  exportModel: (kind: ExportKind) => {
    void downloadModel(store.get().doc, kind)
      .then((msg) => setStatus(`exported ${msg}`))
      .catch((err: Error) => setStatus(err.message));
  },
  share: () => {
    const { url, warn } = shareUrl(store.get().doc);
    history.replaceState(null, "", url);
    showShare(url, warn);
  },
  clearAll: () => store.commit({ strokes: [], nodes: [], intent: "" }),
  loadExample: () => {
    store.commit(exampleDoc());
    frameAll();
  },
  highlightNode: (node: OpNode | null) => {
    highlight.clear();
    if (!node) return;
    const ref = (node.params.edges ?? node.params.face ?? node.params.open_faces) as
      | { solid: string; kind: "face" | "edges"; select: string }
      | undefined;
    if (!ref) return;
    void kernel()
      .resolveSelector(ref)
      .then((sel) => {
        highlight.show(sel.polylines);
        viewport.invalidate();
      })
      .catch(() => highlight.clear());
  },
});

byId("panel-toggle").addEventListener("click", () => byId("panel").classList.toggle("open"));

function frameAll(): void {
  const box = display.bounds();
  for (const mesh of strokes.meshes()) box.expandByObject(mesh);
  if (!box.isEmpty()) viewport.frame(box);
}

/* ------------------------------------------------------------------ keyboard */

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
    if (e.key === "Escape") target.blur();
    return;
  }
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (meta && e.key.toLowerCase() === "d") {
    e.preventDefault();
    store.duplicateStrokes(store.get().selection.strokes);
    return;
  }
  switch (e.key.toLowerCase()) {
    case "d":
      store.patchView({ tool: "draw" });
      break;
    case "o":
      store.patchView({ tool: "orbit" });
      break;
    case "l":
      store.patchView({ tool: "line" });
      break;
    case "r":
      store.patchView({ tool: "rect" });
      break;
    case "c":
      store.patchView({ tool: "circle" });
      break;
    case "v":
      store.patchView({ tool: "select" });
      break;
    case "p":
      store.patchView({ tool: "pushpull" });
      break;
    case "e":
      store.patchView({ tool: "erase" });
      break;
    case "s":
      store.patchView({ snap: !store.get().view.snap });
      break;
    case "f":
      frameAll();
      break;
    case "1":
      setView("iso");
      break;
    case "2":
      setView("top");
      break;
    case "3":
      setView("front");
      break;
    case "4":
      setView("side");
      break;
    case "?":
      showHelp();
      break;
    case "delete":
    case "backspace": {
      const sel = store.get().selection.strokes;
      if (sel.length) store.removeStrokes(sel);
      break;
    }
    case "arrowleft":
    case "arrowright":
    case "arrowup":
    case "arrowdown": {
      const sel = store.get().selection.strokes;
      if (!sel.length) break;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.5;
      const da = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const db = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
      store.moveStrokes(sel, da, db);
      break;
    }
    case "[":
    case "]": {
      const sel = store.get().selection.strokes;
      const first = store.get().doc.strokes.find((s) => s.id === sel[0]);
      if (!first) break;
      store.relevelStrokes(sel, first.offset + (e.key === "]" ? 0.5 : -0.5));
      break;
    }
    default:
      break;
  }
});

/* ---------------------------------------------------------------- boot */

const shared = docFromLocation();
store.commit(shared ?? exampleDoc(), { silent: true });
setView("iso");
requestAnimationFrame(frameAll);

void kernel()
  .whenReady()
  .then(() => {
    setStatus(shared ? "shared model loaded — re-evaluating" : "ready — press Interpret");
    store.scheduleEvaluate();
  })
  .catch((err: Error) => store.patch({ error: err.message }));

// Cache the 50 MB kernel so the cost is paid once (SPEC §2c).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
