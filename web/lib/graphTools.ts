// Graph queries shared by both agent modes (Claude tool agent and the graph-first explainer).
import "server-only";
import { connection, type Row } from "@/lib/relate";

export type TraceStep = { tool: string; input: unknown; rows: number; ms: number; error?: string };

/** Records each query's timing and row count, and every string it returned (for citation checks). */
export class Recorder {
  trace: TraceStep[] = [];
  seen = new Set<string>();

  run(tool: string, input: unknown, fn: () => Row[]): Row[] {
    const t0 = performance.now();
    try {
      const rows = fn();
      collectStrings(rows, this.seen);
      this.trace.push({ tool, input, rows: rows.length, ms: Math.round(performance.now() - t0) });
      return rows;
    } catch (e) {
      const error = String((e as Error).message ?? e).slice(0, 400);
      this.trace.push({ tool, input, rows: 0, ms: Math.round(performance.now() - t0), error });
      throw e;
    }
  }
}

function collectStrings(v: unknown, into: Set<string>) {
  if (typeof v === "string") into.add(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, into));
  else if (v && typeof v === "object") Object.values(v as object).forEach((x) => collectStrings(x, into));
}

const q = (cypher: string, params: Record<string, unknown> = {}) =>
  connection().query(cypher, params as never).rows as Row[];

export const schemaSummary = () => [
  ...q("MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY label"),
  ...q("MATCH ()-[r]->() RETURN type(r) AS relationship, count(*) AS count ORDER BY relationship"),
  ...q(
    "MATCH (n) WHERE n:Stimulus OR n:Lens OR n:Revision RETURN labels(n)[0] AS label, n.id AS id, coalesce(n.title, n.name, n.note) AS name ORDER BY label, id"
  ),
];

/** Words and per-network signals for the seconds around a segment, plus insights covering them. */
export const segmentContext = (id: string, window = 3) =>
  q(
    `MATCH (x:Segment {id: $id})
     MATCH (s:Segment {stimulus_id: x.stimulus_id}) WHERE abs(s.t - x.t) <= $w
     MATCH (s)-[a:ACTIVATES]->(n:Network)
     WITH s, collect({network: n.name, strength: round(a.strength, 2), local_z: round(a.local_z, 2)}) AS networks
     OPTIONAL MATCH (i:Insight)-[:ABOUT]->(s)
     RETURN s.id AS segment, s.t AS t, s.text AS text, networks, collect(DISTINCT i.id) AS insights
     ORDER BY t`,
    { id, w: window }
  );

/** Live vector search over the 148-region embeddings: nearest moments in OTHER pitches. */
export const similarMoments = (id: string, k = 5) =>
  q(
    `MATCH (x:Segment {id: $id})
     CALL (x) {
       MATCH (s:Segment) SEARCH s IN (VECTOR INDEX segment_embedding FOR x.embedding LIMIT 120) SCORE AS sim
       RETURN s, sim
     }
     WITH x, s, sim WHERE s.stimulus_id <> x.stimulus_id
     WITH s, sim ORDER BY sim DESC LIMIT $k
     OPTIONAL MATCH (i:Insight)-[:ABOUT]->(s)
     OPTIONAL MATCH (rv:Revision)-[:FIXES]->(i)
     OPTIONAL MATCH (f:Feedback)-[v:CONFIRMS|CONTRADICTS]->(i)
     RETURN s.id AS segment, s.stimulus_id AS pitch, s.t AS t, s.text AS text, round(sim, 3) AS similarity,
            collect(DISTINCT i.id) AS insights, collect(DISTINCT rv.id) AS fixed_by,
            [x IN collect(DISTINCT {feedback: f.id, verdict: type(v), comment: f.comment}) WHERE x.feedback IS NOT NULL] AS feedback
     ORDER BY similarity DESC`,
    { id, k }
  );

/** Read-only Cypher: classified with EXPLAIN first; only plans of type "r" run (Relate MCP's rule). */
export function readCypher(statement: string, parameters: Record<string, unknown> = {}) {
  const plan = connection().query(`EXPLAIN ${statement}`, parameters as never);
  if (plan.queryType !== "r") throw new Error(`Only read queries are allowed (query type "${plan.queryType}")`);
  return q(statement, parameters);
}

/** The insight to focus on: the selected one, else one covering the cursor, else the most severe. */
export const focusInsight = (stimulus: string, t: number, insight?: string | null) =>
  q(
    `MATCH (i:Insight {stimulus_id: $stimulus})
     OPTIONAL MATCH (i)-[:ABOUT]->(g:Segment {t: $t})
     WITH i, CASE WHEN i.id = $insight THEN 2 WHEN g IS NOT NULL THEN 1 ELSE 0 END AS rank
     RETURN i.id AS insight, i.kind AS kind, i.t_start AS t_start, i.t_end AS t_end, i.severity AS severity, i.summary AS summary
     ORDER BY rank DESC, i.severity DESC LIMIT 1`,
    { stimulus, t, insight: insight ?? "" }
  );

/** Within an insight, the second with the lowest lens score (the moment to rewrite first). */
export const weakestSecondOf = (insight: string, lens: string) =>
  q(
    `MATCH (:Insight {id: $insight})-[:ABOUT]->(g:Segment)-[a:ACTIVATES]->(n:Network)<-[w:WEIGHTS]-(:Lens {id: $lens})
     WITH g, sum(w.w * a.strength) AS score
     RETURN g.id AS segment, g.t AS t, g.text AS text, round(score, 3) AS score ORDER BY score LIMIT 1`,
    { insight, lens }
  );

export const revisionsOf = (stimulus: string) =>
  q(
    `MATCH (rv:Revision)-[e:FROM|TO]->(:Stimulus {id: $stimulus})
     RETURN rv.id AS revision, type(e) AS role, rv.note AS note`,
    { stimulus }
  );
