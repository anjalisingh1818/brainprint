// BrainPrint agent: Claude + tools that query the Relate graph in-process.
//
// The tool names get_schema / read_cypher mirror Relate's own MCP server (`relate serve --mcp`),
// so the same questions work from any MCP host against graph/brainprint.rl (see README).
// Every graph id the tools return is recorded; the answer's [[Label:id]] citations are then
// checked against that set, so an id the model never actually retrieved is flagged.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { namedQueries, runNamed, type Row } from "@/lib/relate";
import { Recorder, readCypher, schemaSummary, segmentContext, similarMoments, type TraceStep } from "@/lib/graphTools";

export const MODEL = "claude-opus-5-5";

export type { TraceStep };
export type Citation = { label: string; id: string; verified: boolean };
export type AgentContext = { stimulus?: string; insight?: string | null; t?: number; lens?: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are BrainPrint's analyst. You help a founder improve a short product pitch using a Relate graph database
that stores Meta TRIBE v2 *predictions* of how an average brain would respond to each second of the pitch.

## What the data is (be honest about it)
- Values are model-predicted fMRI-like responses for an average subject, aggregated into 7 brain networks
  (visual, auditory, language, attention, default_mode, motor, other) and 148 cortical regions.
- They are NOT measurements, opinions, emotions, comprehension scores or buying intent. Say "predicted attention signal",
  "predicted language processing" etc. Never claim a viewer "was confused" or "didn't like" something; say the prediction
  is consistent with lower attention / possible drift / possible overload.
- Lenses (Engagement, Clarity, Visual hook) are weightings over networks, not people or audience segments.
- If a Stimulus has source "synthetic-placeholder", its curves come from text heuristics, not TRIBE. Say so once, briefly.

## Graph schema (Relate, Cypher)
(:Project {id,name})-[:HAS_STIMULUS]->(:Stimulus {id,title,source,duration_s,script})
(:Stimulus)-[:HAS_SEGMENT]->(:Segment {id:"<stimulus>:<t>", stimulus_id, t, text, embedding[148]})-[:NEXT]->(:Segment)
(:Segment)-[:ACTIVATES {strength /*z vs all pitches*/, local_z /*z within the pitch*/, raw}]->(:Network {name})
(:Lens {id,name})-[:WEIGHTS {w, base_w}]->(:Network)     lens score(segment) = sum(w * strength)
(:Insight {id, kind: attention_dip|drift|overload, t_start, t_end, severity, summary, stimulus_id})-[:ABOUT]->(:Segment)
(:Insight)-[:SEEN_THROUGH]->(:Lens)
(:Revision {id,note})-[:FROM]->(:Stimulus), -[:TO]->(:Stimulus), -[:FIXES]->(:Insight)
(:Feedback {id,verdict,comment})-[:CONFIRMS|CONTRADICTS]->(:Insight)
(:Segment)-[:SIMILAR_TO {score}]->(:Segment)   precomputed top-3 neighbours in OTHER pitches (vector index segment_embedding)

## How to work
1. Ground every claim in tool results. Prefer run_named_query; use get_segment_context for the words and networks
   around a moment; use find_similar_moments to see what happened at moments with a similar predicted brain pattern
   in OTHER pitches (were they flagged? fixed by a Revision? confirmed or contradicted by Feedback?);
   use read_cypher for anything else (read-only).
2. When explaining a weak moment: name the time range, quote the words, name the 1-3 networks driving it with their values.
3. When suggesting a fix: propose a concrete rewrite of the quoted line(s). If a Revision fixed a similar moment elsewhere,
   say what it changed and whether feedback confirmed it. Keep fixes specific to the script.
4. Feedback nodes are the founder's own judgements; weight them above rule insights and mention them.

## Citations (required)
Cite every graph node you rely on inline as [[Label:id]], using ids exactly as returned by tools, e.g.
[[Insight:pitch_jargon:attention_dip:25]], [[Segment:pitch_jargon:26]], [[Network:attention]], [[Lens:engagement]],
[[Revision:rev_ledgerly_v2]], [[Stimulus:pitch_jargon_v2]]. Only cite ids that appeared in tool results.

## Style
Short and direct: at most ~200 words unless asked for more. Use a few bullets, no headings larger than "###".
End with at most one suggested next step.`;

// ---- helpers -------------------------------------------------------------------------------

/** Shrink rows for the model: drop big numeric arrays, cap long strings and row count. */
function compact(rows: Row[], maxRows = 60): unknown {
  const shrink = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      if (v.length > 16 && v.every((x) => typeof x === "number")) return `[${v.length} numbers omitted]`;
      return v.slice(0, 40).map(shrink);
    }
    if (typeof v === "string") return v.length > 600 ? v.slice(0, 600) + "…" : v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.kind === "node") return { labels: o.labels, ...(shrink(o.properties) as object) };
      if (o.kind === "relationship") return { type: o.type, ...(shrink(o.properties) as object) };
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, shrink(x)]));
    }
    return v;
  };
  const out = rows.slice(0, maxRows).map(shrink);
  return rows.length > maxRows ? { rows: out, truncated: `${rows.length - maxRows} more rows not shown` } : { rows: out };
}

export function extractCitations(text: string, seen: Set<string>): Citation[] {
  const out = new Map<string, Citation>();
  for (const m of text.matchAll(/\[\[([A-Za-z]+):([^\]\s]+)\]\]/g)) {
    const key = `${m[1]}:${m[2]}`;
    if (!out.has(key)) out.set(key, { label: m[1], id: m[2], verified: seen.has(m[2]) });
  }
  return [...out.values()];
}

// ---- tools -----------------------------------------------------------------------------------

function makeTools(rec: Recorder) {
  const step = (tool: string, input: unknown, fn: () => Row[]): string => {
    try {
      return JSON.stringify(compact(rec.run(tool, input, fn)));
    } catch (e) {
      return JSON.stringify({ error: String((e as Error).message ?? e).slice(0, 400) });
    }
  };

  const queries = namedQueries();
  const namedList = Object.values(queries)
    .map((q) => `- ${q.name}(${Object.keys(q.params).join(", ")}): ${q.description}`)
    .join("\n");

  return [
    betaZodTool({
      name: "get_schema",
      description: "Counts of every node label and relationship type in the BrainPrint Relate graph, plus all Stimulus, Lens and Revision ids.",
      inputSchema: z.object({}),
      run: async () =>
        step("get_schema", {}, schemaSummary),
    }),
    betaZodTool({
      name: "run_named_query",
      description: `Run one of BrainPrint's curated Cypher queries (graph/queries.cypher). Available:\n${namedList}\nParams not given fall back to the defaults shown in each query.`,
      inputSchema: z.object({
        name: z.enum(Object.keys(queries) as [string, ...string[]]),
        params: z.record(z.string(), z.string()).optional().describe("query parameters, e.g. {\"stimulus\": \"pitch_jargon\"}"),
      }),
      run: async ({ name, params }) => step("run_named_query", { name, params }, () => runNamed(name, params ?? {})),
    }),
    betaZodTool({
      name: "get_segment_context",
      description: "Words and per-network predicted signals for the seconds around one Segment (same pitch), plus insights covering them.",
      inputSchema: z.object({
        segment_id: z.string().describe('e.g. "pitch_jargon:26"'),
        window: z.number().int().min(0).max(10).optional().describe("seconds before/after, default 3"),
      }),
      run: async ({ segment_id, window }) =>
        step("get_segment_context", { segment_id, window }, () => segmentContext(segment_id, window ?? 3)),
    }),
    betaZodTool({
      name: "find_similar_moments",
      description:
        "Live vector search (Relate VECTOR INDEX segment_embedding over 148-region predicted brain patterns) for moments in OTHER pitches that look most like this segment, with any insights on them, revisions that fixed those insights, and feedback.",
      inputSchema: z.object({
        segment_id: z.string(),
        k: z.number().int().min(1).max(10).optional().describe("how many neighbours, default 5"),
      }),
      run: async ({ segment_id, k }) =>
        step("find_similar_moments", { segment_id, k }, () => similarMoments(segment_id, k ?? 5)),
    }),
    betaZodTool({
      name: "read_cypher",
      description:
        "Run any READ-ONLY Cypher statement on the graph (same contract as Relate MCP's read_cypher). Writes and schema changes are rejected. Avoid returning the embedding property.",
      inputSchema: z.object({
        statement: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      }),
      run: async ({ statement, parameters }) =>
        step("read_cypher", { statement, parameters }, () => readCypher(statement, parameters ?? {})),
    }),
  ];
}

