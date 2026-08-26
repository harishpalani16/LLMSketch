/**
 * SPEC §1.2 / §9.7 -- bring-your-own-key, called direct from the browser.
 * The key lives in a JS variable for the session only. It is never persisted
 * and never sent anywhere except api.anthropic.com.
 */

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";
export const MAX_TOKENS = 3000;

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface StreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Message[];
  signal?: AbortSignal;
  onText(delta: string): void;
}

function friendly(status: number, body: string): string {
  if (status === 401) return "that key was not accepted";
  const match = /"message"\s*:\s*"([^"]+)"/.exec(body);
  return match ? `${status}: ${match[1]}` : `${status}: ${body.slice(0, 200)}`;
}

export async function streamCompletion(opts: StreamOptions): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: opts.system,
      messages: opts.messages,
    }),
    signal: opts.signal,
  });

  if (!res.ok) throw new Error(friendly(res.status, await res.text()));
  if (!res.body) throw new Error("the API returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    let nl = carry.indexOf("\n");
    while (nl >= 0) {
      const line = carry.slice(0, nl).trim();
      carry = carry.slice(nl + 1);
      nl = carry.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        if (evt.type === "error") throw new Error(evt.error?.message ?? "stream error");
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          full += evt.delta.text;
          opts.onText(evt.delta.text);
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  return full;
}
