import { register } from "../registry.ts";

export default register({
  name: "array_along",
  group: "modify",
  produces: "solids",
  summary: "Copies distributed by arc length along a rail stroke.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to repeat" },
    { name: "rail", type: "stroke", required: true, doc: "the path to distribute along" },
    { name: "count", type: "int", required: true, min: 2, max: 40, doc: "how many copies" },
  ],
  examples: [
    { params: {"solid": "B1", "rail": "S4", "count": 4} },
  ],
});
