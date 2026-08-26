import type { AppState } from "../state.ts";
import type { OpNode, Stroke } from "../core/types.ts";
import { store, MODEL_DEFAULT } from "../state.ts";
import { describeNode, liveSolids, producingChain } from "../graph/model.ts";
import { opDef } from "../ops/registry.ts";
import { byId, clear, fmt, h } from "./dom.ts";

export interface PanelActions {
  exportModel(kind: "step" | "obj" | "stl" | "glb"): void;
  share(): void;
  clearAll(): void;
  loadExample(): void;
  highlightNode(node: OpNode | null): void;
}

type Tab = "properties" | "model" | "history" | "project";

export function mountPanel(actions: PanelActions): void {
  const panel = byId("panel");
  const tabs: { id: Tab; label: string }[] = [
    { id: "properties", label: "Properties" },
    { id: "model", label: "Model" },
    { id: "history", label: "History" },
    { id: "project", label: "Project" },
  ];
  let active: Tab = "properties";

  const context = h("div", { class: "panel-context", text: "Nothing selected" });
  const tabbar = h("div", { class: "panel-tabs", role: "tablist", "aria-label": "Inspector" });
  const panes = new Map<Tab, HTMLElement>();
  const buttons = new Map<Tab, HTMLButtonElement>();

  for (const tab of tabs) {
    const button = h("button", {
      role: "tab",
      text: tab.label,
      onclick: () => activate(tab.id),
    });
    const pane = h("div", { class: "panel-pane", role: "tabpanel" });
    buttons.set(tab.id, button);
    panes.set(tab.id, pane);
    tabbar.append(button);
  }

  panel.append(
    h("div", { class: "panel-header" }, h("span", { class: "eyebrow", text: "Inspector" }), context),
    tabbar,
    ...panes.values(),
  );

  mountProject(panes.get("project")!, actions);

  function activate(tab: Tab): void {
    active = tab;
    for (const [id, button] of buttons) button.setAttribute("aria-selected", String(id === active));
    for (const [id, pane] of panes) pane.hidden = id !== active;
  }
  activate(active);

  store.subscribe((s) => {
    context.textContent = selectionLabel(s);
    renderProperties(panes.get("properties")!, s);
    renderModel(panes.get("model")!, s);
    renderHistory(panes.get("history")!, s, actions);
  });
}

function renderProperties(root: HTMLElement, s: AppState): void {
  clear(root);
  const pickedStrokes = s.doc.strokes.filter((stroke) => s.selection.strokes.includes(stroke.id));
  const pickedSolid = s.solids.find((solid) => s.selection.solids.includes(solid.id));
  const pickedNode = s.doc.nodes.find((node) => node.id === s.selection.node);

  if (pickedStrokes.length) {
    const first = pickedStrokes[0]!;
    root.append(
      inspectorTitle(pickedStrokes.length === 1 ? `${kindLabel(first)} sketch` : `${pickedStrokes.length} sketches`, "Sketch geometry"),
      propertyGrid([
        ["Reference", pickedStrokes.map((x) => x.id).join(", ")],
        ["Workplane", first.frame ? "Custom / view aligned" : workplaneName(first.plane)],
        [first.frame ? "Origin" : "Elevation", first.frame ? first.frame.origin.map(fmt).join(", ") : `${fmt(first.offset)} m`],
        ["Width", `${fmt(first.metrics.w)} m`],
        ["Height", `${fmt(first.metrics.h)} m`],
        ["Profile", first.closed ? "Closed" : "Open"],
      ]),
      h(
        "div",
        { class: "inspector-actions" },
        actionButton("Duplicate", () => store.duplicateStrokes(pickedStrokes.map((x) => x.id))),
        actionButton(`Move to ${fmt(s.view.offset)} m`, () =>
          store.relevelStrokes(pickedStrokes.map((x) => x.id), s.view.offset),
        ),
        pickedStrokes.some((x) => x.raw)
          ? actionButton(first.fitted === false ? "Use clean fit" : "Use original stroke", () =>
              pickedStrokes.forEach((x) => store.toggleFit(x.id)),
            )
          : null,
        actionButton("Delete", () => store.removeStrokes(pickedStrokes.map((x) => x.id)), true),
      ),
    );
    return;
  }

  if (pickedSolid) {
    root.append(
      inspectorTitle(pickedSolid.tags.join(" · ") || "Solid", pickedSolid.id),
      propertyGrid([
        ["Volume", `${fmt(pickedSolid.metrics.volume)} m³`],
        ["Faces", String(pickedSolid.metrics.faces)],
        ["Edges", String(pickedSolid.metrics.edges)],
        ["Created by", pickedSolid.node],
      ]),
      h("div", { class: "callout", text: "Use Push / Pull, then drag a face to modify this solid." }),
    );
    return;
  }

  if (pickedNode) {
    root.append(inspectorTitle(describeNode(pickedNode), "History operation"), nodeEditor(pickedNode));
    return;
  }

  root.append(
    inspectorTitle("Active workplane", "Start here"),
    propertyGrid([
      ["Plane", s.view.workplaneMode === "view" ? "Current view" : s.view.workplaneMode === "face" ? "Pick model face" : workplaneName(s.view.plane)],
      [s.view.workplaneMode === "view" ? "View depth" : "Elevation", s.view.workplaneMode === "face" ? "From selected face" : `${fmt(s.view.offset)} m`],
      ["Grid", s.view.snap ? "1 m · snapping on" : "Snapping off"],
    ]),
    h(
      "div",
      { class: "onboarding-card" },
      h("span", { class: "step-number", text: "1" }),
      h("div", {}, h("strong", { text: "Choose a sketch tool" }), h("p", { text: "Draw a line, rectangle, circle, or loose concept stroke." })),
      h("span", { class: "step-number", text: "2" }),
      h("div", {}, h("strong", { text: "Build the model" }), h("p", { text: "Describe the intent below the canvas, then build from sketch." })),
    ),
  );
}

