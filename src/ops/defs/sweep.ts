import { register } from "../registry.ts";

export default register({
  name: "sweep",
  group: "create",
  produces: "solid",
  summary: "Sweep a closed profile along an open rail stroke.",
  preconditions: "closed profile, open rail",
  params: [
    { name: "profile", type: "stroke", required: true, doc: "closed cross-section" },
    { name: "rail", type: "stroke", required: true, doc: "open path to sweep along" },
    {
      name: "keep_normal",
      type: "bool",
      default: false,
      doc: "keep the profile's own orientation instead of rotating with the rail",
    },
  ],
  examples: [
    { params: {"profile": "S5", "rail": "S4"} },
  ],
});
