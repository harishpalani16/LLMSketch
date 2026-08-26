import * as THREE from "three";
import type { PlaneKey, Pt2, Stroke, SubRef } from "../core/types.ts";
import { PLANES } from "../core/planes.ts";
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
  | { kind: "draw"; plane: PlaneKey; offset: number }
  | { kind: "orbit"; x: number; y: number }
  | { kind: "pan"; x: number; y: number }
  | { kind: "move"; last: Pt2 }
  | { kind: "pushpull"; solid: string; select: string; normal: THREE.Vector3; origin: THREE.Vector3 }
  | { kind: "lasso"; from: THREE.Vector2 };

export class SketchCapture {
  private drag: Drag = { kind: "none" };
  private live: Pt2[] = [];
  private filterA = new OneEuro(1.0, 0.007);
  private filterB = new OneEuro(1.0, 0.007);
  private penActive = false;
  private previewDistance = 0;
  private pendingFace: Promise<SubRef | null> | null = null;

  onStatus: (text: string) => void = () => {};
  onPushPullPreview: (distance: number) => void = () => {};

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

  private planePoint(e: PointerEvent, plane: PlaneKey, offset: number): Pt2 | null {
    return pointOnPlane(this.viewport, plane, offset, e.clientX, e.clientY);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === "pen") this.penActive = true;
    if (e.pointerType === "touch" && this.penActive) return;
    this.canvas.setPointerCapture(e.pointerId);

    const camera = e.button === 1 || (e.button === 0 && e.shiftKey && e.altKey);
    if (camera) {
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.drag = { kind: "orbit", x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    const tool = this.view.tool;
    if (tool === "draw") this.startDraw(e);
    else if (tool === "erase") this.eraseAt(e);
    else if (tool === "pushpull") void this.startPushPull(e);
    else this.selectAt(e);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && this.penActive) return;
    switch (this.drag.kind) {
      case "orbit":
        this.viewport.orbit(e.clientX - this.drag.x, e.clientY - this.drag.y);
        this.drag = { kind: "orbit", x: e.clientX, y: e.clientY };
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
      default:
        return;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.drag.kind === "draw") this.commitDraw(this.drag.plane, this.drag.offset);
    else if (this.drag.kind === "pushpull") this.commitPushPull();
    this.drag = { kind: "none" };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

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
  ): { plane: PlaneKey; offset: number; solid: string } | null {
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
    if (!best) return null;
    const pn = PLANES[best].n;
    const offset = first.point.x * pn[0] + first.point.y * pn[1] + first.point.z * pn[2];
    return { plane: best, offset: Math.round(offset * 1000) / 1000, solid: id };
  }

  private startDraw(e: PointerEvent): void {
    const onSolid = this.faceTarget(e);
    const plane = onSolid?.plane ?? this.view.plane;
    const offset = onSolid?.offset ?? this.view.offset;

    if (isEdgeOn(plane, this.viewport)) {
      this.onStatus("that plane is edge-on -- turn the view before drawing");
      return;
    }

    this.pendingFace = null;
    if (onSolid) {
      const hitPoint = this.viewport
        .screenToRay(e.clientX, e.clientY)
        .intersectPlane(
          new THREE.Plane(new THREE.Vector3(...PLANES[plane].n), -offset),
          new THREE.Vector3(),
        );
      if (hitPoint) {
        const solid = onSolid.solid;
        this.pendingFace = kernel()
          .faceAt(solid, [hitPoint.x, hitPoint.y, hitPoint.z])
          .then((f) => (f ? { solid, kind: "face" as const, select: f.select } : null))
          .catch(() => null);
      }
      store.patchView({ plane, offset });
      this.sheet.place(plane, offset);
    }

    this.filterA.reset();
    this.filterB.reset();
    this.live = [];
    this.drag = { kind: "draw", plane, offset };
    this.extendDraw(e);
  }

  private extendDraw(e: PointerEvent): void {
    if (this.drag.kind !== "draw") return;
    const { plane, offset } = this.drag;
    const events =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];
    for (const ev of events) {
      const raw = this.planePoint(ev as PointerEvent, plane, offset);
      if (!raw) continue;
      const t = ev.timeStamp / 1000;
      const filtered: Pt2 = {
        a: this.filterA.filter(raw.a, t),
        b: this.filterB.filter(raw.b, t),
        w: ev.pressure > 0 ? ev.pressure : 0.5,
      };
      const result = this.view.snap
        ? snap(filtered, {
            strokes: store.get().doc.strokes,
            plane,
            offset,
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
        this.commitDraw(plane, offset, true);
        this.drag = { kind: "none" };
        return;
      }
    }
    this.strokes.setLive(this.live, false, plane, offset);
    this.viewport.invalidate();
  }

  private commitDraw(plane: PlaneKey, offset: number, forceClosed = false): void {
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
    const fit = beautify(simplified, forceClosed);
    const closed = forceClosed || (fit?.closed ?? false);
    const finalPts = fit ? fit.pts : simplified;

    const doc = store.get().doc;
    const stroke: Stroke = {
      id: nextStrokeId(doc.strokes),
      plane,
      offset,
      pts: finalPts,
      closed,
      kind: fit ? fit.kind : "freehand",
      order: doc.strokes.length,
      raw: fit ? simplified : undefined,
      fitted: fit ? true : undefined,
      metrics: strokeMetrics(finalPts, closed, plane, offset),
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
        : [strokeId];
      store.select({ strokes: next, solids: [] });
      return;
    }
    const solid = this.raycastSolid(e);
    if (solid) {
      const node = store.get().solids.find((s) => s.id === solid.id)?.node ?? null;
      store.select({ solids: [solid.id], strokes: [], node });
      return;
    }
    store.select({ strokes: [], solids: [], node: null });
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
