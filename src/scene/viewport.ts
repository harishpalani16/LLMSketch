import * as THREE from "three";
import type { ViewKey } from "../state.ts";
import type { Vec3 } from "../core/planes.ts";

/**
 * Four views with animated transitions and per-view up vectors (SPEC §15 P0).
 * One orthographic camera is tweened between presets; screen-right and
 * screen-up in each axis view match the u/v of the corresponding sketch plane,
 * which is what makes drawing feel like drawing on paper.
 */

interface Preset {
  dir: Vec3;
  up: Vec3;
  /** axis views lock orbiting; iso allows it */
  locked: boolean;
}

export const PRESETS: Record<ViewKey, Preset> = {
  iso: { dir: [1, 0.85, 1], up: [0, 1, 0], locked: false },
  top: { dir: [0, 1, 0], up: [0, 0, -1], locked: true },
  front: { dir: [0, 0, 1], up: [0, 1, 0], locked: true },
  side: { dir: [1, 0, 0], up: [0, 1, 0], locked: true },
};

const reduceMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  target = new THREE.Vector3(0, 2, 0);
  distance = 40;
  /** view height in world units; ortho zoom */
  extent = 30;

  private dir = new THREE.Vector3(1, 0.85, 1).normalize();
  private up = new THREE.Vector3(0, 1, 0);
  private tween: {
    from: { dir: THREE.Vector3; up: THREE.Vector3; extent: number; target: THREE.Vector3 };
    to: { dir: THREE.Vector3; up: THREE.Vector3; extent: number; target: THREE.Vector3 };
    t: number;
    ms: number;
  } | null = null;

  view: ViewKey = "iso";
  private needsRender = true;
  private onFrame: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0f1729);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    this.scene.add(new THREE.AmbientLight(0xdce6f5, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(30, 60, 25);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc4e8, 0.6);
    fill.position.set(-40, 20, -30);
    this.scene.add(fill);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.loop();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  addFrameHook(fn: () => void): void {
    this.onFrame.push(fn);
  }

  get locked(): boolean {
    return PRESETS[this.view].locked;
  }

  /** World-space forward vector (from the camera towards the target). */
  forward(): THREE.Vector3 {
    return this.dir.clone().negate();
  }

  setView(view: ViewKey, focus?: THREE.Vector3): void {
    const preset = PRESETS[view];
    this.view = view;
    const to = {
      dir: new THREE.Vector3(...preset.dir).normalize(),
      up: new THREE.Vector3(...preset.up),
      extent: this.extent,
      target: (focus ?? this.target).clone(),
    };
    if (reduceMotion()) {
      this.dir.copy(to.dir);
      this.up.copy(to.up);
      this.target.copy(to.target);
      this.tween = null;
      this.invalidate();
      return;
    }
    this.tween = {
      from: { dir: this.dir.clone(), up: this.up.clone(), extent: this.extent, target: this.target.clone() },
      to,
      t: 0,
      ms: 420,
    };
    this.invalidate();
  }

  orbit(dx: number, dy: number): void {
    if (this.locked) return;
    const spherical = new THREE.Spherical().setFromVector3(this.dir);
    spherical.theta -= dx * 0.008;
    spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi - dy * 0.008));
    this.dir.setFromSpherical(spherical).normalize();
    this.view = "iso";
    this.invalidate();
  }

  pan(dx: number, dy: number): void {
    const right = new THREE.Vector3().crossVectors(this.forward(), this.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, this.forward()).normalize();
    const scale = this.extent / this.canvas.clientHeight;
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(up, dy * scale);
    this.invalidate();
  }

  zoom(delta: number): void {
    this.extent = Math.min(2000, Math.max(0.6, this.extent * Math.exp(delta * 0.0016)));
    this.invalidate();
  }

  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    box.getCenter(this.target);
    this.extent = Math.max(4, box.getSize(new THREE.Vector3()).length() * 0.75);
    this.invalidate();
  }

  /** Screen pixels per world unit at the current zoom. */
  pixelsPerUnit(): number {
    return this.canvas.clientHeight / this.extent;
  }

  screenToRay(x: number, y: number): THREE.Ray {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster.ray.clone();
  }

  raycaster(x: number, y: number): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    const r = new THREE.Raycaster();
    r.setFromCamera(ndc, this.camera);
    return r;
  }

  worldToScreen(p: THREE.Vector3): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height);
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.invalidate();
  }

  private updateCamera(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const aspect = w / h;
    this.camera.left = (-this.extent * aspect) / 2;
    this.camera.right = (this.extent * aspect) / 2;
    this.camera.top = this.extent / 2;
    this.camera.bottom = -this.extent / 2;
    this.camera.near = 0.1;
    this.camera.far = this.distance * 40;
    this.camera.position.copy(this.target).addScaledVector(this.dir, this.distance * 10);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + 16.7 / this.tween.ms);
      const k = easeInOut(this.tween.t);
      this.dir.copy(this.tween.from.dir).lerp(this.tween.to.dir, k).normalize();
      this.up.copy(this.tween.from.up).lerp(this.tween.to.up, k).normalize();
      this.target.copy(this.tween.from.target).lerp(this.tween.to.target, k);
      if (this.tween.t >= 1) {
        this.up.copy(this.tween.to.up);
        this.dir.copy(this.tween.to.dir);
        this.tween = null;
      }
      this.needsRender = true;
    }
    if (!this.needsRender) return;
    this.needsRender = false;
    for (const fn of this.onFrame) fn();
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };
}
