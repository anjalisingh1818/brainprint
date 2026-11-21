// Graph-first explainer: the SERVER runs a fixed set of Relate queries for the moment in focus,
// packs a compact evidence bundle (~3k tokens), and makes ONE call to a free/open model
// (Groq or a local Ollama), or, with no model configured, writes the answer from a template.
// This keeps every answer graph-grounded and fits Groq's free-plan limit (8K tokens/minute).
import "server-only";
import { runNamed, type Row } from "@/lib/relate";
import {
  Recorder, focusInsight, revisionsOf, similarMoments, segmentContext, weakestSecondOf,
} from "@/lib/graphTools";
import { extractCitations, type AgentContext, type ChatTurn } from "@/lib/agent";

export type Provider = "groq" | "ollama" | "anthropic" | "none";

export function activeProvider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (p === "groq" || p === "ollama" || p === "anthropic" || p === "none") return p;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OLLAMA_MODEL) return "ollama";
  return "none";
}

const KIND_LABEL: Record<string, string> = { attention_dip: "Attention dip", drift: "Possible drift", overload: "Possible overload" };
const NET_LABEL: Record<string, string> = {
  visual: "Visual", auditory: "Auditory", language: "Language", attention: "Attention",
  default_mode: "Default mode", motor: "Motor", other: "Other",
};
const r2 = (x: unknown) => Math.round(Number(x) * 100) / 100;
const signed = (x: number) => `${x > 0 ? "+" : ""}${r2(x)}`;

// ---------------------------------------------------------------------------------------------
// 1. Evidence bundle from the graph

type Bundle = {
  pitch: { id: string; title: string; source: string; project: string | null; script: string | null };
  lens: { id: string; weights: { network: string; w: number; base_w: number }[] };
  insights: { id: string; kind: string; t: string; severity: number; drivers: string[]; feedback: { verdict: string; comment: string | null }[] }[];
  focus: null | {
    insight: string; kind: string; t_start: number; t_end: number; severity: number;
    weakest_second: { segment: string; t: number; text: string; lens_score: number } | null;
    context: { segment: string; t: number; text: string; top_networks: string[]; insights: string[] }[];
    similar_elsewhere: { segment: string; pitch: string; t: number; text: string; similarity: number; flagged_as: string[]; fixed_by: string[]; feedback: unknown[] }[];
  };
  revisions: { revision: string; role: string; note: string; impact: Row | null }[];
};

