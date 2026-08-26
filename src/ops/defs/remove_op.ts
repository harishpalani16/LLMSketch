import { register } from "../registry.ts";

export default register({
  name: "remove_op",
  group: "organize",
  produces: "none",
  summary: "Delete a history node; downstream nodes re-evaluate or error honestly.",
  params: [
    { name: "node", type: "node", required: true, doc: "the history node to delete" },
  ],
  examples: [
    { params: {"node": "N2"} },
  ],
});
