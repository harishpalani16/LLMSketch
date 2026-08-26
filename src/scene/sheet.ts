import * as THREE from "three";
import type { PlaneKey } from "../core/types.ts";
import { PLANES } from "../core/planes.ts";

/**
 * The sheet: the visible drawing plane. It is the signature element of the
 * design language, so it is drawn as a blueprint sheet -- a tinted quad, a
 * 1 m grid, and a brighter pair of axis lines through the origin.
 */

const SIZE = 60;

export class Sheet {
  readonly group = new THREE.Group();
  private quad: THREE.Mesh;
  private grid: THREE.LineSegments;
  private axes: THREE.LineSegments;

  constructor() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    this.quad = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x162034,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.grid = new THREE.LineSegments(
      gridGeometry(SIZE, 1),
      new THREE.LineBasicMaterial({ color: 0x2c3c5c, transparent: true, opacity: 0.85 }),
    );
    this.axes = new THREE.LineSegments(
      axisGeometry(SIZE),
      new THREE.LineBasicMaterial({ color: 0x5ac8e0, transparent: true, opacity: 0.5 }),
    );
    this.group.add(this.quad, this.grid, this.axes);
    this.group.renderOrder = -1;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Orient the sheet to a plane at an offset. u -> local +X, v -> local +Y. */
  place(plane: PlaneKey, offset: number): void {
    const { u, v, n } = PLANES[plane];
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...u),
      new THREE.Vector3(...v),
      new THREE.Vector3(...n),
    );
    this.group.quaternion.setFromRotationMatrix(m);
    this.group.position.set(n[0] * offset, n[1] * offset, n[2] * offset);
  }

  /**
   * Edge-on guard: how square-on the sheet is to the camera, 0 (edge-on) to 1.
   * Drawing is refused below ~0.12 because the projected point is meaningless
   * there -- a millimetre of mouse travel becomes tens of metres.
   */
  facingness(plane: PlaneKey, forward: THREE.Vector3): number {
    const n = new THREE.Vector3(...PLANES[plane].n);
    return Math.abs(n.dot(forward));
  }
}

function gridGeometry(size: number, step: number): THREE.BufferGeometry {
  const half = size / 2;
  const pts: number[] = [];
  for (let i = -half; i <= half; i += step) {
    if (Math.abs(i) < 1e-9) continue;
    pts.push(-half, i, 0.002, half, i, 0.002);
    pts.push(i, -half, 0.002, i, half, 0.002);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function axisGeometry(size: number): THREE.BufferGeometry {
  const half = size / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-half, 0, 0.003, half, 0, 0.003, 0, -half, 0.003, 0, half, 0.003],
      3,
    ),
  );
  return g;
}
