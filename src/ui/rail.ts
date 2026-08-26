import { store, type Tool } from "../state.ts";
import { byId, clear, h } from "./dom.ts";

const TOOLS: { tool: Tool; glyph: string; label: string; key: string; danger?: boolean }[] = [
  { tool: "draw", glyph: "✎", label: "Draw", key: "D" },
  { tool: "select", glyph: "▣", label: "Select", key: "V" },
  { tool: "pushpull", glyph: "⇕", label: "Push / pull a face", key: "P" },
  { tool: "erase", glyph: "⌫", label: "Erase strokes", key: "E", danger: true },
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
    for (const t of TOOLS) {
      rail.append(
        h("button", {
          class: `tool${t.danger ? " danger" : ""}`,
          title: `${t.label} (${t.key})`,
          "aria-label": t.label,
          "aria-pressed": state.view.tool === t.tool,
          onclick: () => store.patchView({ tool: t.tool }),
          text: t.glyph,
        }),
      );
    }
    rail.append(
      h("button", {
        class: "tool",
        title: "Snapping (S)",
        "aria-label": "Snapping",
        "aria-pressed": state.view.snap,
        onclick: () => store.patchView({ snap: !state.view.snap }),
        text: "◦",
      }),
      h("button", {
        class: "tool",
        title: "Show the sheet",
        "aria-label": "Show the sheet",
        "aria-pressed": state.view.showSheet,
        onclick: () => store.patchView({ showSheet: !state.view.showSheet }),
        text: "▤",
      }),
      h("button", {
        class: "tool",
        title: "Show strokes",
        "aria-label": "Show strokes",
        "aria-pressed": state.view.showStrokes,
        onclick: () => store.patchView({ showStrokes: !state.view.showStrokes }),
        text: "〰",
      }),
      h("div", { class: "spacer" }),
      h("button", {
        class: "tool",
        title: "Undo (Ctrl+Z)",
        "aria-label": "Undo",
        onclick: actions.undo,
        text: "↺",
      }),
      h("button", {
        class: "tool",
        title: "Redo (Ctrl+Shift+Z)",
        "aria-label": "Redo",
        onclick: actions.redo,
        text: "↻",
      }),
      h("button", {
        class: "tool",
        title: "What this app can build",
        "aria-label": "Capabilities",
        onclick: actions.capabilities,
        text: "≣",
      }),
      h("button", {
        class: "tool",
        title: "Help (?)",
        "aria-label": "Help",
        onclick: actions.help,
        text: "?",
      }),
    );
  };

  store.subscribe(render);
}
