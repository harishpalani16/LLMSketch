import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { Doc } from "../core/types.ts";
import { docFromJson, docToJson } from "../graph/serialize.ts";

/**
 * Share = the model as a program (SPEC §12): strokes + history graph + intent,
 * deflated into the URL fragment. The receiver re-evaluates the graph.
 */

const PREFIX = "#m=";
export const WARN_BYTES = 8 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeDoc(doc: Doc): string {
  return toBase64Url(deflateSync(strToU8(docToJson(doc)), { level: 9 }));
}

export function decodeDoc(payload: string): Doc {
  return docFromJson(strFromU8(inflateSync(fromBase64Url(payload))));
}

export function shareUrl(doc: Doc): { url: string; bytes: number; warn: boolean } {
  const payload = encodeDoc(doc);
  const url = `${location.origin}${location.pathname}${PREFIX}${payload}`;
  return { url, bytes: payload.length, warn: payload.length > WARN_BYTES };
}

export function docFromLocation(): Doc | null {
  const hash = location.hash;
  if (!hash.startsWith(PREFIX)) return null;
  try {
    return decodeDoc(hash.slice(PREFIX.length));
  } catch {
    return null;
  }
}
