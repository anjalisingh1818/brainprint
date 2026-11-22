// Idea Lab: an idea (text, optionally linked to a TRIBE-analysed pitch) -> claims -> each brain's predicted stance
// -> recommendations. Everything is stored in the Relate graph:
//   (:Idea {id, title, text})-[:HAS_CLAIM]->(:Claim {source:'idea'})-[:MENTIONS]->(:Concept)
//   Idea.kind: 'problem' (a question for the panel) or 'idea' (a pitch whose points the brains react to)
//   (:Brain)-[:PREDICTS {stance, confidence, score, at}]->(:Claim)
import "server-only";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { ensureSeeded, predictMany, retrieve, upsertClaims, STANCE_LABEL, type Prediction, type Stance } from "@/lib/brains";
import { activeProvider, chatComplete } from "@/lib/llm";
import { extractCitations } from "@/lib/citations";
import { linkConcepts } from "@/lib/knowledge";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

type ExtractedClaim = { text: string; concepts: string[] };

const EXTRACT_SYSTEM = `You split a product idea, pitch, or problem statement into the separate CLAIMS a listener could agree or disagree with.
Return JSON: {"claims": [{"text": "...", "concepts": ["...", "..."]}]}
Rules: 4-10 claims. Each claim is one short first-person-neutral sentence (max 20 words) that keeps the pitch's own facts and
numbers; do not add facts. "concepts": 1-3 short lowercase noun phrases naming what the claim is about
(e.g. "price", "time saving", "privacy", "food waste", "artificial intelligence", "taxes", "traction").`;

/** Offline fallback: one claim per sentence, concepts from a small keyword list. */
function fallbackClaims(text: string): ExtractedClaim[] {
  const KEYWORDS: Record<string, string> = {
    price: "price", pay: "price", "%": "price", euro: "price", dollar: "price", subscription: "subscription",
    hour: "time saving", time: "time saving", minute: "time saving", ai: "artificial intelligence", "ai-": "artificial intelligence",
    bank: "banking", tax: "taxes", receipt: "paperwork", waste: "food waste", bread: "food waste", bakery: "local business",
    freelanc: "freelancing", privacy: "privacy", secure: "security", raising: "fundraising", users: "traction", customers: "traction",
  };
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4)
    .slice(0, 10)
    .map((s) => {
      const low = s.toLowerCase();
      const concepts = [...new Set(Object.entries(KEYWORDS).filter(([k]) => low.includes(k)).map(([, v]) => v))].slice(0, 3);
      return { text: s.length > 160 ? s.slice(0, 157) + "…" : s, concepts: concepts.length ? concepts : ["general"] };
    });
}

async function extractClaims(text: string): Promise<{ claims: ExtractedClaim[]; by: string }> {
  const provider = activeProvider();
  if (provider === "groq" || provider === "ollama") {
    try {
      const { text: out, model } = await chatComplete(provider, [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: text.slice(0, 4000) },
      ], { json: true, maxTokens: 1500 });
      const parsed = JSON.parse(out.replace(/^```(json)?|```$/g, "").trim()) as { claims?: ExtractedClaim[] };
      const claims = (parsed.claims ?? [])
        .filter((c) => typeof c?.text === "string" && c.text.trim())
        .map((c) => ({ text: c.text.trim().slice(0, 200), concepts: (c.concepts ?? []).map(String).slice(0, 3) }))
        .slice(0, 10);
      if (claims.length >= 2) return { claims, by: model };
    } catch {
      /* fall through to the offline splitter */
    }
  }
  return { claims: fallbackClaims(text), by: "sentence splitter (no LLM)" };
}

