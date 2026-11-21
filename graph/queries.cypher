// BrainPrint named queries. This file is the single source of truth: graph/queries.py, the
// web app, and the agent all load it. Each block is
//   // name: <id>
//   // description: <one line>
//   // params: k=v, k=v        (defaults, used by `python graph/queries.py all`)
//   <one Cypher statement>;
// All values are TRIBE v2 *predicted* signals for an average subject, not measurements.

// name: overview
// description: Every pitch with its source, length, mean Engagement score and number of open insights.
// params:
MATCH (p:Project)-[:HAS_STIMULUS]->(st:Stimulus)-[:HAS_SEGMENT]->(g:Segment)-[a:ACTIVATES]->(n:Network)<-[w:WEIGHTS]-(:Lens {id: 'engagement'})
WITH p, st, g, sum(w.w * a.strength) AS score
WITH p, st, avg(score) AS engagement
RETURN p.name AS project, st.id AS stimulus, st.source AS source, st.duration_s AS seconds,
       round(engagement, 3) AS mean_engagement,
       COUNT { MATCH (i:Insight {stimulus_id: st.id}) } AS insights
ORDER BY project, stimulus;

// name: lens_timeline
// description: Per-second lens score of one pitch: sum over networks of WEIGHTS.w x ACTIVATES.strength.
// params: stimulus=pitch_jargon, lens=engagement
MATCH (:Stimulus {id: $stimulus})-[:HAS_SEGMENT]->(g:Segment)-[a:ACTIVATES]->(n:Network)<-[w:WEIGHTS]-(:Lens {id: $lens})
WITH g, sum(w.w * a.strength) AS score
RETURN g.id AS segment, g.t AS t, round(score, 3) AS score, g.text AS text
ORDER BY t;

// name: weakest_moments
// description: The 5 lowest-scoring seconds of a pitch under a lens, with any insights that cover them.
// params: stimulus=pitch_jargon, lens=engagement
MATCH (:Stimulus {id: $stimulus})-[:HAS_SEGMENT]->(g:Segment)-[a:ACTIVATES]->(n:Network)<-[w:WEIGHTS]-(:Lens {id: $lens})
WITH g, sum(w.w * a.strength) AS score
ORDER BY score ASC LIMIT 5
OPTIONAL MATCH (i:Insight)-[:ABOUT]->(g)
RETURN g.id AS segment, g.t AS t, round(score, 3) AS score, g.text AS text, collect(i.id) AS insights
ORDER BY score;

// name: insight_evidence
// description: Each insight of a pitch, the 3 networks that drive it (mean within-pitch z), and its feedback so far.
// params: stimulus=pitch_jargon
MATCH (i:Insight {stimulus_id: $stimulus})-[:ABOUT]->(g:Segment)-[a:ACTIVATES]->(n:Network)
WITH i, n.name AS network, avg(a.local_z) AS z
ORDER BY abs(z) DESC
WITH i, collect({network: network, z: round(z, 2)})[0..3] AS drivers
OPTIONAL MATCH (f:Feedback)-[v:CONFIRMS|CONTRADICTS]->(i)
RETURN i.id AS insight, i.kind AS kind, i.t_start AS t_start, i.t_end AS t_end, i.severity AS severity,
       drivers, collect(type(v)) AS feedback, i.summary AS summary
ORDER BY severity DESC;

// name: similar_moments
// description: Vector neighbours (SIMILAR_TO) of an insight's seconds in OTHER pitches, and whether those were flagged or fixed.
// params: insight=pitch_jargon:attention_dip:25
MATCH (i:Insight {id: $insight})-[:ABOUT]->(g:Segment)-[r:SIMILAR_TO]->(h:Segment)
WITH h, max(r.score) AS sim
OPTIONAL MATCH (j:Insight)-[:ABOUT]->(h)
OPTIONAL MATCH (rv:Revision)-[:FIXES]->(j)
RETURN h.id AS segment, h.stimulus_id AS pitch, h.t AS t, round(sim, 3) AS similarity, h.text AS text,
       collect(DISTINCT j.kind) AS flagged_as, collect(DISTINCT rv.id) AS fixed_by
ORDER BY similarity DESC LIMIT 8;

// name: revision_impact
// description: Before/after for a Revision: lens score of FROM vs TO pitch, insight counts, and which FIXES held.
// params: revision=rev_ledgerly_v2, lens=engagement
MATCH (rv:Revision {id: $revision})-[:FROM]->(a:Stimulus), (rv)-[:TO]->(b:Stimulus), (l:Lens {id: $lens})
CALL (a, l) {
  MATCH (a)-[:HAS_SEGMENT]->(g:Segment)-[x:ACTIVATES]->(:Network)<-[w:WEIGHTS]-(l)
  WITH g, sum(w.w * x.strength) AS s
  RETURN avg(s) AS before_mean, min(s) AS before_min
}
CALL (b, l) {
  MATCH (b)-[:HAS_SEGMENT]->(g:Segment)-[x:ACTIVATES]->(:Network)<-[w:WEIGHTS]-(l)
  WITH g, sum(w.w * x.strength) AS s
  RETURN avg(s) AS after_mean, min(s) AS after_min
}
RETURN rv.id AS revision, a.id AS before, b.id AS after,
       round(before_mean, 3) AS before_mean, round(after_mean, 3) AS after_mean,
       round(before_min, 3) AS before_min, round(after_min, 3) AS after_min,
       COUNT { MATCH (:Insight {stimulus_id: a.id}) } AS insights_before,
       COUNT { MATCH (:Insight {stimulus_id: b.id}) } AS insights_after,
       COUNT { MATCH (rv)-[:FIXES]->(:Insight) } AS claimed_fixes,
       COUNT { MATCH (rv)-[:FIXES]->(:Insight)<-[:CONFIRMS]-(:Feedback) } AS confirmed_fixes;
