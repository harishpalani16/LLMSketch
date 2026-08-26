import { register } from "../registry.ts";

export default register({
  name: "scale",
  group: "modify",
  produces: "replace",
  summary: "Scale a solid about its own centroid.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid" },
    { name: "factor", type: "number", required: true, min: 0.01, max: 100, doc: "multiplier" },
  ],
  examples: [
    { params: {"solid": "B1", "factor": 1.5} },
  ],
});
