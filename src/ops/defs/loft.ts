import { register } from "../registry.ts";

export default register({
  name: "loft",
  group: "create",
  produces: "solid",
  summary: "Skin a solid through two or more closed outlines on parallel planes.",
  preconditions: "2+ closed strokes on parallel planes",
  params: [
    {
      name: "strokes",
      type: "strokes",
      required: true,
      minItems: 2,
      doc: "closed outlines, bottom to top",
    },
    {
      name: "ruled",
      type: "bool",
      default: false,
      doc: "straight sections instead of a smooth skin",
    },
  ],
  examples: [
    { params: {"strokes": ["S1", "S2"]} },
  ],
});
