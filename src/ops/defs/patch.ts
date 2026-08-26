import { register } from "../registry.ts";

export default register({
  name: "patch",
  group: "create",
  produces: "solid",
  summary: "A single flat face filling a closed outline.",
  preconditions: "a closed stroke",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "the closed outline" },
  ],
  examples: [
    { params: {"stroke": "S1"} },
  ],
});