export async function createIdea(input: { title: string; text: string; kind?: "problem" | "idea" }) {
  await ensureSeeded();
  const id = `idea_${slug(input.title) || "untitled"}_${Date.now().toString(36).slice(-5)}`;
  const { claims, by } = await extractClaims(input.text);
  q(`CREATE (i:Idea {id: $id, title: $title, text: $text, kind: $kind, created_at: $at, extracted_by: $by})`,
    { id, title: input.title.slice(0, 120), text: input.text.slice(0, 6000), kind: input.kind ?? "idea", at: new Date().toISOString(), by });
  await upsertClaims(claims.map((c, k) => ({ id: `${id}:c${k + 1}`, text: c.text, concepts: c.concepts, source: "idea" })));
  q(`MATCH (i:Idea {id: $id}) UNWIND range(1, $n) AS k MATCH (c:Claim {id: $id + ':c' + toString(k)})
     MERGE (i)-[r:HAS_CLAIM]->(c) SET r.order = k`, { id, n: claims.length });
  checkpoint();
  // entity-link the new concepts to Wikidata in the background (Wikimedia rate limits make this take ~1 min)
  linkConcepts(id).catch((e) => console.warn(`[ideas] concept linking failed: ${String(e).slice(0, 200)}`));
  return { id, claims: claims.length, extracted_by: by };
}

export function listIdeas() {
  return q(`MATCH (i:Idea) OPTIONAL MATCH (i)-[:HAS_CLAIM]->(c) OPTIONAL MATCH (r:Response)-[:TO]->(i)
            RETURN i.id AS id, i.title AS title, coalesce(i.kind, 'idea') AS kind, i.created_at AS created_at,
                   count(DISTINCT c) AS claims, count(DISTINCT r) AS responses
            ORDER BY created_at DESC`);
}

export type Cell = { brain: string; claim: string } & Pick<Prediction, "stance" | "label" | "confidence" | "score" | "evidence" | "concepts" | "by" | "because">;

const LANDS: Record<string, string> = { "1": "lands", "0": "neutral", "-1": "puts off" };

/**
 * Predict whether each idea claim LANDS with each brain (1 lands / 0 neutral / -1 puts off), store PREDICTS edges and summarise.
 * Predictions are cached on the PREDICTS edges and reused until the brain learns something new (b.updated_at), so
 * re-opening an idea costs no LLM calls. One GraphRAG call per brain that needs refreshing.
 */
export async function evaluateIdea(id: string, opts: { refresh?: boolean } = {}) {
  await ensureSeeded();
  const idea = q(`MATCH (i:Idea {id: $id})
                  RETURN i.id AS id, i.title AS title, i.text AS text, coalesce(i.kind, 'idea') AS kind, i.extracted_by AS extracted_by`, { id })[0];
  if (!idea) throw new Error(`unknown idea ${id}`);
  const claims = q(`MATCH (:Idea {id: $id})-[r:HAS_CLAIM]->(c:Claim) OPTIONAL MATCH (c)-[:MENTIONS]->(x:Concept)
                    RETURN c.id AS claim, c.text AS text, r.order AS ord, collect(x.name) AS concepts ORDER BY ord`, { id });
  const claimIds = claims.map((c) => String(c.claim));
  const brains = q(`MATCH (b:Brain) OPTIONAL MATCH (b)-[s:STANCE]->()
                    RETURN b.id AS brain, b.name AS name, b.example AS example, b.checks AS checks, b.correct AS correct,
                           b.cv_accuracy AS cv, b.cv_n AS cv_n, b.cv_baseline AS cv_baseline, b.updated_at AS updated_at,
                           count(s) AS answers ORDER BY example, name`);

  const cells: Cell[] = [];
  for (const b of brains) {
    const brain = String(b.brain);
    const cached = opts.refresh ? [] : q(
      `MATCH (b:Brain {id: $brain})-[p:PREDICTS]->(c:Claim) WHERE c.id IN $ids AND (b.updated_at IS NULL OR p.at > b.updated_at)
       RETURN c.id AS claim, p.stance AS stance, p.confidence AS confidence, p.score AS score, p.by AS by, p.because AS because`,
      { brain, ids: claimIds });
    if (cached.length === claimIds.length) {
      for (const r of cached) {
        const { ev, concepts } = retrieve(brain, String(r.claim)); // graph-only, cheap: evidence for display
        const stance = Number(r.stance) as Stance;
        cells.push({ brain, claim: String(r.claim), stance, label: LANDS[String(stance)], confidence: Number(r.confidence),
          score: Number(r.score), by: `${r.by} (cached)`, because: (r.because as string[]) ?? [], evidence: ev, concepts });
      }
      continue;
    }
    const fresh = await predictMany(brain, claimIds);
    q(`UNWIND $rows AS r MATCH (b:Brain {id: $brain}), (c:Claim {id: r.claim})
       MERGE (b)-[p:PREDICTS]->(c) SET p.stance = r.stance, p.confidence = r.confidence, p.score = r.score, p.by = r.by,
                                       p.because = r.because, p.at = $at`,
      { brain, at: new Date().toISOString(),
        rows: fresh.map((c) => ({ claim: c.claim, stance: c.stance ?? 0, confidence: c.confidence, score: c.score, by: c.by, because: c.because })) });
    cells.push(...fresh.map((c) => ({ ...c, label: c.stance === null ? "unsure" : LANDS[String(c.stance)] })));
  }
  checkpoint();

  const summary = brains.map((b) => {
    const mine = cells.filter((c) => c.brain === b.brain);
    const lands = mine.filter((c) => c.stance === 1).length, putsOff = mine.filter((c) => c.stance === -1).length;
    const worst = mine.filter((c) => c.stance === -1).sort((x, y) => x.score - y.score)[0];
    return {
      brain: String(b.brain), name: String(b.name), example: Boolean(b.example), answers: Number(b.answers),
      checks: Number(b.checks), accuracy: Number(b.checks) ? Math.round((Number(b.correct) / Number(b.checks)) * 100) / 100 : null,
      cv: b.cv == null ? null : { accuracy: Number(b.cv), n: Number(b.cv_n), baseline: Number(b.cv_baseline) },
      lands, puts_off: putsOff, neutral: mine.length - lands - putsOff, strongest_objection: worst ? worst.claim : null,
    };
  });
  return { idea, claims, brains: summary, cells };
}

