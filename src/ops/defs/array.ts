import { register } from "../registry.ts";

export default register({
  name: "array",
  group: "modify",
  produces: "solids",
  summary: "Linear copies along an axis.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to repeat" },
    {
      name: "count",
      type: "int",
      required: true,
      min: 2,
      max: 40,
      doc: "total copies including the original",
    },
    { name: "axis", type: "enum", required: true, values: ["x", "y", "z"], doc: "which world axis" },
    {
      name: "spacing",
      type: "number",
      required: true,
      min: -500,
      max: 500,
      doc: "metres between copies",
    },
  ],
  examples: [
    { params: {"solid": "B1", "count": 3, "axis": "x", "spacing": 14} },
  ],
});
