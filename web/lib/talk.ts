// Talk mode: build a brain from natural conversation (or pasted text written by the person).
//
//   (:Brain)-[:SAID]->(:Utterance {id, text, at})-[:SUPPORTS]->(:Claim)
//   (:Brain)-[:STANCE {value, note: verbatim quote, source: 'talk'}]->(:Claim)-[:MENTIONS]->(:Concept)
//   Brain.style_json: {tone, vocabulary, sentence_length, signature_phrases[]}   (how this persona talks)
//
// Each message is read by the LLM, which extracts beliefs as short neutral statements with a stance and a VERBATIM
// supporting quote (quotes that are not literally in the message are dropped). A belief that matches an existing claim
// (vector index, cosine >= 0.86) reuses that claim, so brains connect through shared claims in the graph.
import "server-only";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { embed } from "@/lib/embed";
import { upsertClaims, STANCE_LABEL } from "@/lib/brains";
import { llmJson } from "@/lib/llm";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
const now = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type Style = { tone: string; vocabulary: string; sentence_length: string; signature_phrases: string[] };
type Belief = { statement: string; stance: "agree" | "disagree" | "neutral"; concepts: string[]; quote: string };

const EXTRACT_SYSTEM = `You are building a model of ONE person ("brain") from what they say. Read their message and extract:
1. beliefs: up to 6 opinions the message clearly expresses. Write each as a short, general statement (max 18 words)
   phrased FAVOURABLY toward its topic, and put the person's direction in "stance" -- so "agree" always means positive
   about the topic. Examples: they distrust AI with money -> "I trust AI to handle my money-related paperwork." + disagree;
   they hate subscriptions -> "I would happily pay a monthly subscription for a tool that saves me time." + disagree;
   they want numbers -> "Concrete numbers convince me more than adjectives." + agree.
   stance: agree | disagree | neutral. concepts: 1-3 lowercase topics (e.g. "artificial intelligence", "subscription", "price").
   quote: the EXACT words from the message that show it (copy verbatim, 3-25 words). Do not invent beliefs that are not said.
2. style: how this person talks, merged with the PREVIOUS style: tone (e.g. "blunt, sceptical"), vocabulary
   (e.g. "plain, finance terms"), sentence_length ("short"|"medium"|"long"), signature_phrases (up to 5 short phrases they use).
3. follow_up: ONE natural question to learn more about this person, preferably about a topic in GAPS, in a friendly tone.
4. ack: one sentence summarising what you learned (second person, e.g. "Got it: you distrust subscriptions...").
Return JSON: {"beliefs":[{"statement":"","stance":"agree","concepts":[""],"quote":""}],"style":{"tone":"","vocabulary":"",
"sentence_length":"","signature_phrases":[]},"follow_up":"","ack":""}`;

function brainInfo(brain: string) {
  const b = q(`MATCH (b:Brain {id: $brain}) RETURN b.name AS name, b.description AS description, b.style_json AS style`, { brain })[0];
  if (!b) throw new Error(`unknown brain ${brain}`);
  return { name: String(b.name), description: String(b.description ?? ""), style: b.style ? (JSON.parse(String(b.style)) as Style) : null };
}

/** Concepts this brain has said little about, from the concepts other brains/probes cover. */
function gaps(brain: string): string[] {
  return q(
    `MATCH (x:Concept)<-[:MENTIONS]-(c:Claim) WHERE c.source IN ['probe', 'talk']
     OPTIONAL MATCH (:Brain {id: $brain})-[s:STANCE]->(:Claim)-[:MENTIONS]->(x)
     WITH x, count(DISTINCT c) AS reach, count(s) AS mine
     WHERE mine = 0 RETURN x.name AS name ORDER BY reach DESC LIMIT 8`, { brain }).map((r) => String(r.name));
}

/** Reuse an existing claim when a new belief means (almost) the same thing. */
async function matchOrCreateClaims(beliefs: Belief[]) {
  const vecs = await embed(beliefs.map((b) => b.statement));
  const ids: string[] = [];
  const fresh: { id: string; text: string; concepts: string[]; source: string }[] = [];
  for (let i = 0; i < beliefs.length; i++) {
    const hit = q(
      `MATCH (k:Claim) SEARCH k IN (VECTOR INDEX claim_embedding FOR $vec LIMIT 1) SCORE AS sim
       RETURN k.id AS id, sim`, { vec: vecs[i] })[0];
    if (hit && Number(hit.sim) >= 0.93) ids.push(String(hit.id)); // Relate cosine is rebounded: 0.93 ~= raw 0.86
    else {
      const id = newId("talk");
      fresh.push({ id, text: beliefs[i].statement, concepts: beliefs[i].concepts, source: "talk" });
      ids.push(id);
    }
  }
  if (fresh.length) await upsertClaims(fresh);
  return ids;
}

