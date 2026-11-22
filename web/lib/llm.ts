// LLM access for BrainPrint: free OpenAI-compatible endpoints (Groq cloud or a local Ollama), or none.
// With no provider configured, every feature still works from the graph alone (graph-only predictor, templates).
import "server-only";

export type Provider = "groq" | "ollama" | "none";

export function activeProvider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (p === "groq" || p === "ollama" || p === "none") return p;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OLLAMA_MODEL) return "ollama";
  return "none";
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

// Groq's free plan has a per-model daily token quota. When the main model's quota is used up, fall back to a second
// model with its own quota (default openai/gpt-oss-20b) instead of failing.
const g = globalThis as unknown as { __bpQuotaOut?: Record<string, number> };
const quotaOut: Record<string, number> = (g.__bpQuotaOut ??= {});

export async function chatComplete(
  provider: "groq" | "ollama", messages: ChatMsg[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}
): Promise<{ text: string; model: string }> {
  if (provider === "groq") {
    const primary = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
    const fallback = process.env.GROQ_FALLBACK_MODEL ?? "openai/gpt-oss-20b";
    const out = quotaOut[primary] && Date.now() - quotaOut[primary] < 30 * 60_000; // re-try the primary after 30 min
    try {
      return await callOnce(provider, out && fallback !== primary ? fallback : primary, messages, opts);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 429 && /tokens per day/i.test(err.message) && fallback !== primary && !out) {
        quotaOut[primary] = Date.now();
        console.warn(`[llm] daily quota for ${primary} used up; switching to ${fallback}`);
        return callOnce(provider, fallback, messages, opts);
      }
      throw e;
    }
  }
  return callOnce(provider, process.env.OLLAMA_MODEL ?? "qwen3:4b", messages, opts);
}

async function callOnce(
  provider: "groq" | "ollama", model: string, messages: ChatMsg[], opts: { json?: boolean; maxTokens?: number; temperature?: number }
): Promise<{ text: string; model: string }> {
  const groq = provider === "groq";
  const url = groq ? "https://api.groq.com/openai/v1/chat/completions" : `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/v1/chat/completions`;
  const body: Record<string, unknown> = { model, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens ?? 1200 };
  if (opts.json) body.response_format = { type: "json_object" };
  if (groq && model.startsWith("openai/gpt-oss")) body.reasoning_effort = "medium";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(groq ? { authorization: `Bearer ${process.env.GROQ_API_KEY}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? res.statusText;
    throw Object.assign(new Error(`${provider} ${res.status}: ${msg}`), { status: res.status, retryAfter: res.headers.get("retry-after") });
  }
  const text = String(json?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text, model: `${provider}:${json?.model ?? model}` };
}

/** JSON call with retry on rate limits (honours Retry-After) and one retry on malformed output. Null if unavailable. */
export async function llmJson<T = unknown>(system: string, user: string, opts: { maxTokens?: number; temperature?: number } = {}) {
  const provider = activeProvider();
  if (provider === "none") return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await chatComplete(provider, [{ role: "system", content: system }, { role: "user", content: user }],
        { json: true, maxTokens: opts.maxTokens ?? 1800, temperature: opts.temperature ?? 0.2 });
      return { model: r.model, json: JSON.parse(r.text.replace(/^```(json)?|```$/g, "").trim()) as T };
    } catch (e) {
      const err = e as Error & { status?: number; retryAfter?: string | null };
      if (err.status === 429 && attempt < 2 && !/tokens per day/i.test(err.message)) {
        await new Promise((r) => setTimeout(r, (Number(err.retryAfter) || 10) * 1000 + 500));
        continue;
      }
      console.warn(`[llm] ${provider} call failed (attempt ${attempt + 1}): ${err.message.slice(0, 200)}`);
      if (attempt === 0 && err.status !== 401 && err.status !== 429) continue;
      return null;
    }
  }
  return null;
}
