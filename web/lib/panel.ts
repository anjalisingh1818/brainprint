// Brain Panel: put a problem or an idea in front of every brain and see how each one reacts, in its own voice,
// and how it would solve it; then a synthesis of agreement, conflict and a joint solution.
//
//   (:Idea {kind: problem|idea})-[:HAS_CLAIM]->(:Claim)            the question, split into points (lib/ideas.ts)
//   (:Response {reaction, says, concerns[], would_do, by})-[:BY]->(:Brain), -[:TO]->(:Idea), -[:CITES]->(:Claim)
//   (:Synthesis {consensus[], conflicts_json, joint_solution, next_questions[]})-[:OF]->(:Idea)
//
// Each response is GraphRAG: the graph retrieves the brain's beliefs most relevant to the question (Relate vector
// index over claim embeddings, keeping only claims this brain has a STANCE on), with its verbatim quotes and style;
// the LLM writes the response and cites those beliefs, and the server keeps only citations that were provided.
import "server-only";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { embed } from "@/lib/embed";
import { brainStats, STANCE_LABEL } from "@/lib/brains";
import { llmJson } from "@/lib/llm";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
const now = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export const REACTIONS = ["enthusiastic", "positive", "neutral", "skeptical", "opposed"] as const;

function evidenceFor(brain: string, text: string, vec: number[], limit = 14) {
  return q(
    `MATCH (k:Claim) SEARCH k IN (VECTOR INDEX claim_embedding FOR $vec LIMIT 200) SCORE AS sim
     WITH k, sim
     MATCH (:Brain {id: $brain})-[s:STANCE]->(k)
     OPTIONAL MATCH (k)-[:MENTIONS]->(x:Concept)
     RETURN k.id AS claim, k.text AS text, s.value AS stance, s.note AS quote, s.source AS source,
            collect(x.name)[0..3] AS concepts, round(2 * sim - 1, 3) AS similarity
     ORDER BY similarity DESC LIMIT $limit`, { brain, vec, limit });
}

function profile(brain: string) {
  return q(`MATCH (:Brain {id: $brain})-[s:STANCE]->(:Claim)-[:MENTIONS]->(x:Concept)
            RETURN x.name AS name, round(avg(s.value), 2) AS mean, count(*) AS n ORDER BY n DESC, name LIMIT 8`, { brain });
}

const RESPOND_SYSTEM = `You speak AS one persona ("brain") that its trainer built from their own answers and words. You get the
brain's description, talking style, and its BELIEFS most relevant to the question (each with its stance and, when available,
a verbatim quote). Respond the way this persona would, staying consistent with the beliefs; do not invent new strong opinions
the evidence does not support (if the evidence is thin, say what you'd need to know). Return JSON:
{"reaction":"enthusiastic|positive|neutral|skeptical|opposed","says":"2-4 sentences in this persona's own voice and style",
"concerns":["short concern", "..."],"would_do":"1-3 sentences: how this persona would solve it or what it would change",
"evidence":["B1","B4"]}
"evidence": the belief keys (B1, B2, ...) you relied on, 1-4 of them.`;