// ---------------------------------------------------------------------------------------------
// recommendations: one LLM call over tagged facts (same pattern as the pitch explainer), or a template

const RECO_SYSTEM = `You advise a founder using predictions from "brains": models of mindsets that the founder TRAINED by answering questions.
For each point (claim) of the idea, each brain has a prediction: "lands" (convincing/appealing to that brain), "neutral", or
"puts off". A brain is only as good as its training: when you rely on a brain, mention its cross-validated accuracy vs its
baseline (or that it was not measured yet). Brains are NOT real people, customers or a market; never say "people will" or
"customers will". Say "the Cautious-investor brain is predicted to be put off by ...".
Use only the facts. Cite every fact you use by copying its tag exactly, e.g. [[Claim:idea_x:c3]] [[Brain:brain_busy_freelancer]] [[Concept:price]].
Output: 3-5 "- " bullets on which points are predicted to land or put off which brains and why (the answers or concepts behind it),
then a line "Recommendations:" followed by 2-3 "- " bullets with concrete edits to the idea text (quote the original words).
Never invent statistics, customers or results. Max 220 words.
KNOWLEDGE lines link concepts to Wikidata; WEB lines are web-search results judged by a model (cite the [[Source:...]] tags,
say "a web check found ...", and treat vendor pages as weak evidence). Use them when they change a recommendation.`;

function accText(b: { cv: { accuracy: number; n: number; baseline: number } | null; checks: number; accuracy: number | null }) {
  if (b.cv) return `cross-validated accuracy ${Math.round(b.cv.accuracy * 100)}% (baseline ${Math.round(b.cv.baseline * 100)}%, n=${b.cv.n})`;
  if (b.checks >= 5 && b.accuracy !== null) return `self-test accuracy ${Math.round(b.accuracy * 100)}% over ${b.checks} checks`;
  return "accuracy not measured yet";
}

