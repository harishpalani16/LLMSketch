import type { Doc, Stroke } from "../core/types.ts";
import { circularity, straightness } from "../sketch/beautify.ts";
import { centroid2 } from "../sketch/geom.ts";

/**
 * SPEC §10 -- the no-key interpreter. It emits exactly the same op JSON as the
 * model and runs down exactly the same execution path, so the app is fully
 * functional without an API key. It never emits selectors or `edit`:
 * kernel-simple ops only.
 */

export interface HeuristicOp {
  op: string;
  params: Record<string, unknown>;
  /** shown in the status line so the reasoning is legible */
  because: string;
}

const isGround = (s: Stroke) => s.plane === "ground";
const maxDim = (s: Stroke) => Math.max(s.metrics.w, s.metrics.h);

/** Do two outlines on the same plane sit over one another? */
function overlaps(a: Stroke, b: Stroke): boolean {
  const ca = centroid2(a.pts);
  const cb = centroid2(b.pts);
  const reach = Math.max(maxDim(a), maxDim(b)) * 0.5;
  return Math.hypot(ca.a - cb.a, ca.b - cb.b) <= reach;
}

export function interpret(doc: Doc): HeuristicOp[] {
  const strokes = [...doc.strokes].sort((a, b) => a.order - b.order);
  const used = new Set<string>();
  const ops: HeuristicOp[] = [];

  const closed = strokes.filter((s) => s.closed);
  const open = strokes.filter((s) => !s.closed);

  // 1. closed outlines that sit over one another at different levels -> loft.
  //    Proximity matters: two outlines on opposite corners of the sheet are two
  //    separate things, not the bottom and top of one tower.
  for (const plane of ["ground", "front", "side"] as const) {
    const onPlane = closed
      .filter((s) => s.plane === plane && !used.has(s.id))
      .sort((a, b) => a.offset - b.offset);
    for (const seed of onPlane) {
      if (used.has(seed.id)) continue;
      const stack = onPlane.filter((s) => !used.has(s.id) && overlaps(seed, s));
      const levels = new Set(stack.map((s) => Math.round(s.offset * 100)));
      if (stack.length < 2 || levels.size < 2) continue;
      for (const s of stack) used.add(s.id);
      ops.push({
        op: "loft",
        params: { strokes: stack.map((s) => s.id), ruled: false },
        because: `${stack.map((s) => s.id).join(", ")} stack over one another on the ${plane} plane`,
      });
    }
  }

  // 2. a vertical closed profile plus a long ground rail -> sweep
  const rails = open.filter((s) => isGround(s) && s.metrics.len > 4);
  const profiles = closed.filter((s) => !isGround(s) && !used.has(s.id));
  if (rails.length && profiles.length) {
    const rail = rails[0]!;
    const profile = profiles[0]!;
    used.add(rail.id);
    used.add(profile.id);
    ops.push({
      op: "sweep",
      params: { profile: profile.id, rail: rail.id, keep_normal: false },
      because: `${profile.id} is a standing profile and ${rail.id} is a long path`,
    });
  }

  // 3. closed outline + a rising open stroke near it -> extrude to that span
  for (const c of closed) {
    if (used.has(c.id)) continue;
    const riser = open.find(
      (o) =>
        !used.has(o.id) &&
        o.plane !== c.plane &&
        o.metrics.h > o.metrics.w * 1.5 &&
        o.metrics.h > 0.8 &&
        straightness(o.pts) > 0.9,
    );
    if (riser) {
      used.add(c.id);
      used.add(riser.id);
      ops.push({
        op: "extrude",
        params: { stroke: c.id, height: round(riser.metrics.h), taper: 0 },
        because: `${riser.id} rises ${round(riser.metrics.h)} m next to ${c.id}`,
      });
      continue;
    }

    // 4. strongly circular -> cylinder
    if (circularity(c.pts) > 0.9 || c.kind === "circle") {
      used.add(c.id);
      ops.push({
        op: "cylinder",
        params: { stroke: c.id, height: round(maxDim(c) * 0.55) },
        because: `${c.id} reads as a circle`,
      });
      continue;
    }

    // 5. lone closed outline -> extrude to 0.55 x its larger footprint dimension
    used.add(c.id);
    ops.push({
      op: "extrude",
      params: { stroke: c.id, height: round(maxDim(c) * 0.55), taper: 0 },
      because: `${c.id} is a closed outline on its own`,
    });
  }

  // 6. flat open polyline on the ground -> wall
  for (const o of open) {
    if (used.has(o.id)) continue;
    if (isGround(o) && o.metrics.len > 1.5) {
      used.add(o.id);
      ops.push({
        op: "wall",
        params: { stroke: o.id, height: 3.2, thickness: 0.25 },
        because: `${o.id} is a flat line on the ground`,
      });
    }
  }

  // 7. anything still open -> pipe
  for (const o of open) {
    if (used.has(o.id)) continue;
    used.add(o.id);
    ops.push({
      op: "pipe",
      params: { stroke: o.id, radius: Math.max(0.1, round(o.metrics.len * 0.03)) },
      because: `${o.id} is left over, so it becomes a tube`,
    });
  }

  return ops;
}

const round = (n: number): number => Math.round(n * 10) / 10;
