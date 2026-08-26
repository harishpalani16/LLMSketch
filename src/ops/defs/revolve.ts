import { register } from "../registry.ts";

export default register({
  name: "revolve",
  group: "create",
  produces: "solid",
  summary: "Spin a closed profile around an axis stroke.",
  preconditions: "closed profile; axis is an open, near-straight stroke",
  params: [
    { name: "profile", type: "stroke", required: true, doc: "the closed profile to spin" },
    {
      name: "axis",
      type: "stroke",
      required: true,
      doc: "an open near-straight stroke used as the axis",
    },
    { name: "angle", type: "number", default: 360, min: 1, max: 360, doc: "degrees of revolution" },
  ],
  examples: [
    { params: {"profile": "S5", "axis": "S3", "angle": 360} },
  ],
});
