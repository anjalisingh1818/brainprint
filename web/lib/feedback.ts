// Founder feedback -> CONFIRMS/CONTRADICTS edges + a light per-lens calibration layer.
//
// No learning touches TRIBE. The only thing that adapts is each Lens's weights (WEIGHTS.w),
// starting from the hand-set prior WEIGHTS.base_w:
//   "real issue" (CONFIRMS):      w_n <- w_n - ETA * tanh(m_n)   (the lens now scores these seconds LOWER)
//   "not an issue" (CONTRADICTS): w_n <- w_n + ETA * tanh(m_n)   (the lens now scores these seconds HIGHER)
// where m_n = mean ACTIVATES.strength (z vs all pitches) of network n over the insight's segments;
// tanh keeps any single feedback's step within +/- ETA.
// Every weight stays within base_w +/- MAX_DRIFT and [-1, 1]. Each Feedback node stores the exact
// before/after weights, so undo reverts precisely that delta.
import "server-only";
import { checkpoint, connection, type Row } from "@/lib/relate";

export const ETA = 0.1;
export const MAX_DRIFT = 0.5;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];

function insightScore(insight: string, lens: string): number {
  const r = q(
    `MATCH (:Insight {id: $insight})-[:ABOUT]->(g:Segment)-[a:ACTIVATES]->(:Network)<-[w:WEIGHTS]-(:Lens {id: $lens})
     WITH g, sum(w.w * a.strength) AS s RETURN avg(s) AS score`,
    { insight, lens }
  )[0];
  return r3(Number(r?.score ?? 0));
}

function pitchMean(stimulus: string, lens: string): number {
  const r = q(
    `MATCH (:Stimulus {id: $stimulus})-[:HAS_SEGMENT]->(g:Segment)-[a:ACTIVATES]->(:Network)<-[w:WEIGHTS]-(:Lens {id: $lens})
     WITH g, sum(w.w * a.strength) AS s RETURN avg(s) AS score`,
    { stimulus, lens }
  )[0];
  return r3(Number(r?.score ?? 0));
}

function inTx<T>(fn: () => T): T {
  const conn = connection();
  conn.begin();
  try {
    const out = fn();
    conn.commit();
    checkpoint();
    return out;
  } catch (e) {
    conn.rollback();
    throw e;
  }
}

export type FeedbackResult = {
  feedback: string; verdict: "CONFIRMS" | "CONTRADICTS"; insight: string; lens: string;
  changes: { network: string; before: number; after: number; base: number }[];
  insight_score: { before: number; after: number };
  pitch_mean: { before: number; after: number };
};

export function addFeedback(input: { insight: string; verdict: "confirm" | "contradict"; comment?: string; lens: string }): FeedbackResult {
  const { insight, lens } = input;
  const rows = q(
    `MATCH (i:Insight {id: $insight}), (l:Lens {id: $lens})-[w:WEIGHTS]->(n:Network)
     MATCH (i)-[:ABOUT]->(:Segment)-[a:ACTIVATES]->(n)
     RETURN i.stimulus_id AS stimulus, n.name AS network, w.w AS w, w.base_w AS base_w, avg(a.strength) AS m
     ORDER BY network`,
    { insight, lens }
  );
  if (!rows.length) throw new Error(`unknown insight "${insight}" or lens "${lens}"`);
  const stimulus = String(rows[0].stimulus);
  const sign = input.verdict === "confirm" ? -1 : 1;
  const changes = rows.map((r) => {
    const before = Number(r.w), base = Number(r.base_w), m = Number(r.m);
    const after = r3(clamp(clamp(before + sign * ETA * Math.tanh(m), base - MAX_DRIFT, base + MAX_DRIFT), -1, 1));
    return { network: String(r.network), before: r3(before), after, base: r3(base) };
  });

  const scoreBefore = insightScore(insight, lens), meanBefore = pitchMean(stimulus, lens);
  const id = `fb_${Date.now().toString(36)}`;
  const relType = input.verdict === "confirm" ? "CONFIRMS" : "CONTRADICTS";

  inTx(() => {
    q(
      `MATCH (i:Insight {id: $insight}), (l:Lens {id: $lens})
       CREATE (f:Feedback {id: $id, verdict: $verdict, comment: $comment, lens: $lens, created_at: toString(datetime()),
                           networks: $networks, w_before: $w_before, w_after: $w_after})
       CREATE (f)-[:${relType}]->(i)
       CREATE (f)-[:UPDATED]->(l)`,
      {
        insight, lens, id, verdict: input.verdict, comment: (input.comment ?? "").slice(0, 500),
        networks: changes.map((c) => c.network), w_before: changes.map((c) => c.before), w_after: changes.map((c) => c.after),
      }
    );
    q(
      `UNWIND $changes AS c MATCH (:Lens {id: $lens})-[w:WEIGHTS]->(:Network {name: c.network}) SET w.w = c.after`,
      { lens, changes: changes.map(({ network, after }) => ({ network, after })) }
    );
  });

  return {
    feedback: id, verdict: relType, insight, lens, changes,
    insight_score: { before: scoreBefore, after: insightScore(insight, lens) },
    pitch_mean: { before: meanBefore, after: pitchMean(stimulus, lens) },
  };
}

/** Undo one feedback: revert exactly the weight delta it applied, then delete it. */
export function removeFeedback(id: string) {
  const f = q(`MATCH (f:Feedback {id: $id}) RETURN f.lens AS lens, f.networks AS networks, f.w_before AS b, f.w_after AS a`, { id })[0];
  if (!f) throw new Error(`unknown feedback "${id}"`);
  const nets = f.networks as string[], b = f.b as number[], a = f.a as number[];
  inTx(() => {
    q(
      `UNWIND $deltas AS d MATCH (:Lens {id: $lens})-[w:WEIGHTS]->(:Network {name: d.network})
       SET w.w = round(w.w - d.delta, 3)`,
      { lens: f.lens, deltas: nets.map((n, i) => ({ network: n, delta: a[i] - b[i] })) }
    );
    q(`MATCH (f:Feedback {id: $id}) DETACH DELETE f`, { id });
  });
  return { removed: id, lens: f.lens };
}

/** Reset a lens to its hand-set prior (feedback nodes are kept as history). */
export function resetLens(lens: string) {
  inTx(() => q(`MATCH (:Lens {id: $lens})-[w:WEIGHTS]->() SET w.w = w.base_w`, { lens }));
  return { reset: lens };
}
