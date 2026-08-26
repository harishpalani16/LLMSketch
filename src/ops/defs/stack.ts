import { register } from "../registry.ts";

export default register({
  name: "stack",
  group: "create",
  produces: "solid",
  summary: "Repeat a floorplate into a stack of slabs; tagged \"floorplate\".",
  preconditions: "a closed stroke",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the floorplate outline" },
    { name: "floors", type: "int", required: true, min: 1, max: 80, doc: "how many floors" },
    { name: "floor_height", type: "number", default: 3.2, min: 1, max: 20, doc: "metres per floor" },
  ],
  examples: [
    { params: {"stroke": "S1", "floors": 5, "floor_height": 3.2} },
  ],
});
