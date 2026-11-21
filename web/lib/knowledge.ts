// World knowledge for the idea graph (P7):
//   1. Entity linking: (:Concept)-[:SAME_AS {match}]->(:WikiEntity {qid, label, description, url, wikipedia, summary})
//                      (:WikiEntity)-[:INSTANCE_OF|SUBCLASS_OF]->(:WikiEntity)        (Wikidata P31 / P279)
//      Concepts from different claims and ideas now meet through shared Wikidata classes.
//   2. Web check of a claim: (:Source {url, title, snippet})-[:EVIDENCE {stance, by, at}]->(:Claim)
//      Only pages the search tool actually returned are stored; a second, tool-free call judges them.
// Free services: Wikidata API, Wikipedia REST API, Groq built-in browser_search (gpt-oss models).
import "server-only";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { activeProvider, chatComplete } from "@/lib/explain";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
const UA = { "user-agent": "BrainPrint/0.1 (Relate hackathon demo; non-commercial)" };
const now = () => new Date().toISOString();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite GET for Wikimedia APIs: retries 429/503 honouring Retry-After (Wikimedia API etiquette). */
async function getJson(url: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt * 2) * 1000);
      continue;
    }
    throw new Error(`${res.status} ${url.split("?")[0]}`);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. Wikidata entity linking

const JUNK = /disambiguation|family name|given name|surname|\bfilm\b|album|\bsong\b|single by|village|commune|human settlement|scholarly article|television series|episode|novel|\bband\b|video game|asteroid|genus|species|journal|magazine|painting|\bperson\b|footballer|politician/i;

type Candidate = { id: string; label?: string; description?: string };

async function searchWikidata(term: string): Promise<Candidate[]> {
  await sleep(400); // serial, spaced requests: Wikimedia asks clients not to hammer the API
  const s = await getJson("https://www.wikidata.org/w/api.php?" + new URLSearchParams({
    action: "wbsearchentities", search: term, language: "en", limit: "7", format: "json", origin: "*",
  }));
  return ((s.search ?? []) as Candidate[])
    .filter((c) => !JUNK.test(c.description ?? ""))
    .map((c) => ({ id: c.id, label: c.label, description: (c.description ?? "").slice(0, 120) }))
    .slice(0, 6);
}

const LINK_SYSTEM = `Entity linking. For each business/product concept (given with the pitch claims it came from), choose the Wikidata
item that means the same thing IN THAT CONTEXT, from its candidate list only. If no candidate fits (wrong sense, a place, a law,
a bias, a band...), return qid null and, if the concept is an abbreviation or awkward phrase, a better English search term
(e.g. "ai" -> "artificial intelligence", "receipts" -> "receipt"). Return JSON:
{"links":[{"concept":"<concept id>","qid":"Q123"|null,"search":"<better term>"|null}]}`;

type Todo = { id: string; name: string; context: string[] };

/** LLM disambiguation over candidate lists; only candidate QIDs are accepted. */
async function disambiguate(items: { t: Todo; cands: Candidate[] }[]) {
  const out = new Map<string, { qid: string | null; search: string | null }>();
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const prompt = batch.map(({ t, cands }) =>
      `CONCEPT ${t.id} "${t.name}"\n  from claims: ${t.context.map((c) => `"${c.slice(0, 110)}"`).join("; ")}\n  candidates: ` +
      (cands.length ? cands.map((c) => `${c.id} ${c.label} (${c.description || "no description"})`).join(" | ") : "none")).join("\n");
    try {
      const r = await chatComplete(activeProvider() as "groq" | "ollama", [
        { role: "system", content: LINK_SYSTEM }, { role: "user", content: prompt },
      ], { json: true, maxTokens: 1200, temperature: 0 });
      const links = (JSON.parse(r.text).links ?? []) as { concept: string; qid: string | null; search?: string | null }[];
      for (const { t, cands } of batch) {
        const l = links.find((x) => x.concept === t.id);
        const qid = l?.qid && cands.some((c) => c.id === l.qid) ? l.qid : null; // never accept a QID that was not a candidate
        out.set(t.id, { qid, search: l?.search && l.search.toLowerCase() !== t.name.toLowerCase() ? l.search.slice(0, 60) : null });
      }
    } catch (e) {
      const err = e as Error & { status?: number; retryAfter?: string | null };
      if (err.status === 429) { await sleep((Number(err.retryAfter) || 15) * 1000); i -= 10; continue; }
      for (const { t } of batch) out.set(t.id, { qid: null, search: null });
    }
  }
  return out;
}

