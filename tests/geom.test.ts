import { describe, expect, it } from "vitest";
import { PLANE_KEYS, PLANES, cross, offsetOf, to2D, to3D } from "../src/core/planes.ts";
import { alignRings, polylineLength, rdp, resample, shoelace } from "../src/sketch/geom.ts";
import { beautify } from "../src/sketch/beautify.ts";
import type { Pt2, SketchFrame } from "../src/core/types.ts";

/** SPEC tests 1-5: the verified sketch invariants. */

const rect = (w: number, h: number): Pt2[] => [
  { a: 0, b: 0 },
  { a: w, b: 0 },
  { a: w, b: h },
  { a: 0, b: h },
];

describe("1. plane bases are right-handed", () => {
  it("u x v === n for every plane", () => {
    for (const key of PLANE_KEYS) {
      const { u, v, n } = PLANES[key];
      const c = cross(u, v);
      expect(c[0]).toBeCloseTo(n[0], 12);
      expect(c[1]).toBeCloseTo(n[1], 12);
      expect(c[2]).toBeCloseTo(n[2], 12);
    }
  });

  it("screen-right and screen-up match the documented axes", () => {
    expect(PLANES.ground).toEqual({ u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] });
    expect(PLANES.front).toEqual({ u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });
    expect(PLANES.side).toEqual({ u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] });
  });
});

describe("2. to2D / to3D round-trip", () => {
  it("returns the original point within 1e-9", () => {
    const samples: Pt2[] = [
      { a: 0, b: 0 },
      { a: 12.5, b: -7.25 },
      { a: -3.125, b: 41.0625 },
      { a: 1e-4, b: -1e-4 },
    ];
    for (const key of PLANE_KEYS) {
      for (const offset of [0, 3.5, -12.25]) {
        for (const p of samples) {
          const world = to3D(p, key, offset);
          const back = to2D(world, key);
          expect(Math.abs(back.a - p.a)).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(back.b - p.b)).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(offsetOf(world, key) - offset)).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  it("round-trips an arbitrary saved sketch frame", () => {
    const frame: SketchFrame = {
      u: [Math.SQRT1_2, 0, -Math.SQRT1_2],
      v: [0, 1, 0],
      n: [Math.SQRT1_2, 0, Math.SQRT1_2],
      origin: [4, 7, -3],
    };
    const local = { a: 8.25, b: -2.5 };
    const world = to3D(local, "ground", 0, frame);
    const back = to2D(world, "ground", frame);
    expect(back.a).toBeCloseTo(local.a, 9);
    expect(back.b).toBeCloseTo(local.b, 9);
  });
});

describe("3. resampling a 20x14 rectangle", () => {
  it("keeps the perimeter within 0.5 at 72 points", () => {
    const out = resample(rect(20, 14), 72, true);
    expect(out).toHaveLength(72);
    expect(Math.abs(polylineLength(out, true) - 68)).toBeLessThan(0.5);
  });
});

describe("4. ring alignment", () => {
  it("recovers a reversed and rotated ring with zero drift", () => {
    const base = resample(rect(20, 14), 40, true);
    const rotated = [...base.slice(17), ...base.slice(0, 17)].reverse();
    const [a, b] = alignRings([base, rotated]);
    expect(a).toHaveLength(40);
    expect(b).toHaveLength(40);
    let drift = 0;
    for (let i = 0; i < 40; i++) {
      drift = Math.max(drift, Math.hypot(a![i]!.a - b![i]!.a, a![i]!.b - b![i]!.b));
    }
    expect(drift).toBeLessThan(1e-9);
  });

  it("leaves rings that already share a vertex count unresampled", () => {
    const rings = alignRings([rect(20, 14), rect(10, 7)]);
    expect(rings[0]).toHaveLength(4);
    expect(rings[1]).toHaveLength(4);
  });
});

describe("5. shoelace area", () => {
  it("gives 280 for a 20x14 rectangle", () => {
    expect(shoelace(rect(20, 14))).toBeCloseTo(280, 9);
    expect(shoelace([...rect(20, 14)].reverse())).toBeCloseTo(-280, 9);
  });
});

describe("support: rdp and beautify", () => {
  it("rdp drops collinear points and keeps the ends", () => {
    const line: Pt2[] = Array.from({ length: 40 }, (_, i) => ({ a: i * 0.5, b: 0 }));
    const out = rdp(line, 0.01);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ a: 0, b: 0 });
  });

  it("recognises a wobbly freehand rectangle (SPEC P1)", () => {
    const jitter = (i: number) => Math.sin(i * 2.3) * 0.09;
    const pts: Pt2[] = [];
    const w = 12;
    const h = 8;
    let i = 0;
    for (let t = 0; t <= 1; t += 0.04) pts.push({ a: t * w + jitter(i++), b: jitter(i) });
    for (let t = 0; t <= 1; t += 0.04) pts.push({ a: w + jitter(i++), b: t * h + jitter(i) });
    for (let t = 0; t <= 1; t += 0.04) pts.push({ a: w - t * w + jitter(i++), b: h + jitter(i) });
    for (let t = 0; t <= 1; t += 0.04) pts.push({ a: jitter(i++), b: h - t * h + jitter(i) });
    const fit = beautify(pts, false);
    expect(fit?.kind).toBe("rect");
    expect(fit?.closed).toBe(true);
    expect(fit?.pts).toHaveLength(4);
  });

  it("recognises a freehand circle", () => {
    const pts: Pt2[] = Array.from({ length: 60 }, (_, i) => {
      const t = (i / 60) * Math.PI * 2;
      const r = 5 + Math.sin(i * 1.7) * 0.05;
      return { a: r * Math.cos(t), b: r * Math.sin(t) };
    });
    const fit = beautify(pts, false);
    expect(fit?.kind).toBe("circle");
  });

  it("leaves a genuinely messy stroke alone", () => {
    const pts: Pt2[] = Array.from({ length: 40 }, (_, i) => ({
      a: Math.sin(i * 1.1) * 6 + i * 0.3,
      b: Math.cos(i * 2.7) * 5,
    }));
    expect(beautify(pts, false)).toBeNull();
  });
});
