import { register } from "../registry.ts";

export default register({
  name: "offset_solid",
  group: "modify",
  produces: "replace",
  summary: "Grow or shrink a solid by an offset distance.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid" },
    {
      name: "distance",
      type: "number",
      required: true,
      min: -50,
      max: 50,
      doc: "metres; negative shrinks",
    },
  ],
  examples: [
    { params: {"solid": "B1", "distance": 0.2} },
  ],
});