function renderModel(root: HTMLElement, s: AppState): void {
  clear(root);
  root.append(sectionHeading("Sketches", s.doc.strokes.length));
  const strokeList = h("div", { class: "object-list" });
  if (!s.doc.strokes.length) strokeList.append(emptyState("No sketches yet", "Choose a sketch tool and draw on the active workplane."));
  for (const stroke of [...s.doc.strokes].sort((a, b) => a.order - b.order)) {
    strokeList.append(strokeRow(stroke, s.selection.strokes.includes(stroke.id)));
  }
  root.append(strokeList, sectionHeading("Built elements", s.solids.length));

  const solidList = h("div", { class: "object-list" });
  const built = new Set(s.solids.map((x) => x.id));
  const live = liveSolids(s.doc.nodes).filter(
    (item) => built.has(item.id) || s.doc.nodes.find((n) => n.id === item.node)?.state !== "error",
  );
  if (!live.length) solidList.append(emptyState("No built elements", "Build from a closed sketch, or push/pull a face."));
  for (const item of live) {
    const solid = s.solids.find((x) => x.id === item.id);
    solidList.append(
      h(
        "button",
        {
          class: "object-row",
          "aria-selected": s.selection.solids.includes(item.id),
          onclick: () => store.select({ solids: [item.id], strokes: [], node: item.node }),
        },
        h("span", { class: "object-icon solid", text: "◆" }),
        h("span", { class: "object-name", text: item.tags.join(" ") || `Element ${item.id}` }),
        h("span", { class: "object-meta", text: solid ? `${fmt(solid.metrics.volume)} m³` : "Building…" }),
      ),
    );
  }
  root.append(solidList);
}

function renderHistory(root: HTMLElement, s: AppState, actions: PanelActions): void {
  clear(root);
  root.append(sectionHeading("Design history", s.doc.nodes.length));
  if (!s.doc.nodes.length) root.append(emptyState("No operations yet", "Your modelling steps will appear here and remain editable."));
  const chain = producingChain(s.doc.nodes, s.selection.node);
  const timeline = h("div", { class: "history-timeline" });
  for (const node of s.doc.nodes) {
    timeline.append(
      h(
        "button",
        {
          class: `history-card${node.state === "error" ? " error" : ""}${s.ghosts.includes(node.id) ? " ghost" : ""}`,
          "aria-selected": chain.has(node.id),
          onclick: () => {
            store.select({ node: node.id, solids: [], strokes: [] });
            actions.highlightNode(node);
          },
        },
        h("span", { class: "history-dot" }),
        h("span", { class: "history-copy" }, h("strong", { text: friendlyOp(node.op) }), h("small", { text: describeNode(node) })),
        h("span", { class: "object-meta", text: node.id }),
      ),
    );
    if (node.state === "error" && node.error) timeline.append(h("div", { class: "node-error", text: node.error }));
  }
  root.append(timeline);

  if (s.ghosts.length) {
    root.append(
      h(
        "div",
        { class: "proposal" },
        h("strong", { text: "Review proposed changes" }),
        h("p", { text: `${s.ghosts.length} new operations are previewed in cyan.` }),
        h("div", { class: "buttons" }, actionButton("Accept changes", () => store.acceptGhosts(), false, true), actionButton("Discard", () => store.discardGhosts(), true)),
      ),
    );
  }
}

