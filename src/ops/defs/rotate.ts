import { register } from "../registry.ts";

export default register({
  name: "rotate",
  group: "modify",
  produces: "replace",
  summary: "Rotate a solid about its own centroid.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid" },
    { name: "axis", type: "enum", required: true, values: ["x", "y", "z"], doc: "which world axis" },
    { name: "angle", type: "number", required: true, min: -360, max: 360, doc: "degrees" },
  ],
  examples: [
    { params: {"solid": "B1", "axis": "y", "angle": 30} },
  ],
});