export function buildBundle(ctx: AgentContext, rec: Recorder): Bundle {
  const stimulus = ctx.stimulus ?? "pitch_jargon";
  const lens = ctx.lens ?? "engagement";
  const t = ctx.t ?? 0;

  const meta = rec.run("run_named_query", { name: "stimulus_meta", params: { stimulus } }, () => runNamed("stimulus_meta", { stimulus }))[0] ?? {};
  const lensRow = rec.run("run_named_query", { name: "lenses" }, () => runNamed("lenses")).find((l) => l.lens === lens);
  const ins = rec.run("run_named_query", { name: "insight_evidence", params: { stimulus } }, () => runNamed("insight_evidence", { stimulus }));

  const f = rec.run("focus_insight", { stimulus, t, insight: ctx.insight }, () => focusInsight(stimulus, t, ctx.insight))[0];
  let focus: Bundle["focus"] = null;
  if (f) {
    const weak = rec.run("weakest_second_of", { insight: f.insight, lens }, () => weakestSecondOf(String(f.insight), lens))[0];
    const center = weak ? String(weak.segment) : `${stimulus}:${f.t_start}`;
    const ctxRows = rec.run("get_segment_context", { segment_id: center, window: 3 }, () => segmentContext(center, 3));
    const sim = rec.run("find_similar_moments", { segment_id: center, k: 4 }, () => similarMoments(center, 4));
    focus = {
      insight: String(f.insight), kind: String(f.kind), t_start: Number(f.t_start), t_end: Number(f.t_end), severity: r2(f.severity),
      weakest_second: weak ? { segment: String(weak.segment), t: Number(weak.t), text: String(weak.text), lens_score: r2(weak.score) } : null,
      context: ctxRows.map((c) => ({
        segment: String(c.segment), t: Number(c.t), text: String(c.text),
        top_networks: (c.networks as { network: string; local_z: number }[])
          .slice().sort((a, b) => Math.abs(b.local_z) - Math.abs(a.local_z)).slice(0, 3)
          .map((n) => `${n.network} ${signed(n.local_z)}`),
        insights: c.insights as string[],
      })),
      similar_elsewhere: sim.map((s) => ({
        segment: String(s.segment), pitch: String(s.pitch), t: Number(s.t), text: String(s.text), similarity: r2(s.similarity),
        flagged_as: s.insights as string[], fixed_by: s.fixed_by as string[], feedback: s.feedback as unknown[],
      })),
    };
  }

  const revs = rec.run("revisions_of", { stimulus }, () => revisionsOf(stimulus)).map((r) => ({
    revision: String(r.revision), role: String(r.role), note: String(r.note),
    impact: rec.run("run_named_query", { name: "revision_impact", params: { revision: r.revision, lens } },
      () => runNamed("revision_impact", { revision: String(r.revision), lens }))[0] ?? null,
  }));

  return {
    pitch: { id: stimulus, title: String(meta.title ?? stimulus), source: String(meta.source ?? "?"), project: (meta.project as string) ?? null, script: (meta.script as string) ?? null },
    lens: { id: lens, weights: ((lensRow?.weights as { network: string; w: number; base_w: number }[]) ?? []).map((w) => ({ network: w.network, w: r2(w.w), base_w: r2(w.base_w) })) },
    insights: ins.map((i) => ({
      id: String(i.insight), kind: String(i.kind), t: `${i.t_start}-${i.t_end}s`, severity: r2(i.severity),
      drivers: (i.drivers as { network: string; z: number }[]).map((d) => `${d.network} ${signed(d.z)}`),
      feedback: ((i.feedback as { verdict: string; comment: string | null }[]) ?? []).map((f) => ({ verdict: f.verdict, comment: f.comment })),
    })),
    focus,
    revisions: revs,
  };
}

