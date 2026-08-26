import { register } from "../registry.ts";

export default register({
  name: "slab",
  group: "create",
  produces: "solid",
  summary: "Thin plate from a closed outline; tagged \"slab\".",
  preconditions: "a closed stroke",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the closed outline" },
    { name: "thickness", type: "number", default: 0.3, min: 0.02, max: 10, doc: "metres" },
  ],
  examples: [
    { params: {"stroke": "S1", "thickness": 0.3} },
  ],
});
