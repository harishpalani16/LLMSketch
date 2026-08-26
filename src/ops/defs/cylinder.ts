import { register } from "../registry.ts";

export default register({
  name: "cylinder",
  group: "create",
  produces: "solid",
  summary: "Cylinder fitted to a circular stroke.",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "stroke to fit a circle to" },
    { name: "height", type: "number", min: 0.01, max: 500, doc: "metres" },
  ],
  examples: [
    { params: {"stroke": "S6", "height": 8} },
  ],
});