export async function respond(ideaId: string, brain: string) {
  const idea = q(`MATCH (i:Idea {id: $id}) RETURN i.title AS title, i.text AS text, i.kind AS kind`, { id: ideaId })[0];
  if (!idea) throw new Error(`unknown question ${ideaId}`);
  const b = q(`MATCH (b:Brain {id: $brain}) RETURN b.name AS name, b.description AS description, b.style_json AS style`, { brain })[0];
  if (!b) throw new Error(`unknown brain ${brain}`);
  const [vec] = await embed([`${idea.title}. ${idea.text}`.slice(0, 2000)]);
  const ev = evidenceFor(brain, String(idea.text), vec);
  const prof = profile(brain);
  const stats = brainStats(brain);

  const key = new Map(ev.map((e, i) => [`B${i + 1}`, String(e.claim)]));
  const user =
    `BRAIN: ${b.name}. Description: ${b.description || "(none)"}\n` +
    `STYLE: ${b.style ? String(b.style) : "(unknown; plain voice)"}\n` +
    `CARES ABOUT (mean stance per concept, -1..1): ${prof.map((p) => `${p.name} ${p.mean} (n=${p.n})`).join(", ") || "(little data)"}\n` +
    `BELIEFS (most relevant first):\n` +
    (ev.map((e, i) => `- [B${i + 1}] "${e.text}" -> ${STANCE_LABEL[String(e.stance)]}${e.quote ? `; in their words: "${e.quote}"` : ""}`).join("\n") || "(none)") +
    `\n\n${String(idea.kind) === "idea" ? "IDEA / PITCH" : "PROBLEM / QUESTION"}: "${idea.title}"\n${idea.text}`;

  const res = await llmJson<{ reaction?: string; says?: string; concerns?: string[]; would_do?: string; evidence?: string[] }>(
    RESPOND_SYSTEM, user, { maxTokens: 1400, temperature: 0.5 });

  let out: { reaction: string; says: string; concerns: string[]; would_do: string; cites: string[]; by: string };
  if (res && REACTIONS.includes(String(res.json.reaction) as (typeof REACTIONS)[number]) && res.json.says) {
    out = {
      reaction: String(res.json.reaction), says: String(res.json.says).slice(0, 800),
      concerns: (res.json.concerns ?? []).map(String).slice(0, 4), would_do: String(res.json.would_do ?? "").slice(0, 600),
      cites: (res.json.evidence ?? []).map((k) => key.get(String(k).replace(/[\[\]\s]/g, "").toUpperCase())).filter((x): x is string => Boolean(x)).slice(0, 4),
      by: res.model,
    };
  } else {
    // graph-only fallback: summarise the brain's stances on the most relevant beliefs
    const top = ev.slice(0, 4);
    const mean = top.length ? top.reduce((s, e) => s + Number(e.stance), 0) / top.length : 0;
    out = {
      reaction: mean > 0.5 ? "positive" : mean < -0.5 ? "skeptical" : "neutral",
      says: top.length
        ? top.map((e) => `${({ "1": "I agree with", "0": "I'm neutral on", "-1": "I disagree with" } as Record<string, string>)[String(e.stance)]} “${String(e.text).replace(/\.$/, "")}”.`).join(" ") +
          " (Graph-only summary of my closest beliefs: no language model was available to answer in my voice.)"
        : "I have not said anything about this yet. Train me in Talk or Quiz mode.",
      concerns: [], would_do: "", cites: top.map((e) => String(e.claim)), by: "graph-only (no LLM)",
    };
  }

  const rid = newId("resp");
  q(`MATCH (b:Brain {id: $brain}), (i:Idea {id: $idea})
     OPTIONAL MATCH (old:Response)-[:BY]->(b) WHERE (old)-[:TO]->(i)
     DETACH DELETE old`, { brain, idea: ideaId });
  q(`MATCH (b:Brain {id: $brain}), (i:Idea {id: $idea})
     CREATE (r:Response {id: $rid, reaction: $reaction, says: $says, concerns: $concerns, would_do: $would_do, by: $by, at: $at})
     CREATE (r)-[:BY]->(b) CREATE (r)-[:TO]->(i)
     WITH r UNWIND $cites AS cid MATCH (c:Claim {id: cid}) MERGE (r)-[:CITES]->(c)`,
    { brain, idea: ideaId, rid, ...out, at: now() });
  checkpoint();

  const cited = ev.filter((e) => out.cites.includes(String(e.claim)));
  return { id: rid, brain, name: String(b.name), ...out, cited, stats, evidence_count: ev.length };
}

const SYNTH_SYSTEM = `You chair a panel of persona "brains" (each a model of answers its trainer gave, with a measured accuracy).
Given each brain's reaction to the same problem or idea, return JSON:
{"consensus":["point most brains share", "..."],
 "conflicts":[{"topic":"","sides":[{"brain":"<brain id>","position":"short"}]}],
 "joint_solution":"3-5 sentences: a solution or revised idea that takes every brain's main concern into account",
 "next_questions":["what to test or ask next", "..."]}
Only use what the brains said. Refer to brains by their ids exactly as given. Keep it concrete.`;

