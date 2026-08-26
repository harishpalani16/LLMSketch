import { register } from "../registry.ts";

export default register({
  name: "push_pull",
  group: "modify",
  produces: "replace",
  summary: "Push or pull one face along its own normal. SketchUp's one great idea, recorded parametrically.",
  params: [
    { name: "face", type: "subref", required: true, subKind: "face", doc: "the face to move" },
    {
      name: "distance",
      type: "number",
      required: true,
      min: -500,
      max: 500,
      doc: "metres; negative pushes in",
    },
  ],
  examples: [
    { params: {"face": {"solid": "B1", "kind": "face", "select": "top"}, "distance": 2} },
  ],
});
