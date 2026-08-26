import { register } from "../registry.ts";

export default register({
  name: "mirror",
  group: "modify",
  produces: "solid",
  summary: "Mirror a solid across a drawing plane, keeping the original.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to mirror" },
    { name: "plane", type: "plane", required: true, doc: "mirror plane" },
    {
      name: "offset",
      type: "number",
      default: 0,
      min: -500,
      max: 500,
      doc: "metres along that plane's normal",
    },
  ],
  examples: [
    { params: {"solid": "B1", "plane": "side", "offset": 0} },
  ],
});
