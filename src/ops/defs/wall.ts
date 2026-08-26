import { register } from "../registry.ts";

export default register({
  name: "wall",
  group: "create",
  produces: "solid",
  summary: "Turn an open line into a wall of a given height and thickness.",
  preconditions: "an open stroke",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the wall centreline" },
    { name: "height", type: "number", default: 3.2, min: 0.1, max: 500, doc: "metres" },
    { name: "thickness", type: "number", default: 0.25, min: 0.02, max: 10, doc: "metres" },
  ],
  examples: [
    { params: {"stroke": "S4", "height": 3.2, "thickness": 0.25} },
  ],
});