export async function synthesize(ideaId: string) {
  const idea = q(`MATCH (i:Idea {id: $id}) RETURN i.title AS title, i.text AS text, i.kind AS kind`, { id: ideaId })[0];
  if (!idea) throw new Error(`unknown question ${ideaId}`);
  const rs = q(`MATCH (r:Response)-[:TO]->(:Idea {id: $id}), (r)-[:BY]->(b:Brain)
                RETURN b.id AS brain, b.name AS name, r.reaction AS reaction, r.says AS says, r.concerns AS concerns,
                       r.would_do AS would_do ORDER BY name`, { id: ideaId });
  if (rs.length < 2) throw new Error("Ask at least two brains before synthesising.");
  const user = `${String(idea.kind) === "idea" ? "IDEA" : "PROBLEM"}: "${idea.title}"\n${idea.text}\n\nRESPONSES:\n` +
    rs.map((r) => {
      const s = brainStats(String(r.brain));
      const acc = s.cv ? `CV accuracy ${Math.round(s.cv.accuracy * 100)}% vs baseline ${Math.round(s.cv.baseline * 100)}%` : `${s.answers} answers, accuracy not measured`;
      return `- ${r.brain} (${r.name}; ${acc}): reaction ${r.reaction}. Says: "${r.says}" Concerns: ${(r.concerns as string[]).join("; ") || "none"}. Would do: ${r.would_do || "-"}`;
    }).join("\n");
  const res = await llmJson<{ consensus?: string[]; conflicts?: { topic: string; sides: { brain: string; position: string }[] }[]; joint_solution?: string; next_questions?: string[] }>(
    SYNTH_SYSTEM, user, { maxTokens: 1600, temperature: 0.3 });
  const ids = new Set(rs.map((r) => String(r.brain)));
  let out;
  if (res) {
    out = {
      consensus: (res.json.consensus ?? []).map(String).slice(0, 5),
      conflicts: (res.json.conflicts ?? []).slice(0, 4).map((c) => ({
        topic: String(c.topic ?? ""), sides: (c.sides ?? []).filter((s) => ids.has(String(s.brain))).map((s) => ({ brain: String(s.brain), position: String(s.position) })),
      })).filter((c) => c.sides.length > 0),
      joint_solution: String(res.json.joint_solution ?? ""), next_questions: (res.json.next_questions ?? []).map(String).slice(0, 4), by: res.model,
    };
  } else {
    const by = (r: string) => rs.filter((x) => x.reaction === r).map((x) => String(x.name));
    out = {
      consensus: [`Positive: ${[...by("enthusiastic"), ...by("positive")].join(", ") || "none"}; sceptical or opposed: ${[...by("skeptical"), ...by("opposed")].join(", ") || "none"}.`],
      conflicts: [], joint_solution: "", next_questions: [], by: "graph-only (no LLM)",
    };
  }
  q(`MATCH (i:Idea {id: $id}) OPTIONAL MATCH (old:Synthesis)-[:OF]->(i) DETACH DELETE old`, { id: ideaId });
  q(`MATCH (i:Idea {id: $id})
     CREATE (s:Synthesis {id: $sid, consensus: $consensus, conflicts_json: $conflicts, joint_solution: $joint, next_questions: $next, by: $by, at: $at})
     CREATE (s)-[:OF]->(i)`,
    { id: ideaId, sid: newId("syn"), consensus: out.consensus, conflicts: JSON.stringify(out.conflicts), joint: out.joint_solution,
      next: out.next_questions, by: out.by, at: now() });
  checkpoint();
  return out;
}

/** Everything stored for one question: responses (with cited beliefs) and the synthesis. */
export function panelState(ideaId: string) {
  const responses = q(
    `MATCH (r:Response)-[:TO]->(:Idea {id: $id}), (r)-[:BY]->(b:Brain)
     OPTIONAL MATCH (r)-[:CITES]->(c:Claim)<-[s:STANCE]-(b)
     RETURN r.id AS id, b.id AS brain, b.name AS name, r.reaction AS reaction, r.says AS says, r.concerns AS concerns,
            r.would_do AS would_do, r.by AS by,
            [x IN collect({claim: c.id, text: c.text, stance: s.value, quote: s.note}) WHERE x.claim IS NOT NULL] AS cited
     ORDER BY name`, { id: ideaId }).map((r) => ({ ...r, stats: brainStats(String(r.brain)) }));
  const syn = q(`MATCH (s:Synthesis)-[:OF]->(:Idea {id: $id})
                 RETURN s.consensus AS consensus, s.conflicts_json AS conflicts, s.joint_solution AS joint_solution,
                        s.next_questions AS next_questions, s.by AS by`, { id: ideaId })[0];
  const triples = q(
    `MATCH (r:Response)-[:TO]->(i:Idea {id: $id}), (r)-[:BY]->(b:Brain)
     RETURN b.id AS a, 'Brain' AS a_label, b.name AS a_name, 'RESPONDED' AS rel, i.id AS b, 'Idea' AS b_label, i.title AS b_name, null AS w
     UNION ALL
     MATCH (r:Response)-[:TO]->(:Idea {id: $id}), (r)-[:BY]->(b:Brain), (r)-[:CITES]->(c:Claim)
     RETURN b.id AS a, 'Brain' AS a_label, b.name AS a_name, 'BELIEVES' AS rel, c.id AS b, 'Claim' AS b_label, left(c.text, 40) AS b_name, null AS w
     UNION ALL
     MATCH (r:Response)-[:TO]->(:Idea {id: $id}), (r)-[:CITES]->(c:Claim)-[:MENTIONS]->(x:Concept)
     RETURN DISTINCT c.id AS a, 'Claim' AS a_label, left(c.text, 40) AS a_name, 'MENTIONS' AS rel, x.id AS b, 'Concept' AS b_label, x.name AS b_name, null AS w`,
    { id: ideaId });
  const idea = q(`MATCH (i:Idea {id: $id}) RETURN i.title AS title, i.text AS text, coalesce(i.kind, 'idea') AS kind`, { id: ideaId })[0] ?? null;
  return {
    idea,
    responses,
    synthesis: syn ? { ...syn, conflicts: JSON.parse(String(syn.conflicts ?? "[]")) } : null,
    triples,
  };
}
