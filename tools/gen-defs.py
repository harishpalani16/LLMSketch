"""Generates src/ops/defs/*.ts from one table.

The registry is the single source of truth for capability (SPEC §8); this table
is the single source of truth for the registry, so the 30-odd def files stay
consistent with each other. Re-run with `python tools/gen-defs.py` after editing.
"""

import json
import pathlib

P = pathlib.Path(__file__).resolve().parents[1] / "src" / "ops" / "defs"


def p(name, type_, doc, **kw):
    d = {"name": name, "type": type_, "doc": doc}
    d.update(kw)
    return d


R = dict(required=True)

OPS = [
    # ---------------------------------------------------------------- create
    dict(
        name="extrude", group="create", produces="solid",
        summary="Push a closed outline along its plane normal into a solid.",
        preconditions="a closed stroke",
        params=[
            p("stroke", "stroke", "the closed outline to push", **R),
            p("height", "number", "metres along the plane normal; negative goes the other way",
              min=-500, max=500, **R),
            p("taper", "number", "draft angle in degrees, positive leans outward", min=-45, max=45, default=0),
        ],
        examples=[{"params": {"stroke": "S1", "height": 6}},
                  {"params": {"stroke": "S1", "height": 9, "taper": 4}}],
    ),
    dict(
        name="loft", group="create", produces="solid",
        summary="Skin a solid through two or more closed outlines on parallel planes.",
        preconditions="2+ closed strokes on parallel planes",
        params=[
            p("strokes", "strokes", "closed outlines, bottom to top", minItems=2, **R),
            p("ruled", "bool", "straight sections instead of a smooth skin", default=False),
        ],
        examples=[{"params": {"strokes": ["S1", "S2"]}}],
    ),
    dict(
        name="revolve", group="create", produces="solid",
        summary="Spin a closed profile around an axis stroke.",
        preconditions="closed profile; axis is an open, near-straight stroke",
        params=[
            p("profile", "stroke", "the closed profile to spin", **R),
            p("axis", "stroke", "an open near-straight stroke used as the axis", **R),
            p("angle", "number", "degrees of revolution", min=1, max=360, default=360),
        ],
        examples=[{"params": {"profile": "S5", "axis": "S3", "angle": 360}}],
    ),
    dict(
        name="sweep", group="create", produces="solid",
        summary="Sweep a closed profile along an open rail stroke.",
        preconditions="closed profile, open rail",
        params=[
            p("profile", "stroke", "closed cross-section", **R),
            p("rail", "stroke", "open path to sweep along", **R),
            p("keep_normal", "bool", "keep the profile's own orientation instead of rotating with the rail",
              default=False),
        ],
        examples=[{"params": {"profile": "S5", "rail": "S4"}}],
    ),
    dict(
        name="pipe", group="create", produces="solid",
        summary="Give a stroke thickness as a round tube.",
        params=[
            p("stroke", "stroke", "the path", **R),
            p("radius", "number", "tube radius in metres", min=0.01, max=50, **R),
        ],
        examples=[{"params": {"stroke": "S4", "radius": 0.4}}],
    ),
    dict(
        name="wall", group="create", produces="solid",
        summary="Turn an open line into a wall of a given height and thickness.",
        preconditions="an open stroke",
        params=[
            p("stroke", "stroke", "the wall centreline", **R),
            p("height", "number", "metres", min=0.1, max=500, default=3.2),
            p("thickness", "number", "metres", min=0.02, max=10, default=0.25),
        ],
        examples=[{"params": {"stroke": "S4", "height": 3.2, "thickness": 0.25}}],
    ),
    dict(
        name="slab", group="create", produces="solid",
        summary="Thin plate from a closed outline; tagged \"slab\".",
        preconditions="a closed stroke",
        params=[
            p("stroke", "stroke", "the closed outline", **R),
            p("thickness", "number", "metres", min=0.02, max=10, default=0.3),
        ],
        examples=[{"params": {"stroke": "S1", "thickness": 0.3}}],
    ),
    dict(
        name="patch", group="create", produces="solid",
        summary="A single flat face filling a closed outline.",
        preconditions="a closed stroke",
        params=[p("stroke", "stroke", "the closed outline", **R)],
        examples=[{"params": {"stroke": "S1"}}],
    ),
    dict(
        name="network_surface", group="create", produces="solid",
        summary="Surface through a quasi-grid of crossing strokes (Rhino's NetworkSrf).",
        preconditions="2+ strokes in each direction, roughly forming a grid",
        params=[
            p("u_strokes", "strokes", "strokes running one way", minItems=2, **R),
            p("v_strokes", "strokes", "strokes crossing them", minItems=2, **R),
        ],
        examples=[{"params": {"u_strokes": ["S8", "S9"], "v_strokes": ["S10", "S11"]}}],
    ),
    dict(
        name="stack", group="create", produces="solid",
        summary="Repeat a floorplate into a stack of slabs; tagged \"floorplate\".",
        preconditions="a closed stroke",
        params=[
            p("stroke", "stroke", "the floorplate outline", **R),
            p("floors", "int", "how many floors", min=1, max=80, **R),
            p("floor_height", "number", "metres per floor", min=1, max=20, default=3.2),
        ],
        examples=[{"params": {"stroke": "S1", "floors": 5, "floor_height": 3.2}}],
    ),
    dict(
        name="box", group="create", produces="solid",
        summary="Axis-aligned box fitted to a stroke's bounding box.",
        params=[
            p("stroke", "stroke", "stroke whose bbox sets the footprint", **R),
            p("height", "number", "metres; defaults to 0.55x the larger footprint dimension",
              min=0.01, max=500),
        ],
        examples=[{"params": {"stroke": "S1", "height": 6}}],
    ),
    dict(
        name="cylinder", group="create", produces="solid",
        summary="Cylinder fitted to a circular stroke.",
        params=[
            p("stroke", "stroke", "stroke to fit a circle to", **R),
            p("height", "number", "metres", min=0.01, max=500),
        ],
        examples=[{"params": {"stroke": "S6", "height": 8}}],
    ),
    dict(
        name="sphere", group="create", produces="solid",
        summary="Sphere fitted to a circular stroke.",
        params=[p("stroke", "stroke", "stroke to fit a circle to", **R)],
        examples=[{"params": {"stroke": "S6"}}],
    ),
    # ---------------------------------------------------------------- modify
    dict(
        name="boolean", group="modify", produces="replace",
        summary="Union, subtract or intersect two solids. The result replaces a and consumes b.",
        params=[
            p("kind", "enum", "which operation", values=["union", "subtract", "intersect"], **R),
            p("a", "solid", "the solid that survives", **R),
            p("b", "solid", "the solid consumed by the operation", **R),
        ],
        examples=[{"params": {"kind": "subtract", "a": "B1", "b": "B2"}}],
    ),
    dict(
        name="fillet", group="modify", produces="replace",
        summary="Round selected edges.",
        params=[
            p("edges", "subref", "edge selector", subKind="edges", **R),
            p("radius", "number", "metres; must be smaller than half the shortest selected edge",
              min=0.001, max=100, **R),
        ],
        examples=[{"params": {"edges": {"solid": "B1", "kind": "edges", "select": "vertical"},
                              "radius": 0.5}}],
    ),
    dict(
        name="chamfer", group="modify", produces="replace",
        summary="Bevel selected edges.",
        params=[
            p("edges", "subref", "edge selector", subKind="edges", **R),
            p("distance", "number", "metres", min=0.001, max=100, **R),
        ],
        examples=[{"params": {"edges": {"solid": "B1", "kind": "edges", "select": "top-cap"},
                              "distance": 0.3}}],
    ),
    dict(
        name="shell", group="modify", produces="replace",
        summary="Hollow a solid out, removing the selected faces. Buildings from masses.",
        params=[
            p("solid", "solid", "the solid to hollow", **R),
            p("open_faces", "subref", "faces to remove", subKind="face", **R),
            p("thickness", "number", "wall thickness in metres", min=0.005, max=50, **R),
        ],
        examples=[{"params": {"solid": "B1",
                              "open_faces": {"solid": "B1", "kind": "face", "select": "top"},
                              "thickness": 0.3}}],
    ),
    dict(
        name="offset_solid", group="modify", produces="replace",
        summary="Grow or shrink a solid by an offset distance.",
        params=[
            p("solid", "solid", "the solid", **R),
            p("distance", "number", "metres; negative shrinks", min=-50, max=50, **R),
        ],
        examples=[{"params": {"solid": "B1", "distance": 0.2}}],
    ),
    dict(
        name="cut_plane", group="modify", produces="replace",
        summary="Slice a solid with one of the drawing planes and keep a side.",
        params=[
            p("solid", "solid", "the solid to slice", **R),
            p("plane", "plane", "which drawing plane", **R),
            p("offset", "number", "metres along that plane's normal", min=-500, max=500, default=0),
            p("keep", "enum", "which side survives", values=["above", "below", "both"], default="below"),
        ],
        examples=[{"params": {"solid": "B1", "plane": "ground", "offset": 3, "keep": "below"}}],
    ),
    dict(
        name="split", group="modify", produces="solids",
        summary="Split solid a by solid b, keeping both pieces as new solids.",
        params=[
            p("a", "solid", "the solid to split", **R),
            p("b", "solid", "the splitting tool", **R),
        ],
        examples=[{"params": {"a": "B1", "b": "B2"}}],
    ),
    dict(
        name="push_pull", group="modify", produces="replace",
        summary="Push or pull one face along its own normal. SketchUp's one great idea, recorded parametrically.",
        params=[
            p("face", "subref", "the face to move", subKind="face", **R),
            p("distance", "number", "metres; negative pushes in", min=-500, max=500, **R),
        ],
        examples=[{"params": {"face": {"solid": "B1", "kind": "face", "select": "top"},
                              "distance": 2}}],
    ),
    dict(
        name="mirror", group="modify", produces="solid",
        summary="Mirror a solid across a drawing plane, keeping the original.",
        params=[
            p("solid", "solid", "the solid to mirror", **R),
            p("plane", "plane", "mirror plane", **R),
            p("offset", "number", "metres along that plane's normal", min=-500, max=500, default=0),
        ],
        examples=[{"params": {"solid": "B1", "plane": "side", "offset": 0}}],
    ),
    dict(
        name="array", group="modify", produces="solids",
        summary="Linear copies along an axis.",
        params=[
            p("solid", "solid", "the solid to repeat", **R),
            p("count", "int", "total copies including the original", min=2, max=40, **R),
            p("axis", "enum", "which world axis", values=["x", "y", "z"], **R),
            p("spacing", "number", "metres between copies", min=-500, max=500, **R),
        ],
        examples=[{"params": {"solid": "B1", "count": 3, "axis": "x", "spacing": 14}}],
    ),
    dict(
        name="array_along", group="modify", produces="solids",
        summary="Copies distributed by arc length along a rail stroke.",
        params=[
            p("solid", "solid", "the solid to repeat", **R),
            p("rail", "stroke", "the path to distribute along", **R),
            p("count", "int", "how many copies", min=2, max=40, **R),
        ],
        examples=[{"params": {"solid": "B1", "rail": "S4", "count": 4}}],
    ),
    dict(
        name="move", group="modify", produces="replace",
        summary="Translate a solid.",
        params=[
            p("solid", "solid", "the solid", **R),
            p("dx", "number", "metres", min=-1000, max=1000, default=0),
            p("dy", "number", "metres (up)", min=-1000, max=1000, default=0),
            p("dz", "number", "metres", min=-1000, max=1000, default=0),
        ],
        examples=[{"params": {"solid": "B1", "dx": 5, "dy": 0, "dz": 0}}],
    ),
    dict(
        name="rotate", group="modify", produces="replace",
        summary="Rotate a solid about its own centroid.",
        params=[
            p("solid", "solid", "the solid", **R),
            p("axis", "enum", "which world axis", values=["x", "y", "z"], **R),
            p("angle", "number", "degrees", min=-360, max=360, **R),
        ],
        examples=[{"params": {"solid": "B1", "axis": "y", "angle": 30}}],
    ),
    dict(
        name="scale", group="modify", produces="replace",
        summary="Scale a solid about its own centroid.",
        params=[
            p("solid", "solid", "the solid", **R),
            p("factor", "number", "multiplier", min=0.01, max=100, **R),
        ],
        examples=[{"params": {"solid": "B1", "factor": 1.5}}],
    ),
    dict(
        name="duplicate", group="modify", produces="solid",
        summary="Copy a solid in place as a new solid.",
        params=[p("solid", "solid", "the solid to copy", **R)],
        examples=[{"params": {"solid": "B1"}}],
    ),
    dict(
        name="delete", group="modify", produces="none",
        summary="Remove a solid from the model.",
        params=[p("solid", "solid", "the solid to remove", **R)],
        examples=[{"params": {"solid": "B2"}}],
    ),
    # -------------------------------------------------------------- organize
    dict(
        name="tag", group="organize", produces="none",
        summary="Label a solid; the label comes back to you in later turns.",
        params=[
            p("solid", "solid", "the solid to label", **R),
            p("label", "text", "short label", maxLength=24, **R),
        ],
        examples=[{"params": {"solid": "B1", "label": "tower"}}],
    ),
    dict(
        name="edit", group="organize", produces="none",
        summary="Change scalar params of an earlier history node; everything downstream re-evaluates. Prefer this over rebuilding.",
        params=[
            p("node", "node", "the history node to change", **R),
            p("set", "params", "the params to change, e.g. {\"height\": 40}", **R),
        ],
        examples=[{"params": {"node": "N1", "set": {"height": 40}}}],
    ),
    dict(
        name="remove_op", group="organize", produces="none",
        summary="Delete a history node; downstream nodes re-evaluate or error honestly.",
        params=[p("node", "node", "the history node to delete", **R)],
        examples=[{"params": {"node": "N2"}}],
    ),
]


