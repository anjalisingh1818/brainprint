// POST /api/agent  {messages: [{role, content}], context: {stimulus, insight, t, lens}}
// -> {answer, citations: [{label, id, verified}], trace: [{tool, input, rows, ms}], model, mode, provider}
// Provider is chosen by LLM_PROVIDER / which key is set in web/.env.local (see web/.env.example).
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { askAgent } from "@/lib/agent";
import { activeProvider, askGraphFirst } from "@/lib/explain";
import { StoreLockedError } from "@/lib/relate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) })).min(1).max(40),
  context: z
    .object({
      stimulus: z.string().optional(),
      insight: z.string().nullable().optional(),
      t: z.number().optional(),
      lens: z.string().optional(),
    })
    .default({}),
  // "graph-only" answers from graph queries alone (no language model), whatever is configured.
  mode: z.enum(["auto", "graph-only"]).default("auto"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request body" }, { status: 400 });
  try {
    const { messages, context, mode } = parsed.data;
    const provider = mode === "graph-only" ? "none" : activeProvider();
    // Claude runs the full multi-step tool agent; free/open models (Groq, Ollama) and the no-key mode
    // use the graph-first explainer: fixed Relate queries + one model call (or a template).
    const result = provider === "anthropic" ? await askAgent(messages, context) : await askGraphFirst(messages, context, provider);
    return NextResponse.json({ ...result, provider });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || /api key|apiKey|authentication/i.test(String((e as Error).message))) {
      return NextResponse.json(
        { error: "No valid Anthropic credentials. Put ANTHROPIC_API_KEY=... in web/.env.local and restart `npm run dev`." },
        { status: 401 }
      );
    }
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "Rate limited by the Claude API, try again shortly." }, { status: 429 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude API error ${e.status}: ${e.message}` }, { status: 502 });
    if (e instanceof StoreLockedError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