/** The evidence as numbered facts, each carrying the exact citation tag to copy (much easier for small models than JSON). */
function evidenceFacts(b: Bundle): string {
  const L: string[] = [];
  const lensW = b.lens.weights.map((w) => `${signed(w.w)}*${w.network}`).join(" ");
  const drift = b.lens.weights.filter((w) => Math.abs(w.w - w.base_w) >= 0.005);
  L.push(`P1 [[Stimulus:${b.pitch.id}]] pitch "${b.pitch.title}" (project ${b.pitch.project ?? "?"}), data source: ${b.pitch.source}.`);
  if (b.pitch.script) L.push(`SCRIPT: """${b.pitch.script.replace(/\s+/g, " ").trim().slice(0, 1500)}"""`);
  L.push(`L1 [[Lens:${b.lens.id}]] lens score = ${lensW} (weights over network z-scores; not a person).` +
    (drift.length ? ` Calibrated by founder feedback from base: ${drift.map((w) => `${w.network} ${signed(w.base_w)}->${signed(w.w)}`).join(", ")}.` : " Not calibrated yet (base weights)."));
  b.insights.forEach((i, k) =>
    L.push(`I${k + 1} [[Insight:${i.id}]] ${KIND_LABEL[i.kind] ?? i.kind}, t=${i.t}, severity ${i.severity}; drivers (z within pitch): ${i.drivers.join(", ")}.` +
      (i.feedback.length ? ` FOUNDER FEEDBACK: ${i.feedback.map((f) => `${f.verdict}${f.comment ? ` ("${f.comment}")` : ""}`).join("; ")}.` : " No founder feedback yet.")));
  const f = b.focus;
  if (f) {
    L.push(`FOCUS = [[Insight:${f.insight}]] (t=${f.t_start}-${f.t_end}s).`);
    if (f.weakest_second)
      L.push(`W1 [[Segment:${f.weakest_second.segment}]] weakest second of the focus: t=${f.weakest_second.t}s, words "${f.weakest_second.text}", ${b.lens.id} score ${signed(f.weakest_second.lens_score)}.`);
    f.context.forEach((c, k) =>
      L.push(`C${k + 1} [[Segment:${c.segment}]] t=${c.t}s words "${c.text}"; strongest networks (z within pitch): ${c.top_networks.join(", ")}${c.insights.length ? `; covered by ${c.insights.join(", ")}` : ""}.`));
    f.similar_elsewhere.forEach((s, k) =>
      L.push(`S${k + 1} [[Segment:${s.segment}]] SIMILAR predicted pattern in OTHER pitch ${s.pitch} at t=${s.t}s, words "${s.text}", similarity ${s.similarity}; ` +
        `flagged as: ${s.flagged_as.length ? s.flagged_as.join(", ") : "nothing"}; fixed by: ${s.fixed_by.length ? s.fixed_by.join(", ") : "nothing"}; feedback: ${s.feedback.length ? JSON.stringify(s.feedback) : "none"}.`));
  }
  b.revisions.forEach((r, k) => {
    const im = r.impact;
    L.push(`R${k + 1} [[Revision:${r.revision}]] this pitch is the ${r.role === "FROM" ? "ORIGINAL (before)" : "REVISED (after)"} version. Change: "${r.note}".` +
      (im ? ` Measured ${b.lens.id}: mean ${signed(Number(im.before_mean))} -> ${signed(Number(im.after_mean))}, worst second ${signed(Number(im.before_min))} -> ${signed(Number(im.after_min))}, rule insights ${im.insights_before} -> ${im.insights_after}, fixes claimed ${im.claimed_fixes}, confirmed by feedback ${im.confirmed_fixes}.` : ""));
  });
  return L.join("\n");
}

/** Map fact keys (P1, I2, W1, C3, S1, R1, ...) to their citation tag, for models that cite the key instead of the tag. */
function factKeyMap(facts: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of facts.split("\n")) {
    const r = /^([A-Z]\d+) (\[\[[^\]]+\]\])/.exec(line);
    if (r) m.set(r[1], r[2]);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// 2. One LLM call (OpenAI-compatible: Groq cloud or local Ollama)

const SYSTEM = `You are BrainPrint's analyst. You get EVIDENCE from a Relate graph about a short product pitch and answer the founder's question.
The evidence is Meta TRIBE v2 *predictions* of an average brain's response (7 networks, z-scores). They are not measurements.

Hard rules:
1. Language: say "predicted attention signal", "predicted default-mode signal", "predicted language processing".
   Never say viewers/listeners/the brain felt, lost focus, wandered, understood, liked or would buy anything.
   Never explain WHY in causal brain terms ("lexical load pulls resources"); report what co-occurs with which words.
2. Numbers: only quote numbers that appear in the evidence. NEVER predict scores for a rewrite; instead say a rewrite
   should be re-run through TRIBE (and that rev_ledgerly-style revisions can be compared with revision_impact).
3. Lenses are weightings over networks, not people.
4. Citations: every evidence fact starts with its tag, e.g. [[Segment:pitch_jargon:30]]. Copy the tag of each fact you use,
   unchanged, right after the sentence that uses it. Networks are cited as [[Network:attention]], [[Network:default_mode]],
   [[Network:language]], etc. Never invent a tag; never cite a fact you did not use.
5. If there are S or R facts, use one in one bullet: what happened at a similar moment in another pitch (only what its fact says:
   "flagged as", "fixed by"), or what the revision changed and its measured before/after. Do not add claims the facts do not state.
6. If asked for a fix: quote the original line and give ONE concrete rewrite in plain words. Use only facts already in the
   SCRIPT (names, numbers, claims). Never invent statistics, customers or results; write a placeholder like [X hours] instead.
7. Founder feedback outranks rule insights: if an insight is CONTRADICTED, say the founder judged it not an issue and do not
   recommend fixing it; if CONFIRMED, treat it as the priority and mention the founder's note.
8. Format: at most 150 words, 3-5 "- " bullets plus one rewrite line. No headings, no tables, no horizontal rules.`;

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

