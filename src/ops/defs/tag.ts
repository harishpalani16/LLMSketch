import { register } from "../registry.ts";

export default register({
  name: "tag",
  group: "organize",
  produces: "none",
  summary: "Label a solid; the label comes back to you in later turns.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to label" },
    { name: "label", type: "text", required: true, maxLength: 24, doc: "short label" },
  ],
  examples: [
    { params: {"solid": "B1", "label": "tower"} },
  ],
});
