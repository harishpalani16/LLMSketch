import { register } from "../registry.ts";

export default register({
  name: "duplicate",
  group: "modify",
  produces: "solid",
  summary: "Copy a solid in place as a new solid.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to copy" },
  ],
  examples: [
    { params: {"solid": "B1"} },
  ],
});
