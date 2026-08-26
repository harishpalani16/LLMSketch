import * as THREE from "three";
import type { PlaneKey, Pt2, SketchFrame, Stroke, SubRef } from "../core/types.ts";
import { basisFromNormal, PLANES } from "../core/planes.ts";
import { store } from "../state.ts";
import { kernel } from "../kernel/api.ts";
import { nextStrokeId } from "../graph/model.ts";
import type { Viewport } from "../scene/viewport.ts";
import type { Sheet } from "../scene/sheet.ts";
import type { Display } from "../scene/display.ts";
import type { StrokeLayer } from "./render.ts";
import { isEdgeOn, pointOnPlane, snap } from "../scene/picking.ts";
import { OneEuro, bboxDiagonal, rdp, strokeMetrics } from "./geom.ts";
import { beautify } from "./beautify.ts";

/**
 * Pointer capture and the direct-manipulation tools (SPEC §5).
 *
 * Pen pressure and coalesced events are used when the device reports them;
 * touch is ignored while a pen is active (palm rejection).
 */

const MIN_DIAGONAL = 0.6;
const RDP_EPS_PX = 1.6;

type Drag =
  | { kind: "none" }
  | {
      kind: "draw";
      plane: PlaneKey;
      offset: number;
      mode: "draw" | "line" | "rect" | "circle";
      start?: Pt2;
      frame?: SketchFrame;
    }
  | { kind: "orbit"; x: number; y: number; force: boolean }
  | { kind: "pan"; x: number; y: number }
  | { kind: "move"; ids: string[]; plane: PlaneKey; offset: number; frame?: SketchFrame; last: Pt2 }
  | { kind: "pushpull"; solid: string; select: string; normal: THREE.Vector3; origin: THREE.Vector3 }
  | { kind: "marquee"; from: { x: number; y: number } };

export class SketchCapture {
  private drag: Drag = { kind: "none" };
  private live: Pt2[] = [];
  private filterA = new OneEuro(1.0, 0.007);
  private filterB = new OneEuro(1.0, 0.007);
  private penPointers = new Set<number>();
  private touches = new Map<number, { x: number; y: number }>();
  private ignoredTouchPointers = new Set<number>();
  private gestureTouches = new Set<number>();
  private touchGesture: { distance: number; x: number; y: number } | null = null;
  private previewDistance = 0;
  private pendingFace: Promise<SubRef | null> | null = null;

