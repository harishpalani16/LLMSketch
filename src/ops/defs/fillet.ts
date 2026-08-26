import { register } from "../registry.ts";

export default register({
  name: "fillet",
  group: "modify",
  produces: "replace",
  summary: "Round selected edges.",
  params: [
    { name: "edges", type: "subref", required: true, subKind: "edges", doc: "edge selector" },
    {
      name: "radius",
      type: "number",
      required: true,
      min: 0.001,
      max: 100,
      doc: "metres; must be smaller than half the shortest selected edge",
    },
  ],
  examples: [
    { params: {"edges": {"solid": "B1", "kind": "edges", "select": "vertical"}, "radius": 0.5} },
  ],
});
