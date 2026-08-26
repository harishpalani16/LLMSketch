import { kernel } from "../kernel/api.ts";
import type { ExportKind } from "../kernel/export.ts";
import { liveSolids } from "../graph/model.ts";
import type { Doc } from "../core/types.ts";

/** Only kept solids are exported, named by id + tags (SPEC §12). */
export async function downloadModel(doc: Doc, kind: ExportKind): Promise<string> {
  const solids = liveSolids(doc.nodes).map((s) => ({ id: s.id, tags: s.tags }));
  if (!solids.length) throw new Error("there is nothing built to export yet");
  const file = await kernel().exportSolids(kind, solids);
  const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return `${file.name} · ${(file.bytes.byteLength / 1024).toFixed(0)} KB`;
}
