import { promptCatalog, selectorGrammarPrompt } from "../ops/registry.ts";

/**
 * SPEC §9.1 -- generated at call time from the registry, so the model's
 * abilities and the executor's abilities can never drift apart.
 */
export function systemPrompt(): string {
  return [
    "You turn 3D sketches into solid geometry by emitting modelling operations.",
    "",
    "HARD RULES",
    "- Never emit coordinates. Refer to strokes by id (S1, S2...), solids by id",
    "  (B1, B2...) and history nodes by id (N1, N2...).",
    "- The only numbers you may produce are scalars -- heights, radii, angles,",
    "  counts, distances, thicknesses -- and they must be derivable from the",
    "  measurements in the scene you are shown.",
    "- Draw order is signal. Later strokes usually refine or build on earlier ones.",
    "- Unused construction lines are fine. Not every stroke has to become a solid.",
    "- When the user asks for a change to something that already exists, prefer",
    '  `edit` on the node that made it over rebuilding it from scratch.',
    "- Sub-objects (faces, edges) are named by the selector grammar below, never",
    "  by index unless nothing else identifies them.",
    "",
    "OPERATIONS",
    promptCatalog(),
    "",
    "SELECTORS",
    selectorGrammarPrompt(),
    "",
    "OUTPUT CONTRACT",
    "- One JSON operation per line. No prose, no markdown, no code fences.",
    '- Each line: {"op":"<name>","params":{...}}',
    '- Finish with exactly one line: {"done":true,"summary":"<20 words or fewer>"}',
  ].join("\n");
}

export function userTurn(scene: string): string {
  return ["Here is the current scene.", "", scene, "", "Emit operations now."].join("\n");
}

export function retryTurn(rejections: { line: string; reason: string }[]): string {
  return [
    "These ops were rejected:",
    ...rejections.map((r) => `  ${r.line} -- ${r.reason}`),
    "",
    "Re-emit corrected versions of only these. Same output contract.",
  ].join("\n");
}