def ts_val(v):
    return json.dumps(v)


def emit(op):
    lines = ['import { register } from "../registry.ts";', "", "export default register({"]
    lines.append(f'  name: "{op["name"]}",')
    lines.append(f'  group: "{op["group"]}",')
    lines.append(f'  produces: "{op["produces"]}",')
    lines.append(f"  summary: {ts_val(op['summary'])},")
    if op.get("preconditions"):
        lines.append(f"  preconditions: {ts_val(op['preconditions'])},")
    lines.append("  params: [")
    for pd in op["params"]:
        parts = [f'name: "{pd["name"]}"', f'type: "{pd["type"]}"']
        for k in ("required", "default", "min", "max", "values", "subKind", "minItems", "maxLength"):
            if k in pd:
                parts.append(f"{k}: {ts_val(pd[k])}")
        parts.append(f"doc: {ts_val(pd['doc'])}")
        body = ", ".join(parts)
        if len(body) <= 92:
            lines.append(f"    {{ {body} }},")
        else:
            lines.append("    {")
            for part in parts:
                lines.append(f"      {part},")
            lines.append("    },")
    lines.append("  ],")
    lines.append("  examples: [")
    for ex in op["examples"]:
        lines.append(f"    {{ params: {ts_val(ex['params'])} }},")
    lines.append("  ],")
    lines.append("});")
    return "\n".join(lines) + "\n"


P.mkdir(parents=True, exist_ok=True)
for op in OPS:
    (P / f"{op['name']}.ts").write_text(emit(op), encoding="utf-8")

index = ["/** Importing this module registers every operation (SPEC §8). */", ""]
for op in OPS:
    index.append(f'import "./{op["name"]}.ts";')
index.append("")
index.append("export {};")
(P / "index.ts").write_text("\n".join(index) + "\n", encoding="utf-8")

print(f"wrote {len(OPS)} op defs")
