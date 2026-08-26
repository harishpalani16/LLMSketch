import { register } from "../registry.ts";

export default register({
  name: "shell",
  group: "modify",
  produces: "replace",
  summary: "Hollow a solid out, removing the selected faces. Buildings from masses.",
  params: [
    { name: "solid", type: "solid", required: true, doc: "the solid to hollow" },
    { name: "open_faces", type: "subref", required: true, subKind: "face", doc: "faces to remove" },
    {
      name: "thickness",
      type: "number",
      required: true,
      min: 0.005,
      max: 50,
      doc: "wall thickness in metres",
    },
  ],
  examples: [
    { params: {"solid": "B1", "open_faces": {"solid": "B1", "kind": "face", "select": "top"}, "thickness": 0.3} },
  ],
});
