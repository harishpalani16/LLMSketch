import type { OC, Shape } from "./oc.ts";
import { Scope } from "./oc.ts";
import type { Tess } from "../core/types.ts";
import { compoundOf, progress } from "./occ.ts";
import { meshShape, tessellate } from "./tess.ts";

export type ExportKind = "step" | "obj" | "stl" | "glb";

export interface ExportItem {
  id: string;
  tags: string[];
  shape: Shape;
}

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/** STEP is the headline path: real solids into Rhino/Revit (SPEC §12). */
function writeStep(oc: OC, items: ExportItem[]): Uint8Array {
  const scope = new Scope();
  try {
    const writer = scope.t(new oc.STEPControl_Writer_1());
    for (const item of items) {
      const status = writer.Transfer(
        item.shape,
        oc.STEPControl_StepModelType.STEPControl_AsIs,
        true,
        scope.t(progress(oc)),
      );
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
        throw new Error(`STEP transfer of ${item.id} failed`);
      }
    }
    const path = "/export.step";
    if (writer.Write(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error("STEP write failed");
    }
    const bytes = oc.FS.readFile(path, { encoding: "binary" }) as Uint8Array;
    oc.FS.unlink(path);
    return new Uint8Array(bytes);
  } finally {
    scope.free();
  }
}

function writeStl(oc: OC, items: ExportItem[]): Uint8Array {
  const scope = new Scope();
  try {
    const shape = compoundOf(oc, scope, items.map((i) => i.shape));
    meshShape(oc, shape);
    const writer = scope.t(new oc.StlAPI_Writer());
    const path = "/export.stl";
    if (!writer.Write(shape, path, scope.t(progress(oc)))) throw new Error("STL write failed");
    const bytes = oc.FS.readFile(path, { encoding: "binary" }) as Uint8Array;
    oc.FS.unlink(path);
    return new Uint8Array(bytes);
  } finally {
    scope.free();
  }
}

function objName(item: ExportItem): string {
  return [item.id, ...item.tags].join("_").replace(/[^\w.-]+/g, "-");
}

function writeObj(oc: OC, items: ExportItem[]): Uint8Array {
  const out: string[] = ["# sketch -> solid", "# units: metres"];
  let base = 1;
  for (const item of items) {
    const t = tessellate(oc, item.shape);
    out.push(`o ${objName(item)}`);
    for (let i = 0; i < t.positions.length; i += 3) {
      out.push(`v ${f(t.positions[i]!)} ${f(t.positions[i + 1]!)} ${f(t.positions[i + 2]!)}`);
    }
    for (let i = 0; i < t.normals.length; i += 3) {
      out.push(`vn ${f(t.normals[i]!)} ${f(t.normals[i + 1]!)} ${f(t.normals[i + 2]!)}`);
    }
    const count = t.positions.length / 3;
    for (let i = 0; i < count; i += 3) {
      const a = base + i;
      out.push(`f ${a}//${a} ${a + 1}//${a + 1} ${a + 2}//${a + 2}`);
    }
    base += count;
  }
  return new TextEncoder().encode(out.join("\n") + "\n");
}

const f = (n: number): string => (Math.abs(n) < 1e-9 ? "0" : n.toFixed(6));

/** Minimal binary glTF: one mesh per solid, non-indexed positions + normals. */
function writeGlb(oc: OC, items: ExportItem[]): Uint8Array {
  const meshes: { name: string; t: Tess }[] = items.map((i) => ({
    name: objName(i),
    t: tessellate(oc, i.shape),
  }));

  const buffers: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];

  const pushView = (data: Float32Array, kind: "pos" | "nrm") => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      buffers.push(new Uint8Array(pad));
      offset += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target: 34962 });
    buffers.push(bytes);
    offset += bytes.byteLength;

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, data[i + k]!);
        max[k] = Math.max(max[k]!, data[i + k]!);
      }
    }
    if (!Number.isFinite(min[0]!)) {
      min = [0, 0, 0];
      max = [0, 0, 0];
    }
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: data.length / 3,
      type: "VEC3",
      ...(kind === "pos" ? { min, max } : {}),
    });
    return accessors.length - 1;
  };

  const gltfMeshes = meshes.map((m) => {
    const pos = pushView(m.t.positions, "pos");
    const nrm = pushView(m.t.normals, "nrm");
    return { name: m.name, primitives: [{ attributes: { POSITION: pos, NORMAL: nrm }, mode: 4 }] };
  });

  const bin = concat(buffers);
  const json = {
    asset: { version: "2.0", generator: "sketch-to-solid" },
    scene: 0,
    scenes: [{ nodes: gltfMeshes.map((_, i) => i) }],
    nodes: gltfMeshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  };

  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad4(bin, 0);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.byteLength;
  dv.setUint32(binStart, binBytes.byteLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // "BIN"
  out.set(binBytes, binStart + 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function pad4(data: Uint8Array, fill: number): Uint8Array {
  const extra = (4 - (data.byteLength % 4)) % 4;
  if (!extra) return data;
  const out = new Uint8Array(data.byteLength + extra);
  out.set(data);
  out.fill(fill, data.byteLength);
  return out;
}

const MIME: Record<ExportKind, string> = {
  step: "application/step",
  obj: "text/plain",
  stl: "model/stl",
  glb: "model/gltf-binary",
};

export function exportShapes(oc: OC, kind: ExportKind, items: ExportItem[]): ExportFile {
  if (!items.length) throw new Error("nothing to export");
  const bytes =
    kind === "step"
      ? writeStep(oc, items)
      : kind === "stl"
        ? writeStl(oc, items)
        : kind === "obj"
          ? writeObj(oc, items)
          : writeGlb(oc, items);
  return { name: `model.${kind}`, bytes, mime: MIME[kind] };
}

/** Used by the STEP round-trip test (SPEC test 13). */
export function importStep(oc: OC, bytes: Uint8Array): Shape[] {
  const path = "/import.step";
  oc.FS.writeFile(path, bytes);
  const reader = new oc.STEPControl_Reader_1();
  if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    oc.FS.unlink(path);
    throw new Error("could not read that STEP file");
  }
  const scope = new Scope();
  try {
    reader.TransferRoots(scope.t(progress(oc)));
    const out: Shape[] = [];
    for (let i = 1; i <= reader.NbShapes(); i++) out.push(reader.Shape(i));
    return out;
  } finally {
    oc.FS.unlink(path);
    reader.delete();
    scope.free();
  }
}
