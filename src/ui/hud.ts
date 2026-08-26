import type { PlaneKey } from "../core/types.ts";
import { store, type ViewKey } from "../state.ts";
import { offsetDetents } from "../scene/picking.ts";
import { byId, clear, fmt, h } from "./dom.ts";

const VIEWS: ViewKey[] = ["iso", "top", "front", "side"];
type WorkplaneChoice = PlaneKey | "view" | "face";
const WORKPLANES: { value: WorkplaneChoice; label: string }[] = [
  { value: "ground", label: "Level / horizontal" },
  { value: "front", label: "Front elevation" },
  { value: "side", label: "Side elevation" },
  { value: "view", label: "Current view" },
  { value: "face", label: "Model face (pick on canvas)" },
];
const TOOL_NAMES = {
  orbit: "Orbit",
  select: "Select",
  draw: "Freehand",
  line: "Line",
  rect: "Rectangle",
  circle: "Circle",
  pushpull: "Push / Pull",
  erase: "Erase",
} as const;

/**
 * The HUD keeps live controls (offset slider, intent field) as persistent
 * nodes and only writes their values, so dragging the slider or typing in the
 * chat box is never interrupted by a re-render.
 */
export function mountHud(actions: { setView(v: ViewKey): void; interpret(): void }): void {
  const hud = byId("hud");
  const planebar = byId("planebar");
  const status = byId("status");
  const intentBar = byId("intent");
  const loading = byId("loading");

  const viewButtons = VIEWS.map((v) =>
    h("button", { onclick: () => actions.setView(v), text: v, "aria-pressed": false }),
  );
  const counts = h("div", { class: "chip" });
  const activeTool = h("div", { class: "active-tool-chip" });
  hud.append(
    h("div", { class: "views", role: "group", "aria-label": "Camera" }, ...viewButtons),
    h("div", { class: "chip", text: "Grid 1 m" }),
    counts,
    activeTool,
  );

  const planeSelect = h(
    "select",
    {
      id: "plane-select",
      onchange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value as WorkplaneChoice;
        if (value === "view") store.patchView({ workplaneMode: "view", offset: 0 });
        else if (value === "face") store.patchView({ workplaneMode: "face", offset: 0 });
        else store.patchView({ workplaneMode: "axis", plane: value });
      },
    },
    ...WORKPLANES.map((p) => h("option", { value: p.value, text: p.label })),
  );
  const detentList = h("datalist", { id: "offset-detents" });
  const offsetRange = h("input", {
    id: "offset-range",
    type: "range",
    min: "-30",
    max: "60",
    step: "0.5",
    list: "offset-detents",
    value: "0",
    oninput: (e: Event) => store.patchView({ offset: Number((e.target as HTMLInputElement).value) }),
  });
  const offsetOut = h("output", { text: "0.0 m" });
  const offsetLabel = h("label", { for: "offset-range", text: "Elevation" });
  planebar.append(
    h("div", { class: "workplane-title" }, h("strong", { text: "Workplane" }), h("span", { text: "Draw level" })),
    planeSelect,
    offsetLabel,
    offsetRange,
    detentList,
    offsetOut,
  );

  const intentInput = h("input", {
    type: "text",
    id: "intent-input",
    "aria-label": "What are you drawing?",
    placeholder: "Describe what to build or change…",
    oninput: (e: Event) =>
      store.commit(
        { ...store.get().doc, intent: (e.target as HTMLInputElement).value },
        { silent: true },
      ),
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") actions.interpret();
    },
  });
  const interpretBtn = h("button", { class: "btn primary", onclick: actions.interpret, text: "Build from sketch" });
  intentBar.append(h("span", { class: "intent-icon", "aria-hidden": "true", text: "✦" }), intentInput, interpretBtn);

  let lastDetents = "";
  let lastStatus = "";

  store.subscribe((s) => {
    VIEWS.forEach((v, i) => viewButtons[i]!.setAttribute("aria-pressed", String(s.view.camera === v)));
    counts.textContent = `${s.doc.strokes.length} strokes · ${s.solids.length} solids`;
    activeTool.textContent = TOOL_NAMES[s.view.tool];
    activeTool.dataset.tool = s.view.tool;

    const workplaneValue = s.view.workplaneMode === "axis" ? s.view.plane : s.view.workplaneMode;
    if (planeSelect.value !== workplaneValue) planeSelect.value = workplaneValue;
    offsetLabel.textContent = s.view.workplaneMode === "view" ? "View depth" : "Elevation";
    offsetRange.disabled = s.view.workplaneMode === "face";
    if (document.activeElement !== offsetRange) offsetRange.value = String(s.view.offset);
    offsetOut.textContent = `${fmt(s.view.offset)} m`;
    const detents = s.view.workplaneMode !== "axis" ? [0] : offsetDetents(s.doc.strokes, s.view.plane);
    const key = detents.join(",");
    if (key !== lastDetents) {
      lastDetents = key;
      clear(detentList);
      for (const d of detents) detentList.append(h("option", { value: String(d) }));
    }

    if (document.activeElement !== intentInput && intentInput.value !== s.doc.intent) {
      intentInput.value = s.doc.intent;
    }
    intentInput.placeholder = s.session.messages.length
      ? "Describe a change — e.g. make it 40 m tall with 300 mm walls"
      : "Describe the design intent, then build from the sketch";
    interpretBtn.disabled = s.session.busy;
    interpretBtn.textContent = s.session.busy
      ? "working"
      : s.session.apiKey
        ? "Build / update"
        : "Build from sketch";

    const text = s.error ?? s.session.status ?? "";
    if (text !== lastStatus) {
      lastStatus = text;
      status.textContent = text;
    }
    status.classList.toggle("error", Boolean(s.error));

    if (s.kernel.done) {
      loading.hidden = true;
    } else {
      loading.hidden = false;
      const pct = s.kernel.total ? Math.round((s.kernel.loaded / s.kernel.total) * 100) : 0;
      clear(loading);
      loading.append(
        h("div", { text: `${s.kernel.message} — cached after this visit` }),
        h("div", { class: "bar" }, h("span", { style: `width:${pct}%` })),
      );
    }
  });
}

export function setStatus(text: string): void {
  store.patchSession({ status: text });
}
