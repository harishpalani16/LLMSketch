/**
 * SPEC §9.2/§9.4 -- streaming NDJSON parser.
 *
 * Tolerates partial chunks, blank lines, stray prose and markdown fences,
 * because a model that has been told "no fences" still emits them sometimes.
 */

export interface OpLine {
  op: string;
  params: Record<string, unknown>;
  /** the raw text, kept so rejections can be quoted back verbatim */
  raw: string;
}

export interface DoneLine {
  done: true;
  summary: string;
}

export type ParsedLine = { kind: "op"; value: OpLine } | { kind: "done"; value: DoneLine };

export class NdjsonParser {
  private buffer = "";

  /** Feed a chunk; returns whatever complete lines it yielded. */
  push(chunk: string): ParsedLine[] {
    this.buffer += chunk;
    const out: ParsedLine[] = [];
    let nl = this.buffer.indexOf("\n");
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const parsed = parseLine(line);
      if (parsed) out.push(parsed);
      nl = this.buffer.indexOf("\n");
    }
    return out;
  }

  /** Flush whatever is left when the stream ends without a trailing newline. */
  end(): ParsedLine[] {
    const rest = this.buffer;
    this.buffer = "";
    const parsed = parseLine(rest);
    return parsed ? [parsed] : [];
  }
}

export function parseLine(line: string): ParsedLine | null {
  const text = line.trim().replace(/^```(?:json|ndjson)?\s*/i, "").replace(/```$/, "").trim();
  if (!text || !text.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.done === true) {
    return { kind: "done", value: { done: true, summary: String(v.summary ?? "") } };
  }
  if (typeof v.op === "string") {
    const params = (v.params ?? {}) as Record<string, unknown>;
    return {
      kind: "op",
      value: { op: v.op, params: typeof params === "object" && params ? params : {}, raw: text },
    };
  }
  return null;
}

/** Whole-response convenience used by tests and the non-streaming fallback. */
export function parseAll(text: string): ParsedLine[] {
  const p = new NdjsonParser();
  return [...p.push(text), ...p.end()];
}
