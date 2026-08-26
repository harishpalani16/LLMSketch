import type { OpNode, Stroke } from "../core/types.ts";
import { store, MODEL_DEFAULT } from "../state.ts";
import { describeNode, liveSolids } from "../graph/model.ts";
import { opDef } from "../ops/registry.ts";
import { byId, clear, fmt, h } from "./dom.ts";

/**
 * The right panel: strokes, the history graph, smart mode and share/export.
 * Grasshopper flattened to a list -- powerful, but visually quiet. The canvas
 * is the product (SPEC §11).
 */

export interface PanelActions {
  exportModel(kind: "step" | "obj" | "stl" | "glb"): void;
  share(): void;
  clearAll(): void;
  loadExample(): void;
  highlightNode(node: OpNode | null): void;
}

export function mountPanel(actions: PanelActions): void {
  const panel = byId("panel");

  const strokeSection = section("Strokes");
  const historySection = section("History");
  const solidSection = section("Solids");
  const smartSection = section("Smart mode");
  const shareSection = section("Share & export");
  panel.append(
    strokeSection.root,
    historySection.root,
    solidSection.root,
    smartSection.root,
    shareSection.root,
  );

  /* smart mode is built once so the key field keeps focus */
  const keyInput = h("input", {
    type: "password",
    placeholder: "sk-ant-...",
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
  smartSection.body.append(
    field("Anthropic API key", keyInput),
    field("Model", modelInput),
    h("p", {
      class: "note",
      text:
        "The key stays in memory for this session only: never stored, never sent anywhere " +
        "except api.anthropic.com. Without a key, Interpret uses the built-in rules.",
    }),
  );

  shareSection.body.append(
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn", onclick: actions.share, text: "share link" }),
      h("button", { class: "btn", onclick: () => actions.exportModel("step"), text: "STEP" }),
      h("button", { class: "btn", onclick: () => actions.exportModel("obj"), text: "OBJ" }),
      h("button", { class: "btn", onclick: () => actions.exportModel("stl"), text: "STL" }),
      h("button", { class: "btn", onclick: () => actions.exportModel("glb"), text: "GLB" }),
    ),
    h("p", { class: "note", text: "STEP carries real solids into Rhino, Revit and FreeCAD." }),
    h(
      "div",
      { class: "buttons", style: "margin-top:8px" },
      h("button", { class: "btn", onclick: actions.loadExample, text: "example scene" }),
      h("button", { class: "btn danger", onclick: actions.clearAll, text: "clear" }),
    ),
  );

  const proposal = h("div");
  historySection.root.append(proposal);

  store.subscribe((s) => {
    /* -------------------------------------------------------- strokes */
    strokeSection.count.textContent = String(s.doc.strokes.length);
    clear(strokeSection.body);
    if (!s.doc.strokes.length) {
      strokeSection.body.append(h("p", { class: "note", text: "Draw on the sheet to begin." }));
    }
    for (const stroke of [...s.doc.strokes].sort((a, b) => a.order - b.order)) {
      strokeSection.body.append(strokeRow(stroke, s.selection.strokes.includes(stroke.id)));
    }

    /* -------------------------------------------------------- history */
    historySection.count.textContent = String(s.doc.nodes.length);
    clear(historySection.body);
    if (!s.doc.nodes.length) {
      historySection.body.append(
        h("p", { class: "note", text: "Interpret the sketch, or push/pull a face." }),
      );
    }
    for (const node of s.doc.nodes) {
      historySection.body.append(
        ...nodeRow(node, s.ghosts.includes(node.id), s.selection.node === node.id, actions),
      );
    }

    clear(proposal);
    if (s.ghosts.length) {
      proposal.append(
        h(
          "div",
          { class: "proposal" },
          h("p", { text: `${s.ghosts.length} proposed operations shown as ghosts.` }),
          h(
            "div",
            { class: "buttons" },
            h("button", {
              class: "btn primary",
              onclick: () => store.acceptGhosts(),
              text: "keep",
            }),
            h("button", {
              class: "btn danger",
              onclick: () => store.discardGhosts(),
              text: "discard",
            }),
          ),
        ),
      );
    }

    /* --------------------------------------------------------- solids */
    const live = liveSolids(s.doc.nodes);
    solidSection.count.textContent = String(live.length);
    clear(solidSection.body);
    for (const l of live) {
      const solid = s.solids.find((x) => x.id === l.id);
      solidSection.body.append(
        h(
          "div",
          {
            class: "row",
            "aria-selected": s.selection.solids.includes(l.id),
            onclick: () => store.select({ solids: [l.id], strokes: [], node: l.node }),
          },
          h("span", { class: "id", text: l.id }),
          h("span", { text: l.tags.join(" ") || l.node }),
          h("span", {
            class: "meta",
            text: solid ? `${fmt(solid.metrics.volume)} m³` : "…",
          }),
        ),
      );
    }
  });
}

function section(title: string) {
  const count = h("span", { class: "count", text: "0" });
  const body = h("div", { class: "rowlist" });
  const root = h("div", { class: "section" }, h("h2", {}, title, count), body);
  return { root, body, count };
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h("div", { class: "field" }, h("label", { text: label }), input);
}

function strokeRow(stroke: Stroke, selected: boolean): HTMLElement {
  const size = `${fmt(stroke.metrics.w)}×${fmt(stroke.metrics.h)}`;
  return h(
    "div",
    {
      class: "row",
      "aria-selected": selected,
      onclick: () => store.select({ strokes: [stroke.id], solids: [], node: null }),
      ondblclick: () => {
        const note = prompt(`Note for ${stroke.id}`, stroke.note ?? "");
        if (note !== null) store.updateStroke(stroke.id, (s) => ({ ...s, note: note || undefined }));
      },
    },
    h("span", { class: "id", text: stroke.id }),
    h("span", { text: `${stroke.closed ? "closed" : "open"} ${stroke.kind}` }),
    h("span", { class: "meta", text: `${size} · ${stroke.plane}@${fmt(stroke.offset)}` }),
  );
}

function nodeRow(
  node: OpNode,
  ghost: boolean,
  selected: boolean,
  actions: PanelActions,
): HTMLElement[] {
  const rows: HTMLElement[] = [];
  rows.push(
    h(
      "div",
      {
        class: `row${node.state === "error" ? " error" : ""}${ghost ? " ghost" : ""}`,
        "aria-selected": selected,
        onclick: () => {
          store.select({ node: node.id, solids: node.outputs, strokes: [] });
          actions.highlightNode(node);
        },
      },
      h("span", { class: "id", text: node.id }),
      h("span", { text: describeNode(node) }),
      h("span", { class: "meta", text: node.outputs.join(",") || (ghost ? "ghost" : "") }),
    ),
  );

  if (node.state === "error" && node.error) {
    rows.push(h("div", { class: "node-error", text: node.error }));
  }

  const def = opDef(node.op);
  const scalars = (def?.params ?? []).filter(
    (p) => (p.type === "number" || p.type === "int") && typeof node.params[p.name] === "number",
  );
  if (scalars.length) {
    rows.push(
      h(
        "div",
        { class: "scalars" },
        ...scalars.map((p) =>
          h(
            "label",
            { class: "scalar" },
            p.name,
            h("input", {
              type: "number",
              step: p.type === "int" ? "1" : "0.1",
              min: p.min !== undefined ? String(p.min) : undefined,
              max: p.max !== undefined ? String(p.max) : undefined,
              value: String(node.params[p.name]),
              onchange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(v)) return;
                store.applyOp("edit", { node: node.id, set: { [p.name]: v } });
              },
            }),
          ),
        ),
      ),
    );
  }
  return rows;
}
