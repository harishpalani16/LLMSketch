import { register } from "../registry.ts";

export default register({
  name: "network_surface",
  group: "create",
  produces: "solid",
  summary: "Surface through a quasi-grid of crossing strokes (Rhino's NetworkSrf).",
  preconditions: "2+ strokes in each direction, roughly forming a grid",
  params: [
    {
      name: "u_strokes",
      type: "strokes",
      required: true,
      minItems: 2,
      doc: "strokes running one way",
    },
    {
      name: "v_strokes",
      type: "strokes",
      required: true,
      minItems: 2,
      doc: "strokes crossing them",
    },
  ],
  examples: [
    { params: {"u_strokes": ["S8", "S9"], "v_strokes": ["S10", "S11"]} },
  ],
});
