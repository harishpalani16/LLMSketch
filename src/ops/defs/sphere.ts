import { register } from "../registry.ts";

export default register({
  name: "sphere",
  group: "create",
  produces: "solid",
  summary: "Sphere fitted to a circular stroke.",
  params: [
    { name: "stroke", type: "stroke", required: true, doc: "stroke to fit a circle to" },
  ],
  examples: [
    { params: {"stroke": "S6"} },
  ],
});
