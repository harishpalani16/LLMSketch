import { store } from "../state.ts";
import { validationScene } from "../graph/model.ts";
import { validateOp } from "../ops/registry.ts";
import { NdjsonParser, type ParsedLine } from "./ndjson.ts";
import { streamCompletion, type Message } from "./client.ts";
import { systemPrompt, retryTurn, userTurn } from "./prompt.ts";
import { serializeScene } from "./serialize.ts";

export interface Rejection {
  line: string;
  reason: string;
}

export interface TurnResult {
  summary: string;
  applied: string[];
  rejected: Rejection[];
}

/**
 * SPEC §9.4-§9.6 -- streaming execution with one validation retry.
 * Each valid op is inserted and evaluated as it arrives, so the first ghost
 * appears while the model is still talking.
 */
export async function runTurn(userText: string, signal?: AbortSignal): Promise<TurnResult> {
  const { session } = store.get();
  if (!session.apiKey) throw new Error("add an API key, or use Interpret without one");

  store.discardGhosts();
  store.patchSession({ busy: true, status: "thinking" });

  const applied: string[] = [];
  const rejected: Rejection[] = [];
  let summary = "";

  const consume = (lines: ParsedLine[]): void => {
    for (const line of lines) {
      if (line.kind === "done") {
        summary = line.value.summary;
        continue;
      }
      const scene = validationScene(store.get().doc);
      const result = validateOp({ op: line.value.op, params: line.value.params }, scene);
      if (!result.ok) {
        rejected.push({ line: line.value.raw, reason: result.errors.join("; ") });
        continue;
      }
      const node = store.applyOp(line.value.op, result.params, { ghost: true });
      if (node) applied.push(node.id);
      else applied.push(line.value.op);
    }
  };

  const scene = serializeScene(store.get().doc, store.get().solids, userText);
  const messages: Message[] = [
    ...session.messages,
    { role: "user", content: userTurn(scene) },
  ];

  try {
    const parser = new NdjsonParser();
    const text = await streamCompletion({
      apiKey: session.apiKey,
      model: session.model,
      system: systemPrompt(),
      messages,
      signal,
      onText: (delta) => consume(parser.push(delta)),
    });
    consume(parser.end());

    if (rejected.length) {
      store.patchSession({ status: "correcting rejected ops" });
      const retryParser = new NdjsonParser();
      const stillBad = [...rejected];
      rejected.length = 0;
      const retryText = await streamCompletion({
        apiKey: session.apiKey,
        model: session.model,
        system: systemPrompt(),
        messages: [
          ...messages,
          { role: "assistant", content: text },
          { role: "user", content: retryTurn(stillBad) },
        ],
        signal,
        onText: (delta) => consume(retryParser.push(delta)),
      });
      consume(retryParser.end());
      store.patchSession({
        messages: [
          ...session.messages,
          { role: "user", content: userText },
          { role: "assistant", content: `${text}\n${retryText}` },
        ],
      });
    } else {
      store.patchSession({
        messages: [
          ...session.messages,
          { role: "user", content: userText },
          { role: "assistant", content: text },
        ],
      });
    }

    store.patchSession({
      busy: false,
      status: summary || (applied.length ? `${applied.length} operations` : "nothing to build"),
    });
    return { summary, applied, rejected };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.patchSession({ busy: false, status: message });
    throw err;
  }
}