  onStatus: (text: string) => void = () => {};
  onPushPullPreview: (distance: number) => void = () => {};
  onMarquee: (box: { x: number; y: number; w: number; h: number } | null) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private viewport: Viewport,
    private sheet: Sheet,
    private strokes: StrokeLayer,
    private display: Display,
  ) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private get view() {
    return store.get().view;
  }


  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === "pen") {
      this.penPointers.add(e.pointerId);
      if (this.touches.size) {
        for (const id of this.touches.keys()) this.ignoredTouchPointers.add(id);
        this.touches.clear();
        this.touchGesture = null;
        this.cancelDirectGesture();
      }
    }
    if (e.pointerType === "touch") {
      if (this.penPointers.size) {
        this.ignoredTouchPointers.add(e.pointerId);
        return;
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        this.beginTouchGesture();
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    this.canvas.setPointerCapture(e.pointerId);

    const camera = e.button === 1 || (e.button === 0 && e.shiftKey && e.altKey);
    if (camera) {
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.drag = { kind: "orbit", x: e.clientX, y: e.clientY, force: false };
      return;
    }
    if (e.button !== 0) return;

    const tool = this.view.tool;
    if (tool === "orbit") {
      store.patchView({ camera: "iso" });
      this.drag = { kind: "orbit", x: e.clientX, y: e.clientY, force: true };
    } else if (tool === "draw" || tool === "line" || tool === "rect" || tool === "circle") this.startDraw(e);
    else if (tool === "erase") this.eraseAt(e);
    else if (tool === "pushpull") void this.startPushPull(e);
    else this.selectAt(e);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      if (this.ignoredTouchPointers.has(e.pointerId)) return;
      if (this.penPointers.size) return;
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchGesture) {
        this.updateTouchGesture();
        return;
      }
    }
    switch (this.drag.kind) {
      case "orbit":
        this.viewport.orbit(e.clientX - this.drag.x, e.clientY - this.drag.y, this.drag.force);
        this.drag = { kind: "orbit", x: e.clientX, y: e.clientY, force: this.drag.force };
        return;
      case "pan":
        this.viewport.pan(e.clientX - this.drag.x, e.clientY - this.drag.y);
        this.drag = { kind: "pan", x: e.clientX, y: e.clientY };
        return;
      case "draw":
        this.extendDraw(e);
        return;
      case "pushpull":
        this.dragPushPull(e);
        return;
      case "move":
        this.dragMove(e);
        return;
      case "marquee":
        this.dragMarquee(e);
        return;
      default:
        return;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === "pen") this.penPointers.delete(e.pointerId);
    if (e.pointerType === "touch") {
      if (this.ignoredTouchPointers.delete(e.pointerId)) return;
      this.touches.delete(e.pointerId);
      if (this.gestureTouches.has(e.pointerId)) {
        this.gestureTouches.delete(e.pointerId);
        if (this.touches.size < 2) this.touchGesture = null;
        if (!this.gestureTouches.size) this.onStatus("ready");
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
        return;
      }
    }
    if (this.drag.kind === "draw")
      this.commitDraw(this.drag.plane, this.drag.offset, false, this.drag.mode, this.drag.frame);
    else if (this.drag.kind === "pushpull") this.commitPushPull();
    else if (this.drag.kind === "move") store.endGesture();
    else if (this.drag.kind === "marquee") this.commitMarquee(e);
    this.drag = { kind: "none" };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  private beginTouchGesture(): void {
    this.cancelDirectGesture();
    for (const id of this.touches.keys()) this.gestureTouches.add(id);
    const pair = this.touchPair();
    if (!pair) return;
    this.touchGesture = pair;
    this.onStatus("two fingers — pan and pinch to zoom");
  }

  private updateTouchGesture(): void {
    const next = this.touchPair();
    const previous = this.touchGesture;
    if (!next || !previous) return;
    this.viewport.pan(next.x - previous.x, next.y - previous.y);
    if (next.distance > 1 && previous.distance > 1) {
      this.viewport.zoom(Math.log(previous.distance / next.distance) / 0.0016);
    }
    this.touchGesture = next;
  }

  private touchPair(): { distance: number; x: number; y: number } | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  private cancelDirectGesture(): void {
    if (this.drag.kind === "draw") {
      this.live = [];
      this.strokes.clearLive();
      this.pendingFace = null;
    } else if (this.drag.kind === "move") {
      store.endGesture();
    } else if (this.drag.kind === "marquee") {
      this.onMarquee(null);
    } else if (this.drag.kind === "pushpull") {
      this.onPushPullPreview(0);
    }
    this.drag = { kind: "none" };
    this.viewport.invalidate();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.viewport.zoom(e.deltaY);
  };

  /* ------------------------------------------------------------------ draw */

  /**
   * SPEC §5.6 -- a stroke starting on a solid's face is captured in that face's
   * plane. The plane is derived locally from the triangle normal so the first
   * point is never lost waiting on the worker; the semantic selector for
   * `onFace` is resolved in parallel and attached when the stroke commits.
   */
  private faceTarget(
    e: PointerEvent,
  ): { plane: PlaneKey; offset: number; solid: string; frame?: SketchFrame } | null {
    const caster = this.viewport.raycaster(e.clientX, e.clientY);
    const hits = caster.intersectObjects(this.display.meshes(), false);
    const first = hits[0];
    if (!first?.face) return null;
    const id = this.display.idOf(first.object);
    if (!id) return null;
    const n = first.face.normal.clone().normalize();
    let best: PlaneKey | null = null;
    let bestDot = 0.94;
    for (const key of ["ground", "front", "side"] as PlaneKey[]) {
      const d = Math.abs(n.dot(new THREE.Vector3(...PLANES[key].n)));
      if (d > bestDot) {
        bestDot = d;
        best = key;
      }
    }
    if (!best) {
      const basis = basisFromNormal([n.x, n.y, n.z]);
      return {
        plane: this.view.plane,
        offset: 0,
        solid: id,
        frame: {
          ...basis,
          origin: [first.point.x, first.point.y, first.point.z],
        },
      };
    }
    const pn = PLANES[best].n;
    const offset = first.point.x * pn[0] + first.point.y * pn[1] + first.point.z * pn[2];
    return { plane: best, offset: Math.round(offset * 1000) / 1000, solid: id };
  }

  private startDraw(e: PointerEvent): void {
    const onSolid = this.faceTarget(e);
    if (this.view.workplaneMode === "face" && !onSolid) {
      this.onStatus("start the sketch on a model face");
      return;
    }
    const plane = onSolid?.plane ?? this.view.plane;
    const frame = onSolid?.frame ?? (this.view.workplaneMode === "view" ? this.viewport.viewFrame(this.view.offset) : undefined);
    const offset = frame ? 0 : (onSolid?.offset ?? this.view.offset);

    if (isEdgeOn(plane, this.viewport, frame)) {
      this.onStatus("that plane is edge-on -- turn the view before drawing");
      return;
    }

    this.pendingFace = null;
    if (onSolid) {
      const n = frame?.n ?? PLANES[plane].n;
      const origin = frame?.origin ?? [n[0] * offset, n[1] * offset, n[2] * offset];
      const hitPoint = this.viewport.screenToRay(e.clientX, e.clientY).intersectPlane(
        new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...n), new THREE.Vector3(...origin)),
        new THREE.Vector3(),
      );
      if (hitPoint) {
        const solid = onSolid.solid;
        this.pendingFace = kernel()
          .faceAt(solid, [hitPoint.x, hitPoint.y, hitPoint.z])
          .then((f) => (f ? { solid, kind: "face" as const, select: f.select } : null))
          .catch(() => null);
      }
      if (!frame) store.patchView({ plane, offset, workplaneMode: "axis" });
      if (frame) this.sheet.placeFrame(frame);
      else this.sheet.place(plane, offset);
    }

    this.filterA.reset();
    this.filterB.reset();
    this.live = [];
    const mode = this.view.tool;
    if (mode !== "draw" && mode !== "line" && mode !== "rect" && mode !== "circle") return;
    this.drag = { kind: "draw", plane, offset, mode, frame };
    this.extendDraw(e);
  }

  private extendDraw(e: PointerEvent): void {
    if (this.drag.kind !== "draw") return;
    const { plane, offset, frame } = this.drag;
    if (this.drag.mode !== "draw") {
      const mode = this.drag.mode;
      const raw = pointOnPlane(this.viewport, plane, offset, e.clientX, e.clientY, frame);
      if (!raw) return;
      const result = this.view.snap
        ? snap(raw, {
            strokes: store.get().doc.strokes,
            plane,
            offset,
            frame,
            ppu: this.viewport.pixelsPerUnit(),
            gridStep: 0.5,
            axisLock: e.shiftKey,
            livePts: this.drag.start ? [this.drag.start] : [],
          })
        : { point: raw };
      const point = result.point;
      const start = this.drag.start ?? point;
      this.drag = { ...this.drag, start };
      this.live = primitivePoints(mode, start, point);
      this.strokes.setLive(this.live, mode !== "line", plane, offset, frame);
      this.viewport.invalidate();
      return;
    }
    const events =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];
    for (const ev of events) {
      // Smoothing happens in screen space: the one-euro constants are tuned for
      // pixels, and a pointer that moves 400 px/s moves only 4 m/s, so filtering
      // metres would leave the adaptive cutoff permanently asleep and the stroke
      // lagging far behind the pen.
      const t = ev.timeStamp / 1000;
      const sx = this.filterA.filter(ev.clientX, t);
      const sy = this.filterB.filter(ev.clientY, t);
      const raw = pointOnPlane(this.viewport, plane, offset, sx, sy, frame);
      if (!raw) continue;
      const filtered: Pt2 = { ...raw, w: ev.pressure > 0 ? ev.pressure : 0.5 };
      const result = this.view.snap
        ? snap(filtered, {
            strokes: store.get().doc.strokes,
            plane,
            offset,
            frame,
            ppu: this.viewport.pixelsPerUnit(),
            gridStep: 0.5,
            axisLock: e.shiftKey,
            livePts: this.live,
          })
        : { point: filtered, kind: "free" as const };
      const point = { ...result.point, w: filtered.w };
      const last = this.live[this.live.length - 1];
      if (last && Math.hypot(point.a - last.a, point.b - last.b) < 1e-4) continue;
      this.live.push(point);
      if (result.kind === "close" && this.live.length > 8) {
        this.commitDraw(plane, offset, true, "draw", frame);
        this.drag = { kind: "none" };
        return;
      }
    }
    this.strokes.setLive(this.live, false, plane, offset, frame);
    this.viewport.invalidate();
  }

  private commitDraw(
    plane: PlaneKey,
    offset: number,
    forceClosed = false,
    mode: "draw" | "line" | "rect" | "circle" = "draw",
    frame?: SketchFrame,
  ): void {
    const pts = this.live;
    this.live = [];
    this.strokes.clearLive();
    if (pts.length < 2) return;
    if (bboxDiagonal(pts) < MIN_DIAGONAL) {
      this.onStatus("that stroke was too small to keep");
      this.viewport.invalidate();
      return;
    }

    const eps = RDP_EPS_PX / Math.max(1e-6, this.viewport.pixelsPerUnit());
    const simplified = rdp(pts, eps);
    const fit = mode === "draw" ? beautify(simplified, forceClosed) : null;
    const closed = mode === "rect" || mode === "circle" || forceClosed || (fit?.closed ?? false);
    const finalPts = fit ? fit.pts : simplified;
    const kind = mode === "draw" ? (fit?.kind ?? "freehand") : mode;

    const doc = store.get().doc;
    const stroke: Stroke = {
      id: nextStrokeId(doc.strokes),
      plane,
      offset,
      frame,
      pts: finalPts,
      closed,
      kind,
      order: doc.strokes.length,
      raw: fit ? simplified : undefined,
      fitted: fit ? true : undefined,
      metrics: strokeMetrics(finalPts, closed, plane, offset, frame),
    };
    store.addStroke(stroke);
    if (this.pendingFace) {
      const pending = this.pendingFace;
      this.pendingFace = null;
      void pending.then((ref) => {
        if (ref) store.updateStroke(stroke.id, (s) => ({ ...s, onFace: ref }));
      });
    }
    this.onStatus(
      `${stroke.id} ${closed ? "closed" : "open"} ${stroke.kind} ` +
        `${stroke.metrics.w.toFixed(1)}x${stroke.metrics.h.toFixed(1)} m`,
    );
    this.viewport.invalidate();
  }

  /* ---------------------------------------------------------------- select */

  private raycastSolid(e: PointerEvent): { id: string; point: THREE.Vector3 } | null {
    const caster = this.viewport.raycaster(e.clientX, e.clientY);
    const hits = caster.intersectObjects(this.display.meshes(), false);
    const first = hits[0];
    if (!first) return null;
    const id = this.display.idOf(first.object);
    return id ? { id, point: first.point } : null;
  }

  private raycastStroke(e: PointerEvent): string | null {
    const caster = this.viewport.raycaster(e.clientX, e.clientY);
    const hits = caster.intersectObjects(this.strokes.meshes(), false);
    const first = hits[0];
    return first ? this.strokes.idOf(first.object) : null;
  }

  private selectAt(e: PointerEvent): void {
    const strokeId = this.raycastStroke(e);
    if (strokeId) {
      const current = store.get().selection.strokes;
      const next = e.shiftKey
        ? current.includes(strokeId)
          ? current.filter((s) => s !== strokeId)
          : [...current, strokeId]
        : current.includes(strokeId)
          ? current
          : [strokeId];
      store.select({ strokes: next, solids: [] });
      this.startMove(e, next);
      return;
    }
    const solid = this.raycastSolid(e);
    if (solid) {
      const node = store.get().solids.find((s) => s.id === solid.id)?.node ?? null;
      store.select({ solids: [solid.id], strokes: [], node });
      return;
    }
    if (!e.shiftKey) store.select({ strokes: [], solids: [], node: null });
    this.drag = { kind: "marquee", from: { x: e.clientX, y: e.clientY } };
    this.onMarquee({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  /** Drag selected strokes about within their own plane (SPEC §5.4). */
  private startMove(e: PointerEvent, ids: string[]): void {
    const strokes = store.get().doc.strokes.filter((s) => ids.includes(s.id));
    const first = strokes[0];
    if (!first) return;
    // a multi-plane selection has no shared plane to drag in
    if (strokes.some((s) => !sameFrame(s, first))) return;
    const at = pointOnPlane(this.viewport, first.plane, first.offset, e.clientX, e.clientY, first.frame);
    if (!at) return;
    store.beginGesture();
    this.drag = { kind: "move", ids, plane: first.plane, offset: first.offset, frame: first.frame, last: at };
  }

  private dragMove(e: PointerEvent): void {
    if (this.drag.kind !== "move") return;
    const at = pointOnPlane(this.viewport, this.drag.plane, this.drag.offset, e.clientX, e.clientY, this.drag.frame);
    if (!at) return;
    store.moveStrokes(this.drag.ids, at.a - this.drag.last.a, at.b - this.drag.last.b, {
      silent: true,
    });
    this.drag = { ...this.drag, last: at };
  }

  /** Marquee select: everything whose centroid falls inside the box. */
  private dragMarquee(e: PointerEvent): void {
    if (this.drag.kind !== "marquee") return;
    const { from } = this.drag;
    this.onMarquee({
      x: Math.min(from.x, e.clientX),
      y: Math.min(from.y, e.clientY),
      w: Math.abs(e.clientX - from.x),
      h: Math.abs(e.clientY - from.y),
    });
  }

  private commitMarquee(e: PointerEvent): void {
    if (this.drag.kind !== "marquee") return;
    const { from } = this.drag;
    this.onMarquee(null);
    const lo = { x: Math.min(from.x, e.clientX), y: Math.min(from.y, e.clientY) };
    const hi = { x: Math.max(from.x, e.clientX), y: Math.max(from.y, e.clientY) };
    if (hi.x - lo.x < 4 && hi.y - lo.y < 4) return;
    const rect = this.canvas.getBoundingClientRect();
    const hits = store
      .get()
      .doc.strokes.filter((s) => {
        const p = this.viewport.worldToScreen(
          new THREE.Vector3(...s.metrics.centroid),
        );
        const x = p.x + rect.left;
        const y = p.y + rect.top;
        return x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y;
      })
      .map((s) => s.id);
    const keep = e.shiftKey ? store.get().selection.strokes : [];
    store.select({ strokes: [...new Set([...keep, ...hits])], solids: [], node: null });
  }

  private eraseAt(e: PointerEvent): void {
    const strokeId = this.raycastStroke(e);
    if (strokeId) store.removeStrokes([strokeId]);
  }

  /* -------------------------------------------------------------- pushpull */

  private async startPushPull(e: PointerEvent): Promise<void> {
    const hit = this.raycastSolid(e);
    if (!hit) return;
    const face = await kernel().faceAt(hit.id, [hit.point.x, hit.point.y, hit.point.z]);
    if (!face) {
      this.onStatus("no face under the pointer");
      return;
    }
    this.drag = {
      kind: "pushpull",
      solid: hit.id,
      select: face.select,
      normal: new THREE.Vector3(...face.normal),
      origin: hit.point.clone(),
    };
    this.previewDistance = 0;
    this.onStatus(`push/pull ${hit.id} ${face.select}`);
  }

  private dragPushPull(e: PointerEvent): void {
    if (this.drag.kind !== "pushpull") return;
    const ray = this.viewport.screenToRay(e.clientX, e.clientY);
    // closest point between the pointer ray and the face-normal axis
    const w0 = this.drag.origin.clone().sub(ray.origin);
    const u = this.drag.normal;
    const v = ray.direction;
    const b = u.dot(v);
    const d = u.dot(w0);
    const eDot = v.dot(w0);
    const denom = 1 - b * b;
    const t = Math.abs(denom) < 1e-6 ? d : (d - b * eDot) / denom;
    this.previewDistance = Math.round(t * 10) / 10;
    this.onPushPullPreview(this.previewDistance);
  }

  private commitPushPull(): void {
    if (this.drag.kind !== "pushpull") return;
    const distance = this.previewDistance;
    this.onPushPullPreview(0);
    if (Math.abs(distance) < 0.05) return;
    store.applyOp("push_pull", {
      face: { solid: this.drag.solid, kind: "face", select: this.drag.select },
      distance,
    });
    this.onStatus(`push/pull ${distance} m`);
  }
}

function primitivePoints(mode: "line" | "rect" | "circle", start: Pt2, end: Pt2): Pt2[] {
  if (mode === "line") return [{ ...start }, { ...end }];
  if (mode === "rect") {
    return [
      { ...start },
      { a: end.a, b: start.b },
      { ...end },
      { a: start.a, b: end.b },
    ];
  }
  const radius = Math.hypot(end.a - start.a, end.b - start.b);
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    return { a: start.a + Math.cos(t) * radius, b: start.b + Math.sin(t) * radius };
  });
}

function sameFrame(a: Stroke, b: Stroke): boolean {
  if (a.plane !== b.plane || Math.abs(a.offset - b.offset) > 1e-6) return false;
  if (Boolean(a.frame) !== Boolean(b.frame)) return false;
  if (!a.frame || !b.frame) return true;
  const av = [...a.frame.n, ...a.frame.origin];
  const bv = [...b.frame.n, ...b.frame.origin];
  return av.every((value, i) => Math.abs(value - bv[i]!) < 1e-5);
}
