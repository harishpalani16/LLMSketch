import type { Doc } from "../core/types.ts";
import { applyOp, validationScene } from "../graph/model.ts";
import { validateOp } from "../ops/registry.ts";
import { parseAll, type OpLine } from "./ndjson.ts";

/**
 * Turning a model's NDJSON into history, with no UI or network in the way.
 * `conversation.ts` drives this line by line as the stream arrives; tests drive
 * it with a whole response at once.
 */

export interface Rejection {
  line: string;
  reason: string;
}

export type LineVerdict =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; reason: string };

/** Validate one op against the document as it stands *right now*. */
export function validateLine(doc: Doc, line: OpLine): LineVerdict {
  const result = validateOp({ op: line.op, params: line.params }, validationScene(doc));
  return result.ok ? { ok: true, params: result.params } : { ok: false, reason: result.errors.join("; ") };
}

export interface AppliedTurn {
  doc: Doc;
  /** node ids for ops that appended, or the op name for in-place rewrites */
  applied: string[];
  rejected: Rejection[];
  summary: string;
}

export function applyTurn(doc: Doc, text: string): AppliedTurn {
  const applied: string[] = [];
  const rejected: Rejection[] = [];
  let summary = "";
  let current = doc;

  for (const parsed of parseAll(text)) {
    if (parsed.kind === "done") {
      summary = parsed.value.summary;
      continue;
    }
    const verdict = validateLine(current, parsed.value);
    if (!verdict.ok) {
      rejected.push({ line: parsed.value.raw, reason: verdict.reason });
      continue;
    }
    const before = current.nodes.length;
    current = applyOp(current, parsed.value.op, verdict.params);
    const added = current.nodes.length > before ? current.nodes[current.nodes.length - 1]! : null;
    applied.push(added ? added.id : parsed.value.op);
  }

  return { doc: current, applied, rejected, summary };
}
