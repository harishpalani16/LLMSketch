import { register } from "../registry.ts";

export default register({
  name: "cut_plane",
  group: "modify",
  produces: "replace",
  summary: "Slice a solid with one of the drawing planes and keep a side.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to slice" },
    { name: "plane", type: "plane", required: true, doc: "which drawing plane" },
    {
      name: "offset",
      type: "number",
      default: 0,
      min: -500,
      max: 500,
      doc: "metres along that plane's normal",
    },
    {
      name: "keep",
      type: "enum",
      default: "below",
      values: ["above", "below", "both"],
      doc: "which side survives",
    },
  ],
  examples: [
    { params: {"solid": "B1", "plane": "ground", "offset": 3, "keep": "below"} },
  ],
});