// ---- entry point -----------------------------------------------------------------------------

export async function askAgent(history: ChatTurn[], ctx: AgentContext) {
  const rec = new Recorder();
  const client = new Anthropic();

  const ctxLine =
    `[UI context] pitch=${ctx.stimulus ?? "?"} lens=${ctx.lens ?? "engagement"} t=${ctx.t ?? 0}s` +
    (ctx.insight ? ` selected_insight=${ctx.insight}` : "") +
    ` (Segment id at the cursor: ${ctx.stimulus}:${ctx.t ?? 0})`;
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m, i) => ({
    role: m.role,
    content: i === history.length - 1 && m.role === "user" ? `${ctxLine}\n\n${m.content}` : m.content,
  }));

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    cache_control: { type: "ephemeral" },
    output_config: { effort: "medium" },
    // If Claude Opus 5.5 declines on a safety classifier, the API re-runs the turn on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools: makeTools(rec),
    messages,
    max_iterations: 12,
  });

  if (final.stop_reason === "refusal") {
    return { answer: "The model declined to answer this request.", citations: [], trace: rec.trace, model: final.model, mode: "claude-agent" };
  }
  const answer = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { answer, citations: extractCitations(answer, rec.seen), trace: rec.trace, model: final.model, mode: "claude-agent" };
}