export async function recommend(id: string) {
  const ev = await evaluateIdea(id); // uses cached predictions when possible: keeps us under Groq's free-tier token limit
  const seen = new Set<string>();
  const L: string[] = [];
  const tag = (label: string, v: string) => { seen.add(v); return `[[${label}:${v}]]`; };
  const cslug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  L.push(`IDEA ${tag("Idea", String(ev.idea.id))} "${ev.idea.title}"`);
  for (const b of ev.brains)
    L.push(`${tag("Brain", b.brain)} ${b.name}: trained on ${b.answers} answers; ${accText(b)}${b.example ? "; scripted example brain" : ""}.`);
  for (const c of ev.claims) {
    L.push(`${tag("Claim", String(c.claim))} "${c.text}" concepts: ${(c.concepts as string[]).map((x) => tag("Concept", cslug(x))).join(" ")}`);
    for (const cell of ev.cells.filter((x) => x.claim === c.claim)) {
      const b = ev.brains.find((x) => x.brain === cell.brain)!;
      const ids = cell.because.length ? cell.because : cell.evidence.slice(0, 2).map((e) => e.claim);
      const why = cell.evidence.filter((e) => ids.includes(e.claim)).slice(0, 2)
        .map((e) => `answered ${STANCE_LABEL[String(e.stance)]} to ${tag("Claim", e.claim)} "${e.text}"${e.note ? ` (note "${e.note}")` : ""}`).join("; ");
      const cons = cell.concepts.slice(0, 2).map((x) => `${tag("Concept", x.concept)} mean stance ${x.mean} over ${x.n}`).join(", ");
      L.push(`  -> ${b.name}: predicted ${cell.label}${cell.stance === null ? "" : ` (confidence ${cell.confidence})`}${why ? `; because it ${why}` : ""}${cons ? `; concepts: ${cons}` : ""}.`);
    }
  }
  // world knowledge: Wikidata meaning of the idea's concepts, and web checks of its claims
  const kn = q(`MATCH (:Idea {id: $id})-[:HAS_CLAIM]->(:Claim)-[:MENTIONS]->(x:Concept)-[:SAME_AS]->(w:WikiEntity)
                RETURN DISTINCT x.id AS concept, w.qid AS qid, w.label AS label, w.description AS description`, { id: ev.idea.id });
  for (const k of kn) L.push(`KNOWLEDGE ${tag("Concept", String(k.concept))} = Wikidata ${k.qid} "${k.label}": ${k.description || "(no description)"}`);
  const web = q(`MATCH (:Idea {id: $id})-[:HAS_CLAIM]->(c:Claim) WHERE c.web_checked_at IS NOT NULL
                 OPTIONAL MATCH (s:Source)-[e:EVIDENCE {used: true}]->(c)
                 RETURN c.id AS claim, c.web_verdict AS verdict, c.web_summary AS summary, collect(s.url)[0..3] AS urls`, { id: ev.idea.id });
  for (const w of web)
    L.push(`WEB ${tag("Claim", String(w.claim))} check: ${w.verdict}. ${w.summary ?? ""} Sources: ${(w.urls as string[]).filter(Boolean).map((u) => tag("Source", u)).join(" ") || "none"}`);
  const facts = L.join("\n");
  const provider = activeProvider();
  let answer = "", model = "template (no LLM)", note = "";
  if (provider === "groq" || provider === "ollama") {
    for (let attempt = 0; attempt < 3 && !answer; attempt++) {
      try {
        const r = await chatComplete(provider, [{ role: "system", content: RECO_SYSTEM }, { role: "user", content: `FACTS:\n${facts}\n\nAdvise on this idea.` }], { maxTokens: 1600 });
        answer = r.text; model = r.model;
      } catch (e) {
        const err = e as Error & { status?: number; retryAfter?: string | null };
        if (err.status === 429 && attempt < 2) { await new Promise((res) => setTimeout(res, (Number(err.retryAfter) || 10) * 1000 + 500)); continue; }
        note = `_The ${provider} call failed (${err.message.slice(0, 120)}), so this summary was built from the graph without a language model._`;
        break;
      }
    }
  }
  if (!answer) {
    const lines = ev.brains.map((b) => {
      const obj = b.strongest_objection ? ev.claims.find((c) => c.claim === b.strongest_objection) : null;
      return `- [[Brain:${b.brain}]] (${b.answers} answers, ${accText(b)}): ${b.lands} of ${ev.claims.length} points predicted to land, ${b.puts_off} to put it off, ${b.neutral} neutral.` +
        (obj ? ` Strongest predicted turn-off: "${obj.text}" [[Claim:${obj.claim}]].` : "");
    });
    answer = [...lines, note || "_Generated from graph predictions without a language model._"].join("\n");
  }
  answer = answer.replace(/\[\[(Concept):([^\]]+)\]\]/g, (_, l, v) => `[[${l}:${cslug(String(v))}]]`);
  return { ...ev, advice: answer, citations: extractCitations(answer, seen), model };
}
