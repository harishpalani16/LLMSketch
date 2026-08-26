import { register } from "../registry.ts";

export default register({
  name: "edit",
  group: "organize",
  produces: "none",
  summary: "Change scalar params of an earlier history node; everything downstream re-evaluates. Prefer this over rebuilding.",
  params: [
    { name: "node", type: "node", required: true, doc: "the history node to change" },
    {
      name: "set",
      type: "params",
      required: true,
      doc: "the params to change, e.g. {\"height\": 40}",
    },
  ],
  examples: [
    { params: {"node": "N1", "set": {"height": 40}} },
  ],
});
