import { register } from "../registry.ts";

export default register({
  name: "move",
  group: "modify",
  produces: "replace",
  summary: "Translate a solid.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid" },
    { name: "dx", type: "number", default: 0, min: -1000, max: 1000, doc: "metres" },
    { name: "dy", type: "number", default: 0, min: -1000, max: 1000, doc: "metres (up)" },
    { name: "dz", type: "number", default: 0, min: -1000, max: 1000, doc: "metres" },
  ],
  examples: [
    { params: {"solid": "B1", "dx": 5, "dy": 0, "dz": 0} },
  ],
});
