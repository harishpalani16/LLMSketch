/**
 * Which solids an op removes from the model. This is the single source of
 * truth: the kernel evaluator and the main-thread graph simulation both read
 * it, so the solid list the user (and the LLM) sees can never drift from what
 * the kernel actually holds.
 */
export function consumedSolids(op: string, params: Record<string, unknown>): string[] {
  const solid = params.solid as string | undefined;
  switch (op) {
    case "boolean":
      return [params.a as string, params.b as string];
    case "split":
      return [params.a as string];
    case "fillet":
    case "chamfer":
      return [(params.edges as { solid: string } | undefined)?.solid].filter(Boolean) as string[];
    case "push_pull":
      return [(params.face as { solid: string } | undefined)?.solid].filter(Boolean) as string[];
    case "shell":
    case "offset_solid":
    case "cut_plane":
    case "move":
    case "rotate":
    case "scale":
    case "delete":
      return solid ? [solid] : [];
    default:
      return [];
  }
}
