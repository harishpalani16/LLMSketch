import { register } from "../registry.ts";

export default register({
  name: "pipe",
  group: "create",
  produces: "solid",
  summary: "Give a stroke thickness as a round tube.",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the path" },
    {
      name: "radius",
      type: "number",
      required: true,
      min: 0.01,
      max: 50,
      doc: "tube radius in metres",
    },
  ],
  examples: [
    { params: {"stroke": "S4", "radius": 0.4} },
  ],
});
