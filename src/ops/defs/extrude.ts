import { register } from "../registry.ts";

export default register({
  name: "extrude",
  group: "create",
  produces: "solid",
  summary: "Push a closed outline along its plane normal into a solid.",
  preconditions: "a closed stroke",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the closed outline to push" },
    {
      name: "height",
      type: "number",
      required: true,
      min: -500,
      max: 500,
      doc: "metres along the plane normal; negative goes the other way",
    },
    {
      name: "taper",
      type: "number",
      default: 0,
      min: -45,
      max: 45,
      doc: "draft angle in degrees, positive leans outward",
    },
  ],
  examples: [
    { params: {"stroke": "S1", "height": 6} },
    { params: {"stroke": "S1", "height": 9, "taper": 4} },
  ],
});