/** Without an LLM: accept only an exact label match. */
const exactPick = (name: string, cands: Candidate[]) => cands.find((c) => (c.label ?? "").toLowerCase() === name.toLowerCase())?.id ?? null;

/**
 * Entity linking for not-yet-linked Concepts (optionally only one idea's): candidate generation (Wikidata search) +
 * in-context disambiguation (Groq, constrained to the candidates), one retry with a better search term, then details,
 * parent classes and the Wikipedia summary. `relink` clears existing links first.
 */
export async function linkConcepts(idea?: string, relink = false) {
  if (relink) {
    q(`MATCH (w:WikiEntity) DETACH DELETE w`);
    q(`MATCH (x:Concept) REMOVE x.linked_at`);
  }
  const todo: Todo[] = q(
    `MATCH (x:Concept) WHERE x.linked_at IS NULL
     ${idea ? "AND EXISTS { MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(:Claim)-[:MENTIONS]->(x) }" : ""}
     OPTIONAL MATCH (c:Claim)-[:MENTIONS]->(x)
     RETURN x.id AS id, x.name AS name, collect(c.text)[0..2] AS context`,
    { idea: idea ?? "" }
  ).map((r) => ({ id: String(r.id), name: String(r.name), context: (r.context as string[]) ?? [] }));
  if (!todo.length) return { linked: 0, tried: 0, failed: 0, by: "-" };
  const useLlm = activeProvider() === "groq" || activeProvider() === "ollama";

  // round 1: candidates for every concept name
  const cands = new Map<string, Candidate[]>();
  const failed = new Set<string>();
  for (const t of todo) {
    try { cands.set(t.id, await searchWikidata(t.name)); } catch { failed.add(t.id); }
  }
  const ready = todo.filter((t) => !failed.has(t.id));
  const decided = new Map<string, string | null>();
  if (useLlm) {
    const d1 = await disambiguate(ready.map((t) => ({ t, cands: cands.get(t.id) ?? [] })));
    // round 2: concepts the model could not link but gave a better search term for
    const retry = ready.filter((t) => !d1.get(t.id)?.qid && d1.get(t.id)?.search);
    const retryItems: { t: Todo; cands: Candidate[] }[] = [];
    for (const t of retry) {
      try { retryItems.push({ t, cands: await searchWikidata(d1.get(t.id)!.search!) }); } catch { /* keep round-1 result */ }
    }
    const d2 = retryItems.length ? await disambiguate(retryItems) : new Map();
    for (const it of retryItems) cands.set(it.t.id, [...(cands.get(it.t.id) ?? []), ...it.cands]);
    for (const t of ready) decided.set(t.id, d1.get(t.id)?.qid ?? d2.get(t.id)?.qid ?? null);
  } else {
    for (const t of ready) decided.set(t.id, exactPick(t.name, cands.get(t.id) ?? []));
  }
  const found = todo.map((t) => ({
    ...t, ok: !failed.has(t.id), qid: decided.get(t.id) ?? null,
    match: decided.get(t.id) ? (useLlm ? "llm-in-context" : "exact-label") : null,
  }));

  // entity details (batched): label, description, P31/P279, enwiki title
  const qids = [...new Set(found.map((f) => f.qid).filter(Boolean) as string[])];
  const ents: Record<string, { label: string; description: string; p31: string[]; p279: string[]; enwiki: string | null }> = {};
  for (let i = 0; i < qids.length; i += 45) {
    const e = await getJson("https://www.wikidata.org/w/api.php?" + new URLSearchParams({
      action: "wbgetentities", ids: qids.slice(i, i + 45).join("|"), props: "labels|descriptions|claims|sitelinks",
      languages: "en", sitefilter: "enwiki", format: "json", origin: "*",
    }));
    for (const [id, v] of Object.entries<any>(e.entities ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const ids = (p: string) => (v.claims?.[p] ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, 3); // eslint-disable-line @typescript-eslint/no-explicit-any
      ents[id] = { label: v.labels?.en?.value ?? id, description: v.descriptions?.en?.value ?? "", p31: ids("P31"), p279: ids("P279"), enwiki: v.sitelinks?.enwiki?.title ?? null };
    }
  }
  // parent labels
  const parents = [...new Set(Object.values(ents).flatMap((e) => [...e.p31, ...e.p279]))];
  const parentLabel: Record<string, string> = {};
  for (let i = 0; i < parents.length; i += 45) {
    const e = await getJson("https://www.wikidata.org/w/api.php?" + new URLSearchParams({
      action: "wbgetentities", ids: parents.slice(i, i + 45).join("|"), props: "labels", languages: "en", format: "json", origin: "*",
    }));
    for (const [id, v] of Object.entries<any>(e.entities ?? {})) parentLabel[id] = v.labels?.en?.value ?? id; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  // Wikipedia summaries
  const summaries: Record<string, string> = {};
  await pool(qids.filter((id) => ents[id]?.enwiki), 2, async (id) => {
    try {
      const w = await getJson("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(ents[id].enwiki!.replace(/ /g, "_")));
      summaries[id] = String(w.extract ?? "").slice(0, 600);
    } catch { /* no summary */ }
  });

  const at = now();
  q(`UNWIND $rows AS r MATCH (x:Concept {id: r.id}) SET x.linked_at = $at`, { at, rows: found.filter((f) => f.ok).map((f) => ({ id: f.id })) });
  const rows = found.filter((f) => f.qid && ents[f.qid!]).map((f) => {
    const e = ents[f.qid!];
    return {
      id: f.id, qid: f.qid, match: f.match, label: e.label, description: e.description,
      url: `https://www.wikidata.org/wiki/${f.qid}`,
      wikipedia: e.enwiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(e.enwiki.replace(/ /g, "_"))}` : null,
      summary: summaries[f.qid!] ?? null,
      p31: e.p31.map((p) => ({ qid: p, label: parentLabel[p] ?? p })), p279: e.p279.map((p) => ({ qid: p, label: parentLabel[p] ?? p })),
    };
  });
  q(
    `UNWIND $rows AS r MATCH (x:Concept {id: r.id})
     MERGE (w:WikiEntity {qid: r.qid})
     SET w.label = r.label, w.description = r.description, w.url = r.url, w.wikipedia = r.wikipedia, w.summary = r.summary, w.fetched_at = $at
     MERGE (x)-[s:SAME_AS]->(w) SET s.match = r.match
     FOREACH (p IN r.p31 | MERGE (pw:WikiEntity {qid: p.qid}) ON CREATE SET pw.label = p.label, pw.url = 'https://www.wikidata.org/wiki/' + p.qid MERGE (w)-[:INSTANCE_OF]->(pw))
     FOREACH (p IN r.p279 | MERGE (pw:WikiEntity {qid: p.qid}) ON CREATE SET pw.label = p.label, pw.url = 'https://www.wikidata.org/wiki/' + p.qid MERGE (w)-[:SUBCLASS_OF]->(pw))`,
    { at, rows }
  );
  checkpoint();
  return { linked: rows.length, tried: todo.length, failed: found.filter((f) => !f.ok).length, by: useLlm ? "wikidata search + LLM disambiguation" : "wikidata search + exact label" };
}

// ---------------------------------------------------------------------------------------------
// 2. Web check of one claim (Groq browser_search -> sources; then a tool-free judgement over those sources)

export async function checkClaim(claim: string) {
  const c = q(`MATCH (c:Claim {id: $claim}) OPTIONAL MATCH (i:Idea)-[:HAS_CLAIM]->(c) RETURN c.text AS text, i.title AS idea`, { claim })[0];
  if (!c) throw new Error(`unknown claim ${claim}`);
  if (activeProvider() !== "groq") throw new Error("Web checks need Groq (GROQ_API_KEY): it provides the built-in browser_search tool.");
  const model = process.env.GROQ_MODEL?.startsWith("openai/gpt-oss") ? process.env.GROQ_MODEL : "openai/gpt-oss-120b";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model, tools: [{ type: "browser_search" }], reasoning_effort: "low", max_completion_tokens: 900, temperature: 0.3,
      messages: [{ role: "user", content: `Search the web for evidence about this claim from a startup pitch and summarise what you find in 2-3 sentences: "${c.text}"` }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`groq ${res.status}: ${json?.error?.message ?? res.statusText}`), { status: res.status });
  const msg = json.choices?.[0]?.message ?? {};
  // only pages the tool actually returned count as sources
  const seen = new Map<string, { url: string; title: string; snippet: string }>();
  for (const t of msg.executed_tools ?? []) {
    for (const r of t.search_results?.results ?? []) {
      if (!r?.url || seen.has(r.url)) continue;
      const snippet = String(r.content ?? "").replace(/L\d+:\s?/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      seen.set(r.url, { url: String(r.url), title: String(r.title ?? r.url).slice(0, 200), snippet });
    }
  }
  const sources = [...seen.values()].slice(0, 8);
  if (!sources.length) return { claim, text: c.text, verdict: "unclear", summary: "The search returned no pages.", sources: [] };

  // judge with a tool-free JSON call, over the stored sources only
  const listing = sources.map((s, i) => `[S${i + 1}] ${s.title} (${s.url})\n${s.snippet || "(no text captured; title only)"}`).join("\n\n");
  let verdict = "unclear", summary = String(msg.content ?? "").replace(/【[^】]*】/g, "").slice(0, 400), used: number[] = [];
  try {
    const j = await chatComplete("groq", [
      { role: "system", content: `Judge a startup-pitch claim against web search results. Return JSON {"verdict":"supports|contradicts|mixed|unclear","summary":"<=2 sentences","sources":[indices of S used]}. Only use the listed sources; if they only have titles or are off-topic, answer "unclear". Pages from vendors selling a product are weak evidence; say so.` },
      { role: "user", content: `CLAIM: "${c.text}"\n\nSOURCES:\n${listing}` },
    ], { json: true, maxTokens: 700, temperature: 0.1 });
    const p = JSON.parse(j.text);
    if (["supports", "contradicts", "mixed", "unclear"].includes(p.verdict)) verdict = p.verdict;
    if (typeof p.summary === "string") summary = p.summary.slice(0, 400);
    used = (Array.isArray(p.sources) ? p.sources : []).map((x: unknown) => Number(String(x).replace(/\D/g, "")) - 1).filter((i: number) => i >= 0 && i < sources.length);
  } catch { /* keep the search model's own summary, verdict unclear */ }

  const at = now();
  q(`MATCH (c:Claim {id: $claim})
     SET c.web_verdict = $verdict, c.web_summary = $summary, c.web_checked_at = $at
     WITH c UNWIND $rows AS r
     MERGE (s:Source {url: r.url}) SET s.title = r.title, s.snippet = r.snippet, s.retrieved_at = $at
     MERGE (s)-[e:EVIDENCE]->(c) SET e.used = r.used, e.by = $by, e.at = $at`,
    { claim, verdict, summary, at, by: `${model} + browser_search`, rows: sources.map((s, i) => ({ ...s, used: used.includes(i) })) });
  checkpoint();
  return { claim, text: c.text, verdict, summary, sources: sources.map((s, i) => ({ ...s, used: used.includes(i) })) };
}

// ---------------------------------------------------------------------------------------------
// 3. Read side for the Idea Lab

// Upper-ontology classes that connect almost everything; useless as "bridges" between ideas.
const GENERIC_HUBS = ["academic discipline", "type of property", "activity", "process", "action", "industry", "condition",
  "relative quality", "concept", "economic concept", "economic activity", "occurrence", "entity", "class", "property", "group of humans",
  "human activity", "field of study", "branch of science", "quality", "phenomenon", "abstract object", "object", "system"];

export function ideaKnowledge(idea: string) {
  const concepts = q(
    `MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(c:Claim)-[:MENTIONS]->(x:Concept)
     OPTIONAL MATCH (x)-[s:SAME_AS]->(w:WikiEntity)
     OPTIONAL MATCH (w)-[:INSTANCE_OF|SUBCLASS_OF]->(p:WikiEntity)
     WITH x, s, w, collect(DISTINCT {qid: p.qid, label: p.label}) AS parents, collect(DISTINCT c.id) AS claims
     RETURN x.id AS concept, x.name AS name, w.qid AS qid, w.label AS label, w.description AS description, w.url AS url,
            w.wikipedia AS wikipedia, w.summary AS summary, s.match AS match, [p IN parents WHERE p.qid IS NOT NULL] AS parents, claims
     ORDER BY size(claims) DESC, name`, { idea });
  // bridges: other claims (probes or other ideas) whose concepts share a Wikidata entity or parent with this idea's concepts
  const bridges = q(
    `MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(:Claim)-[:MENTIONS]->(:Concept)-[:SAME_AS]->(w:WikiEntity)
     MATCH (w)-[:INSTANCE_OF|SUBCLASS_OF*0..1]->(hub:WikiEntity)<-[:INSTANCE_OF|SUBCLASS_OF*0..1]-(w2:WikiEntity)<-[:SAME_AS]-(:Concept)<-[:MENTIONS]-(k:Claim)
     WHERE NOT EXISTS { MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(k) } AND NOT hub.label IN $generic
     RETURN hub.qid AS hub, hub.label AS hub_label, collect(DISTINCT w.label)[0..3] AS here, collect(DISTINCT k.id)[0..4] AS claims,
            collect(DISTINCT k.text)[0..2] AS examples, count(DISTINCT k) AS n
     ORDER BY n DESC LIMIT 8`, { idea, generic: GENERIC_HUBS });
  const checks = q(
    `MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(c:Claim) WHERE c.web_checked_at IS NOT NULL
     OPTIONAL MATCH (s:Source)-[e:EVIDENCE]->(c)
     RETURN c.id AS claim, c.web_verdict AS verdict, c.web_summary AS summary,
            collect({url: s.url, title: s.title, used: e.used}) AS sources`, { idea });
  const triples = q(
    `MATCH (i:Idea {id: $idea})-[r:HAS_CLAIM]->(c:Claim)
     RETURN i.id AS a, 'Idea' AS a_label, i.title AS a_name, 'HAS_CLAIM' AS rel, c.id AS b, 'Claim' AS b_label, left(c.text, 40) AS b_name, null AS w
     UNION ALL
     MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(c:Claim)-[r:MENTIONS]->(x:Concept)
     RETURN c.id AS a, 'Claim' AS a_label, left(c.text, 40) AS a_name, 'MENTIONS' AS rel, x.id AS b, 'Concept' AS b_label, x.name AS b_name, null AS w
     UNION ALL
     MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(:Claim)-[:MENTIONS]->(x:Concept)-[r:SAME_AS]->(w:WikiEntity)
     RETURN DISTINCT x.id AS a, 'Concept' AS a_label, x.name AS a_name, 'SAME_AS' AS rel, w.qid AS b, 'WikiEntity' AS b_label, w.label AS b_name, null AS w
     UNION ALL
     MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(:Claim)-[:MENTIONS]->(:Concept)-[:SAME_AS]->(w:WikiEntity)-[r:INSTANCE_OF|SUBCLASS_OF]->(p:WikiEntity)
     RETURN DISTINCT w.qid AS a, 'WikiEntity' AS a_label, w.label AS a_name, type(r) AS rel, p.qid AS b, 'WikiEntity' AS b_label, p.label AS b_name, null AS w
     UNION ALL
     MATCH (:Idea {id: $idea})-[:HAS_CLAIM]->(c:Claim)<-[r:EVIDENCE]-(s:Source) WHERE r.used
     RETURN s.url AS a, 'Source' AS a_label, left(s.title, 30) AS a_name, 'EVIDENCE' AS rel, c.id AS b, 'Claim' AS b_label, left(c.text, 40) AS b_name, null AS w`,
    { idea });
  return { concepts, bridges, checks, triples };
}