function mountProject(root: HTMLElement, actions: PanelActions): void {
  const keyInput = h("input", {
    type: "password",
    placeholder: "sk-ant-…",
    autocomplete: "off",
    spellcheck: false,
    oninput: (e: Event) => store.patchSession({ apiKey: (e.target as HTMLInputElement).value }),
  });
  const modelInput = h("input", {
    type: "text",
    value: MODEL_DEFAULT,
    spellcheck: false,
    oninput: (e: Event) => store.patchSession({ model: (e.target as HTMLInputElement).value }),
  });
  root.append(
    sectionHeading("Share & export"),
    h("p", { class: "note", text: "STEP preserves editable CAD solids for Rhino, Revit, and FreeCAD." }),
    h("div", { class: "export-grid" }, actionButton("Share link", actions.share, false, true), actionButton("STEP", () => actions.exportModel("step")), actionButton("OBJ", () => actions.exportModel("obj")), actionButton("STL", () => actions.exportModel("stl")), actionButton("GLB", () => actions.exportModel("glb"))),
    sectionHeading("Smart mode"),
    field("Anthropic API key", keyInput),
    field("Model", modelInput),
    h("p", { class: "note", text: "Optional. The key stays in memory for this session and is sent only to Anthropic." }),
    sectionHeading("Document"),
    h("div", { class: "buttons" }, actionButton("Load example", actions.loadExample), actionButton("Clear document", actions.clearAll, true)),
  );
}

function nodeEditor(node: OpNode): HTMLElement {
  const root = h("div", { class: "node-editor" });
  const def = opDef(node.op);
  for (const param of def?.params ?? []) {
    if ((param.type !== "number" && param.type !== "int") || typeof node.params[param.name] !== "number") continue;
    root.append(
      h(
        "label",
        { class: "property-input" },
        h("span", { text: friendlyName(param.name) }),
        h("input", {
          type: "number",
          step: param.type === "int" ? "1" : "0.1",
          min: param.min !== undefined ? String(param.min) : undefined,
          max: param.max !== undefined ? String(param.max) : undefined,
          value: String(node.params[param.name]),
          onchange: (e: Event) => {
            const value = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(value)) store.applyOp("edit", { node: node.id, set: { [param.name]: value } });
          },
        }),
      ),
    );
  }
  return root;
}

function strokeRow(stroke: Stroke, selected: boolean): HTMLElement {
  return h(
    "button",
    {
      class: "object-row",
      "aria-selected": selected,
      onclick: () => store.select({ strokes: [stroke.id], solids: [], node: null }),
      ondblclick: () => {
        const note = prompt(`Note for ${stroke.id}`, stroke.note ?? "");
        if (note !== null) store.updateStroke(stroke.id, (s) => ({ ...s, note: note || undefined }));
      },
    },
    h("span", { class: "object-icon sketch", text: stroke.closed ? "▢" : "⌁" }),
    h("span", { class: "object-name", text: stroke.note || `${kindLabel(stroke)} ${stroke.id}` }),
    h("span", { class: "object-meta", text: `${fmt(stroke.metrics.w)} × ${fmt(stroke.metrics.h)} m` }),
  );
}

function actionButton(label: string, onclick: () => void, danger = false, primary = false): HTMLElement {
  return h("button", { class: `btn${danger ? " danger" : ""}${primary ? " primary" : ""}`, onclick, text: label });
}

function inspectorTitle(title: string, kicker: string): HTMLElement {
  return h("div", { class: "inspector-title" }, h("span", { class: "eyebrow", text: kicker }), h("h2", { text: title }));
}

function propertyGrid(rows: [string, string][]): HTMLElement {
  return h("dl", { class: "property-grid" }, ...rows.flatMap(([name, value]) => [h("dt", { text: name }), h("dd", { text: value })]));
}

function sectionHeading(label: string, count?: number): HTMLElement {
  return h("div", { class: "section-heading" }, h("h2", { text: label }), count === undefined ? null : h("span", { text: String(count) }));
}

function emptyState(title: string, text: string): HTMLElement {
  return h("div", { class: "empty-state" }, h("strong", { text: title }), h("p", { text }));
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h("div", { class: "field" }, h("label", { text: label }), input);
}

function selectionLabel(s: AppState): string {
  if (s.selection.strokes.length) return `${s.selection.strokes.length} sketch${s.selection.strokes.length === 1 ? "" : "es"} selected`;
  if (s.selection.solids.length) return `${s.selection.solids.length} element${s.selection.solids.length === 1 ? "" : "s"} selected`;
  if (s.selection.node) return "History operation selected";
  const name = s.view.workplaneMode === "view" ? "Current view" : s.view.workplaneMode === "face" ? "Model face" : workplaneName(s.view.plane);
  return `${name} · ${fmt(s.view.offset)} m`;
}

function kindLabel(stroke: Stroke): string {
  return stroke.kind === "rect" ? "Rectangle" : stroke.kind[0]!.toUpperCase() + stroke.kind.slice(1);
}

function friendlyOp(op: string): string {
  return op.split("_").map(friendlyName).join(" ");
}

function friendlyName(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1).replaceAll("_", " ");
}

function workplaneName(plane: string): string {
  return plane === "ground" ? "Horizontal level" : plane === "front" ? "Front elevation" : "Side elevation";
}
