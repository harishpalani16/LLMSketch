import { register } from "../registry.ts";

export default register({
  name: "delete",
  group: "modify",
  produces: "none",
  summary: "Remove a solid from the model.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to remove" },
  ],
  examples: [
    { params: {"solid": "B2"} },
  ],
});
