import * as THREE from "three";
import type { Solid } from "../core/types.ts";

/**
 * Kernel tessellation -> Three meshes plus edge lines. Kept solids are plaster
 * with dark edges; ghosts (ops proposed by the current LLM turn) are cyan.
 */

const PLASTER = 0xe9e2d4;
const CYAN = 0x5ac8e0;
const EDGE = 0x1d2a44;

function solidMaterial(ghost: boolean, selected: boolean): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: ghost ? CYAN : PLASTER,
    roughness: 0.72,
    metalness: 0.02,
    transparent: ghost,
    opacity: ghost ? 0.55 : 1,
    emissive: selected ? new THREE.Color(0x5ac8e0) : new THREE.Color(0x000000),
    emissiveIntensity: selected ? 0.22 : 0,
    flatShading: false,
  });
}

interface Entry {
  mesh: THREE.Mesh;
  lines: THREE.LineSegments;
  tess: Solid["tess"];
  ghost: boolean;
  selected: boolean;
}

export class Display {
  readonly group = new THREE.Group();
  private entries = new Map<string, Entry>();

  /** Rebuild only what changed; unchanged solids keep their GPU buffers. */
  sync(solids: Solid[], ghostNodes: Set<string>, selected: Set<string>): void {
    const seen = new Set<string>();
    for (const solid of solids) {
      seen.add(solid.id);
      const ghost = ghostNodes.has(solid.node);
      const isSel = selected.has(solid.id);
      const existing = this.entries.get(solid.id);
      if (existing && existing.tess === solid.tess) {
        if (existing.ghost !== ghost || existing.selected !== isSel) {
          existing.mesh.material = solidMaterial(ghost, isSel);
          (existing.lines.material as THREE.LineBasicMaterial).color.set(ghost ? CYAN : EDGE);
          existing.ghost = ghost;
          existing.selected = isSel;
        }
        continue;
      }
      if (existing) this.dispose(solid.id);
      this.entries.set(solid.id, this.make(solid, ghost, isSel));
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.dispose(id);
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const e of this.entries.values()) box.expandByObject(e.mesh);
    return box;
  }

  meshes(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  idOf(object: THREE.Object3D): string | null {
    for (const [id, e] of this.entries) if (e.mesh === object) return id;
    return null;
  }

  private make(solid: Solid, ghost: boolean, selected: boolean): Entry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(solid.tess.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(solid.tess.normals, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, solidMaterial(ghost, selected));
    mesh.name = solid.id;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(solid.tess.edges, 3));
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: ghost ? CYAN : EDGE }),
    );
    lines.renderOrder = 2;

    this.group.add(mesh, lines);
    return { mesh, lines, tess: solid.tess, ghost, selected };
  }

  private dispose(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.mesh, e.lines);
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    e.lines.geometry.dispose();
    (e.lines.material as THREE.Material).dispose();
    this.entries.delete(id);
  }
}

/** Cyan highlight for a resolved selector (SPEC §7). */
export class Highlight {
  readonly group = new THREE.Group();
  private material = new THREE.LineBasicMaterial({ color: 0x5ac8e0, depthTest: false });

  constructor() {
    this.group.renderOrder = 10;
  }

  show(polylines: number[][]): void {
    this.clear();
    for (const poly of polylines) {
      const pts: number[] = [];
      for (let i = 0; i + 5 < poly.length; i += 3) {
        pts.push(poly[i]!, poly[i + 1]!, poly[i + 2]!, poly[i + 3]!, poly[i + 4]!, poly[i + 5]!);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.group.add(new THREE.LineSegments(g, this.material));
    }
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.LineSegments).geometry.dispose();
    }
  }
}
