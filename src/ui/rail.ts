import { store, type Tool } from "../state.ts";
import { byId, clear, h } from "./dom.ts";

interface ToolItem {
  tool: Tool;
  glyph: string;
  label: string;
  key: string;
  danger?: boolean;
}

const GROUPS: { label: string; tools: ToolItem[] }[] = [
  {
    label: "Navigate",
    tools: [
      { tool: "select", glyph: "↖", label: "Select", key: "V" },
      { tool: "orbit", glyph: "◉", label: "Orbit", key: "O" },
    ],
  },
  {
    label: "Sketch",
    tools: [
      { tool: "draw", glyph: "✎", label: "Freehand", key: "D" },
      { tool: "line", glyph: "╱", label: "Line", key: "L" },
      { tool: "rect", glyph: "□", label: "Rectangle", key: "R" },
      { tool: "circle", glyph: "○", label: "Circle", key: "C" },
      { tool: "erase", glyph: "⌫", label: "Erase", key: "E", danger: true },
    ],
  },
  { label: "Model", tools: [{ tool: "pushpull", glyph: "↕", label: "Push / Pull", key: "P" }] },
];

export function mountRail(actions: {
  undo(): void;
  redo(): void;
  help(): void;
  capabilities(): void;
}): void {
  const rail = byId("rail");

  const render = (): void => {
    const state = store.get();
    clear(rail);
    for (const group of GROUPS) {
      const body = h("div", { class: "tool-group" });
      for (const t of group.tools) {
        body.append(toolButton(t, state.view.tool === t.tool, () => store.patchView({ tool: t.tool })));
      }
      rail.append(h("div", { class: "tool-group-label", text: group.label }), body);
    }

    rail.append(
      h("div", { class: "tool-group-label", text: "Display" }),
      h(
        "div",
        { class: "tool-group compact" },
        toggle("⌁", "Snap", "S", state.view.snap, () => store.patchView({ snap: !state.view.snap })),
        toggle("▦", "Grid", "", state.view.showSheet, () =>
          store.patchView({ showSheet: !state.view.showSheet }),
        ),
        toggle("〰", "Strokes", "", state.view.showStrokes, () =>
          store.patchView({ showStrokes: !state.view.showStrokes }),
        ),
      ),
      h("div", { class: "spacer" }),
      h(
        "div",
        { class: "rail-footer" },
        utility("↶", "Undo", !store.canUndo(), actions.undo),
        utility("↷", "Redo", !store.canRedo(), actions.redo),
        utility("≣", "Capabilities", false, actions.capabilities),
        utility("?", "Help", false, actions.help),
      ),
    );
  };

  store.subscribe(render);
}

function toolButton(item: ToolItem, pressed: boolean, onclick: () => void): HTMLElement {
  return h(
    "button",
    {
      class: `tool${item.danger ? " danger" : ""}`,
      title: `${item.label} (${item.key})`,
      "aria-label": item.label,
      "aria-pressed": pressed,
      onclick,
    },
    h("span", { class: "tool-glyph", "aria-hidden": "true", text: item.glyph }),
    h("span", { class: "tool-label", text: item.label }),
    h("kbd", { text: item.key }),
  );
}

function toggle(glyph: string, label: string, key: string, pressed: boolean, onclick: () => void): HTMLElement {
  return h(
    "button",
    { class: "tool", "aria-label": label, "aria-pressed": pressed, onclick },
    h("span", { class: "tool-glyph", "aria-hidden": "true", text: glyph }),
    h("span", { class: "tool-label", text: label }),
    key ? h("kbd", { text: key }) : null,
  );
}

function utility(glyph: string, label: string, disabled: boolean, onclick: () => void): HTMLElement {
  return h(
    "button",
    { class: "tool utility", "aria-label": label, title: label, disabled, onclick },
    h("span", { class: "tool-glyph", "aria-hidden": "true", text: glyph }),
    h("span", { class: "tool-label", text: label }),
  );
}