async function chatComplete(provider: "groq" | "ollama", messages: ChatMsg[]): Promise<{ text: string; model: string }> {
  const groq = provider === "groq";
  const url = groq ? "https://api.groq.com/openai/v1/chat/completions" : `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/v1/chat/completions`;
  const model = groq ? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" : process.env.OLLAMA_MODEL ?? "qwen3:4b";
  const body: Record<string, unknown> = { model, messages, temperature: 0.3, max_tokens: 1200 };
  if (groq && model.startsWith("openai/gpt-oss")) body.reasoning_effort = "medium"; // evidence is small; spend tokens on accuracy
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

// ---------------------------------------------------------------------------------------------
// 3. Template answer (no LLM): always available, also the fallback when the LLM call fails

function templateAnswer(b: Bundle): string {
  const out: string[] = [];
  if (b.pitch.source === "synthetic-placeholder") out.push("_Note: this pitch uses placeholder curves, not real TRIBE v2 predictions._");
  if (!b.focus) {
    out.push(`No rule insight fired for [[Stimulus:${b.pitch.id}]]: no second is clearly below this pitch's predicted attention baseline.`);
    return out.join("\n");
  }
  const f = b.focus;
  const ins = b.insights.find((i) => i.id === f.insight);
  out.push(`**${KIND_LABEL[f.kind] ?? f.kind}** at t=${f.t_start}-${f.t_end}s [[Insight:${f.insight}]] (severity ${f.severity}).`);
  if (f.weakest_second)
    out.push(`- Lowest ${b.lens.id} score (${signed(f.weakest_second.lens_score)}) at t=${f.weakest_second.t}s while the script says "${f.weakest_second.text}" [[Segment:${f.weakest_second.segment}]].`);
  if (ins?.feedback.length)
    out.push(`- Your feedback: ${ins.feedback.map((f) => `${f.verdict.toLowerCase()}${f.comment ? ` ("${f.comment}")` : ""}`).join("; ")}.`);
  if (ins?.drivers.length)
    out.push(`- Driving networks (z within the pitch): ${ins.drivers.map((d) => { const [n, z] = d.split(" "); return `${NET_LABEL[n] ?? n} ${z} [[Network:${n}]]`; }).join(", ")}.`);
  const words = f.context.map((c) => c.text).filter(Boolean).join(" ");
  if (words) out.push(`- Words around it: "${words}"`);
  const sim = f.similar_elsewhere[0];
  if (sim)
    out.push(`- Most similar predicted pattern elsewhere: ${sim.pitch} t=${sim.t}s ("${sim.text}", similarity ${sim.similarity}) [[Segment:${sim.segment}]]` +
      (sim.fixed_by.length ? `, part of an insight later fixed by [[Revision:${sim.fixed_by[0]}]].` : "."));
  for (const r of b.revisions) {
    const im = r.impact;
    if (im) out.push(`- [[Revision:${r.revision}]] (${r.note}): mean ${b.lens.id} ${signed(Number(im.before_mean))} → ${signed(Number(im.after_mean))}, insights ${im.insights_before} → ${im.insights_after}.`);
  }
  out.push("_Generated directly from graph queries (no language model)._");
  return out.join("\n");
}

/**
 * Small models often drop the label ([[pitch_jargon:30]] instead of [[Segment:pitch_jargon:30]]) or use the wrong one.
 * Ids in this graph have recognisable shapes, so infer the label; unknown ids are left as written (and show unverified).
 */
function normalizeCitations(text: string, b: Bundle, keys: Map<string, string> = new Map()): string {
  const networks = new Set(Object.keys(NET_LABEL));
  const lenses = new Set(["engagement", "clarity", "visual_hook", b.lens.id]);
  const stimuli = new Set([b.pitch.id, ...(b.focus?.similar_elsewhere.map((s) => s.pitch) ?? []),
    ...b.revisions.flatMap((r) => [r.impact?.before, r.impact?.after].filter(Boolean) as string[])]);
  const labelFor = (id: string): string | null => {
    if (/^[a-z0-9_]+:(attention_dip|drift|overload):\d+$/.test(id)) return "Insight";
    if (/^[a-z0-9_]+:\d+$/.test(id)) return "Segment";
    if (id.startsWith("rev_")) return "Revision";
    if (networks.has(id)) return "Network";
    if (lenses.has(id)) return "Lens";
    if (stimuli.has(id)) return "Stimulus";
    return null;
  };
  return text.replace(/\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
    const s = inner.trim();
    if (keys.has(s)) return keys.get(s)!;
    const m = /^([A-Za-z]+):(.+)$/.exec(s);
    const known = ["Insight", "Segment", "Revision", "Network", "Lens", "Stimulus", "Project", "Feedback"];
    const lab = m ? known.find((k) => k.toLowerCase() === m[1].toLowerCase()) : undefined;
    if (m && lab) {
      const fixed = labelFor(m[2]);
      return `[[${fixed ?? lab}:${m[2]}]]`;
    }
    const label = labelFor(s);
    return label ? `[[${label}:${s}]]` : whole;
  });
}

