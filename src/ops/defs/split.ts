import { register } from "../registry.ts";

export default register({
  name: "split",
  group: "modify",
  produces: "solids",
  summary: "Split solid a by solid b, keeping both pieces as new solids.",
  params: [
    { name: "a", type: "solid", required: true, doc: "the solid to split" },
    { name: "b", type: "solid", required: true, doc: "the splitting tool" },
  ],
  examples: [
    { params: {"a": "B1", "b": "B2"} },
  ],
});
