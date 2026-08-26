import { opDef } from "./registry.ts";

/**
 * How many solid ids a node will produce, so the graph can allocate them up
 * front (SPEC §4: `OpNode.outputs` is part of the document). Ops whose output
 * count depends on a scalar are listed explicitly; everything else follows its
 * `produces` field.
 */
export function expectedOutputCount(op: string, params: Record<string, unknown>): number {
  switch (op) {
    case "array":
    case "array_along":
      return Math.max(0, Number(params.count ?? 2) - 1);
    case "split":
      return 2;
    case "cut_plane":
      return params.keep === "both" ? 2 : 1;
    default:
      break;
  }
  const def = opDef(op);
  if (!def) return 0;
  return def.produces === "none" ? 0 : 1;
}
