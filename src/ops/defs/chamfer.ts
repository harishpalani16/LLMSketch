import { register } from "../registry.ts";

export default register({
  name: "chamfer",
  group: "modify",
  produces: "replace",
  summary: "Bevel selected edges.",
  params: [
    { name: "edges", type: "subref", required: true, subKind: "edges", doc: "edge selector" },
    { name: "distance", type: "number", required: true, min: 0.001, max: 100, doc: "metres" },
  ],
  examples: [
    { params: {"edges": {"solid": "B1", "kind": "edges", "select": "top-cap"}, "distance": 0.3} },
  ],
});
