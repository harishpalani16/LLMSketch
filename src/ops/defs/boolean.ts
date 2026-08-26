import { register } from "../registry.ts";

export default register({
  name: "boolean",
  group: "modify",
  produces: "replace",
  summary: "Union, subtract or intersect two solids. The result replaces a and consumes b.",
  params: [
    {
      name: "kind",
      type: "enum",
      required: true,
      values: ["union", "subtract", "intersect"],
      doc: "which operation",
    },
    { name: "a", type: "solid", required: true, doc: "the solid that survives" },
    { name: "b", type: "solid", required: true, doc: "the solid consumed by the operation" },
  ],
  examples: [
    { params: {"kind": "subtract", "a": "B1", "b": "B2"} },
  ],
});