export async function talk(brain: string, message: string) {
  const info = brainInfo(brain);
  const text = message.trim().slice(0, 4000);
  const uid = newId("utt");
  q(`MATCH (b:Brain {id: $brain}) CREATE (b)-[:SAID]->(:Utterance {id: $uid, text: $text, at: $at})`,
    { brain, uid, text, at: now() });

  const user = `BRAIN: ${info.name}. Description: ${info.description || "(none)"}\n` +
    `PREVIOUS STYLE: ${info.style ? JSON.stringify(info.style) : "(none yet)"}\nGAPS: ${gaps(brain).join(", ") || "(none)"}\n\nMESSAGE:\n${text}`;
  const res = await llmJson<{ beliefs?: Belief[]; style?: Style; follow_up?: string; ack?: string }>(EXTRACT_SYSTEM, user, { maxTokens: 1800 });
  if (!res) {
    checkpoint();
    return {
      utterance: uid, learned: [], style: info.style, by: "none",
      ack: "Saved your message. Learning from free text needs an LLM (set GROQ_API_KEY); meanwhile use Quiz mode to train this brain.",
      follow_up: null,
    };
  }

  // keep only beliefs whose quote really appears in the message
  const msgNorm = norm(text);
  const beliefs = (res.json.beliefs ?? [])
    .filter((b) => b && typeof b.statement === "string" && ["agree", "disagree", "neutral"].includes(b.stance))
    .filter((b) => typeof b.quote === "string" && b.quote.trim().length > 0 && msgNorm.includes(norm(b.quote)))
    .slice(0, 6)
    .map((b) => ({ ...b, statement: b.statement.trim().slice(0, 200), concepts: (b.concepts ?? []).map(String).slice(0, 3) }));
  const dropped = (res.json.beliefs ?? []).length - beliefs.length;

  const ids = beliefs.length ? await matchOrCreateClaims(beliefs) : [];
  const value = { agree: 1, neutral: 0, disagree: -1 } as const;
  const rows = beliefs.map((b, i) => ({ claim: ids[i], value: value[b.stance], quote: b.quote.trim().slice(0, 300) }));
  if (rows.length) {
    q(`MATCH (b:Brain {id: $brain}), (u:Utterance {id: $uid})
       UNWIND $rows AS r MATCH (c:Claim {id: r.claim})
       MERGE (b)-[s:STANCE]->(c) SET s.value = r.value, s.note = r.quote, s.source = 'talk', s.at = $at
       MERGE (u)-[:SUPPORTS]->(c)
       SET b.updated_at = $at`, { brain, uid, rows, at: now() });
  }
  const style = res.json.style && typeof res.json.style === "object" ? res.json.style : info.style;
  if (style) q(`MATCH (b:Brain {id: $brain}) SET b.style_json = $s`, { brain, s: JSON.stringify(style) });
  checkpoint();

  const learned = q(`MATCH (b:Brain {id: $brain})-[s:STANCE]->(c:Claim) WHERE c.id IN $ids
                     RETURN c.id AS claim, c.text AS text, s.value AS stance, s.note AS quote`, { brain, ids })
    .map((r) => ({ claim: String(r.claim), text: String(r.text), stance: Number(r.stance), quote: (r.quote as string) ?? null,
      label: STANCE_LABEL[String(r.stance)], shared: false }));
  // which learned claims are shared with other brains (graph connections between personas)
  const shared = new Set(q(`MATCH (c:Claim)<-[:STANCE]-(o:Brain) WHERE c.id IN $ids AND o.id <> $brain RETURN DISTINCT c.id AS id`,
    { ids, brain }).map((r) => String(r.id)));
  learned.forEach((l) => { l.shared = shared.has(String(l.claim)); });

  return { utterance: uid, learned, dropped_unverifiable: dropped, style, ack: res.json.ack ?? "", follow_up: res.json.follow_up ?? null, by: res.model };
}

export function conversation(brain: string) {
  return q(`MATCH (:Brain {id: $brain})-[:SAID]->(u:Utterance)
            OPTIONAL MATCH (u)-[:SUPPORTS]->(c:Claim)
            RETURN u.id AS id, u.text AS text, u.at AS at, collect(c.text) AS supports ORDER BY at`, { brain });
}
