import * as THREE from "three";
import type { PlaneKey, Pt2, SketchFrame, Stroke } from "../core/types.ts";
import { PLANES, to3D } from "../core/planes.ts";

/**
 * Strokes drawn as pressure ribbons: a triangle strip whose half-width follows
 * the pen pressure, sized in screen pixels so a stroke reads the same at any
 * zoom. Chalk on a blueprint.
 */

const CHALK = 0xe9eef6;
const CYAN = 0x5ac8e0;
const DIM = 0x8598b8;

function ribbon(
  pts: Pt2[],
  closed: boolean,
  plane: PlaneKey,
  offset: number,
  halfWidth: number,
  frame?: SketchFrame,
) {
  const { u, v, n } = frame ?? PLANES[plane];
  const positions: number[] = [];
  const list = closed && pts.length > 2 ? [...pts, pts[0]!] : pts;
  if (list.length < 2) return null;

  const left: Pt2[] = [];
  const right: Pt2[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[Math.max(0, i - 1)]!;
    const b = list[Math.min(list.length - 1, i + 1)]!;
    let dx = b.a - a.a;
    let dy = b.b - a.b;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = halfWidth * (0.55 + 0.9 * (list[i]!.w ?? 0.5));
    left.push({ a: list[i]!.a - dy * w, b: list[i]!.b + dx * w });
    right.push({ a: list[i]!.a + dy * w, b: list[i]!.b - dx * w });
  }

  const at = (p: Pt2) => {
    const q = to3D(p, plane, offset, frame);
    return [q[0] + n[0] * 0.004, q[1] + n[1] * 0.004, q[2] + n[2] * 0.004];
  };
  for (let i = 0; i < list.length - 1; i++) {
    const l0 = at(left[i]!);
    const r0 = at(right[i]!);
    const l1 = at(left[i + 1]!);
    const r1 = at(right[i + 1]!);
    positions.push(...l0, ...r0, ...l1);
    positions.push(...r0, ...r1, ...l1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const nn = new THREE.Vector3(...u).cross(new THREE.Vector3(...v)).toArray();
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    normals[i] = nn[0]!;
    normals[i + 1] = nn[1]!;
    normals[i + 2] = nn[2]!;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geo;
}

interface Entry {
  mesh: THREE.Mesh;
  key: string;
}

export class StrokeLayer {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();
  private live: THREE.Mesh | null = null;

  /** halfWidth is recomputed from the viewport so strokes keep a screen width. */
  halfWidth = 0.05;

  sync(strokes: Stroke[], selected: Set<string>): void {
    const seen = new Set<string>();
    for (const s of strokes) {
      seen.add(s.id);
      const shown = s.fitted === false && s.raw ? s.raw : s.pts;
      const key = `${s.pts.length}:${s.offset}:${s.plane}:${JSON.stringify(s.frame)}:${s.closed}:${s.fitted}:${this.halfWidth.toFixed(4)}:${selected.has(s.id)}:${shown[0]?.a ?? 0}:${shown[shown.length - 1]?.b ?? 0}`;
      const existing = this.entries.get(s.id);
      if (existing && existing.key === key) continue;
      if (existing) this.remove(s.id);
      const geo = ribbon(shown, s.closed, s.plane, s.offset, this.halfWidth, s.frame);
      if (!geo) continue;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: selected.has(s.id) ? CYAN : s.note ? DIM : CHALK,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 3;
      mesh.name = s.id;
      this.group.add(mesh);
      this.entries.set(s.id, { mesh, key });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.remove(id);
  }

  setLive(pts: Pt2[], closed: boolean, plane: PlaneKey, offset: number, frame?: SketchFrame): void {
    this.clearLive();
    const geo = ribbon(pts, closed, plane, offset, this.halfWidth, frame);
    if (!geo) return;
    this.live = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: CYAN, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.live.renderOrder = 4;
    this.group.add(this.live);
  }

  clearLive(): void {
    if (!this.live) return;
    this.group.remove(this.live);
    this.live.geometry.dispose();
    (this.live.material as THREE.Material).dispose();
    this.live = null;
  }

  meshes(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  idOf(object: THREE.Object3D): string | null {
    for (const [id, e] of this.entries) if (e.mesh === object) return id;
    return null;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    this.entries.delete(id);
  }
}
