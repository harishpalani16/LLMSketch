import { capabilities } from "../ops/registry.ts";
import { byId, clear, h } from "./dom.ts";

function open(...content: HTMLElement[]): void {
  const dialog = byId<HTMLDialogElement>("dialog");
  clear(dialog);
  dialog.append(
    ...content,
    h(
      "div",
      { class: "buttons", style: "margin-top:18px" },
      h("button", { class: "btn", onclick: () => dialog.close(), text: "close" }),
    ),
  );
  dialog.showModal();
}

/** SPEC §8 -- generated from the registry, so it cannot drift from reality. */
export function showCapabilities(): void {
  const caps = capabilities();
  const groups = ["create", "modify", "organize"] as const;
  const sections: HTMLElement[] = [];
  for (const g of groups) {
    const rows = caps.ops.filter((o) => o.group === g);
    if (!rows.length) continue;
    sections.push(
      h("h3", { text: g }),
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", { text: "op" }), h("th", { text: "params" }), h("th", { text: "what it does" }))),
        h(
          "tbody",
          {},
          ...rows.map((o) =>
            h(
              "tr",
              {},
              h("td", {}, h("code", { text: o.name })),
              h("td", { text: o.params.map((p) => `${p.name}:${p.type}`).join(", ") }),
              h("td", { text: o.summary + (o.preconditions ? ` (needs ${o.preconditions})` : "") }),
            ),
          ),
        ),
      ),
    );
  }
  open(
    h("h1", { text: "What this can build" }),
    h("p", {
      class: "note",
      text:
        "Every operation below is available to you and to the model. This list is generated " +
        "from the operation registry, so it is always exactly what the app can do.",
    }),
    ...sections,
    h("h3", { text: "selectors" }),
    h("p", { class: "note", text: caps.selectors.join("  ·  ") }),
  );
}

export function showHelp(): void {
  const row = (keys: string, what: string) =>
    h("tr", {}, h("td", {}, h("kbd", { text: keys })), h("td", { text: what }));
  open(
    h("h1", { text: "Sketch to solid" }),
    h("p", {
      class: "note",
      text:
        "Draw strokes on the sheet, then press Interpret. Strokes plus the history of " +
        "operations are the document; geometry is always re-evaluated from them, so every " +
        "number stays editable.",
    }),
    h("h3", { text: "drawing" }),
    h(
      "table",
      {},
      h(
        "tbody",
        {},
        row("D / V / P / E", "draw · select · push-pull · erase"),
        row("drag", "draw on the sheet, or on a face of a solid"),
        row("Shift", "lock the stroke to the nearer sheet axis"),
        row("S", "toggle snapping (grid 0.5 m, endpoints, auto-close)"),
        row("1 2 3 4", "iso · top · front · side"),
      ),
    ),
    h("h3", { text: "camera" }),
    h(
      "table",
      {},
      h(
        "tbody",
        {},
        row("right-drag / Alt-drag", "orbit (iso view only)"),
        row("middle-drag", "pan"),
        row("wheel", "zoom"),
        row("F", "frame everything"),
      ),
    ),
    h("h3", { text: "model" }),
    h(
      "table",
      {},
      h(
        "tbody",
        {},
        row("Ctrl+Z / Ctrl+Shift+Z", "undo · redo, across strokes and history alike"),
        row("drag a stroke", "move the selection inside its own plane"),
        row("drag empty space", "marquee select (Shift adds)"),
        row("arrows", "nudge 0.5 m, or 0.1 m with Shift"),
        row("[ / ]", "re-level the selection down · up"),
        row("Ctrl+D", "duplicate the selected strokes"),
        row("Delete", "delete the selected strokes"),
        row("Enter", "interpret the sketch"),
      ),
    ),
    h("h3", { text: "without a key" }),
    h("p", {
      class: "note",
      text:
        "Interpret works with no API key: a rule-based interpreter reads stacked outlines as " +
        "lofts, lone outlines as extrusions, open lines as walls, and so on. Add a key in the " +
        "Smart mode panel to talk to the model instead.",
    }),
  );
}

export function showShare(url: string, warn: boolean): void {
  const input = h("input", { type: "text", value: url, readonly: true, style: "width:100%" });
  open(
    h("h1", { text: "Share this model" }),
    h("p", {
      class: "note",
      text:
        "The link carries the strokes and the whole history graph -- the model as a program. " +
        "Whoever opens it re-evaluates the graph in their own browser.",
    }),
    input,
    warn
      ? h("p", {
          class: "note",
          style: "color:var(--redline)",
          text: "This link is over 8 KB; some chat apps will truncate it.",
        })
      : h("p", { class: "note", text: `${url.length} characters.` }),
  );
  input.select();
}
