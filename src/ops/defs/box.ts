import { register } from "../registry.ts";

export default register({
  name: "box",
  group: "create",
  produces: "solid",
  summary: "Axis-aligned box fitted to a stroke's bounding box.",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "stroke whose bbox sets the footprint" },
    {
      name: "height",
      type: "number",
      min: 0.01,
      max: 500,
      doc: "metres; defaults to 0.55x the larger footprint dimension",
    },
  ],
  examples: [
    { params: {"stroke": "S1", "height": 6} },
  ],
});