// ---------------------------------------------------------------------------------------------

export async function askGraphFirst(history: ChatTurn[], ctx: AgentContext, provider: Provider) {
  const rec = new Recorder();
  const bundle = buildBundle(ctx, rec);
  const placeholder = bundle.pitch.source === "synthetic-placeholder";
  const finish = (raw: string, model: string, note?: string) => {
    const body = normalizeCitations(raw, bundle, factKeyMap(evidenceFacts(bundle)))
      .replace(/(\[\[[^\]]+\]\])(?:[\s,]*\1)+/g, "$1"); // collapse repeated identical tags
    const answer = [
      // Added by the server, not left to the model: placeholder data must always be flagged.
      placeholder && !body.startsWith("_Note") ? "_Note: this pitch uses placeholder curves, not real TRIBE v2 predictions._" : "",
      body,
      note ? `_${note}_` : "",
    ].filter(Boolean).join("\n\n");
    return { answer, citations: extractCitations(answer, rec.seen), trace: rec.trace, model, mode: "graph-first" };
  };

  if (provider === "none") return finish(templateAnswer(bundle), "template (no LLM)");

  const question = history.at(-1)?.content ?? "";
  const prior: ChatMsg[] = history.slice(-5, -1).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  const evidence = evidenceFacts(bundle);
  try {
    const { text, model } = await chatComplete(provider as "groq" | "ollama", [
      { role: "system", content: SYSTEM },
      ...prior,
      { role: "user", content: `EVIDENCE (JSON from the Relate graph):\n${evidence}\n\nUI: pitch=${bundle.pitch.id} lens=${bundle.lens.id} cursor t=${ctx.t ?? 0}s\n\nQUESTION: ${question}` },
    ]);
    if (!text) return finish(templateAnswer(bundle), "template (empty model reply)");
    return finish(text, model);
  } catch (e) {
    const err = e as Error & { status?: number; retryAfter?: string | null };
    const why = err.status === 429
      ? `The ${provider} free-tier rate limit was hit${err.retryAfter ? ` (retry in ~${err.retryAfter}s)` : ""}, so this answer was built from the graph without a language model.`
      : `The ${provider} call failed (${err.message.slice(0, 160)}), so this answer was built from the graph without a language model.`;
    return finish(templateAnswer(bundle), "template (fallback)", why);
  }
}
