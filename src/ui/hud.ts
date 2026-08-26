import type { PlaneKey } from "../core/types.ts";
import { store, type ViewKey } from "../state.ts";
import { offsetDetents } from "../scene/picking.ts";
import { byId, clear, fmt, h } from "./dom.ts";

const VIEWS: ViewKey[] = ["iso", "top", "front", "side"];
const PLANES: PlaneKey[] = ["ground", "front", "side"];

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
  hud.append(
    h("div", { class: "views", role: "group", "aria-label": "Camera" }, ...viewButtons),
    h("div", { class: "chip", text: "1 grid square = 1 m" }),
    counts,
  );

  const planeSelect = h(
    "select",
    {
      id: "plane-select",
      onchange: (e: Event) =>
        store.patchView({ plane: (e.target as HTMLSelectElement).value as PlaneKey }),
    },
    ...PLANES.map((p) => h("option", { value: p, text: p })),
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
  planebar.append(
    h("label", { for: "plane-select", text: "plane" }),
    planeSelect,
    h("label", { for: "offset-range", text: "offset" }),
    offsetRange,
    detentList,
    offsetOut,
  );

  const intentInput = h("input", {
    type: "text",
    id: "intent-input",
    "aria-label": "What are you drawing?",
    placeholder: "what are you drawing? (optional)",
    oninput: (e: Event) =>
      store.commit(
        { ...store.get().doc, intent: (e.target as HTMLInputElement).value },
        { silent: true },
      ),
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") actions.interpret();
    },
  });
  const interpretBtn = h("button", { class: "btn primary", onclick: actions.interpret, text: "interpret" });
  intentBar.append(intentInput, interpretBtn);

  let lastDetents = "";
  let lastStatus = "";

  store.subscribe((s) => {
    VIEWS.forEach((v, i) => viewButtons[i]!.setAttribute("aria-pressed", String(s.view.camera === v)));
    counts.textContent = `${s.doc.strokes.length} strokes · ${s.solids.length} solids`;

    if (planeSelect.value !== s.view.plane) planeSelect.value = s.view.plane;
    if (document.activeElement !== offsetRange) offsetRange.value = String(s.view.offset);
    offsetOut.textContent = `${fmt(s.view.offset)} m`;
    const detents = offsetDetents(s.doc.strokes, s.view.plane);
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
      ? "say what to change -- e.g. make it 40 m and hollow it out, 300 mm walls"
      : "what are you drawing? (optional)";
    interpretBtn.disabled = s.session.busy;
    interpretBtn.textContent = s.session.busy
      ? "working"
      : s.session.apiKey
        ? "interpret"
        : "interpret (rules)";

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
