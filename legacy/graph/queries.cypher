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
WITH i, drivers, f, v ORDER BY f.created_at
RETURN i.id AS insight, i.kind AS kind, i.t_start AS t_start, i.t_end AS t_end, i.severity AS severity, drivers,
       [x IN collect({id: f.id, verdict: type(v), comment: f.comment, lens: f.lens}) WHERE x.id IS NOT NULL] AS feedback,
       i.summary AS summary
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

// ---- UI queries (used by the web app) ----

// name: lenses
// description: All lenses with their live (calibrated) and base weights per network.
// params:
MATCH (l:Lens)-[w:WEIGHTS]->(n:Network)
WITH l, n, w ORDER BY n.name
RETURN l.id AS lens, l.name AS name, l.description AS description,
       collect({network: n.name, w: w.w, base_w: w.base_w}) AS weights
ORDER BY lens;

// name: stimulus_meta
// description: One pitch's metadata, project, region names (for the heatmap) and revisions it takes part in.
// params: stimulus=pitch_jargon
MATCH (st:Stimulus {id: $stimulus})
OPTIONAL MATCH (p:Project)-[:HAS_STIMULUS]->(st)
OPTIONAL MATCH (rv:Revision)-[e:FROM|TO]->(st)
RETURN st.id AS stimulus, st.title AS title, st.source AS source, st.warning AS warning,
       st.modality AS modality, st.duration_s AS seconds, st.script AS script, p.name AS project,
       st.region_names AS region_names, collect(DISTINCT {revision: rv.id, role: type(e)}) AS revisions;

// name: stimulus_seconds
// description: Every second of a pitch: words, lens score (calibrated w and base_w), per-network strength/local_z, region z-scores.
// params: stimulus=pitch_jargon, lens=engagement
MATCH (:Stimulus {id: $stimulus})-[:HAS_SEGMENT]->(g:Segment)-[a:ACTIVATES]->(n:Network)
OPTIONAL MATCH (n)<-[w:WEIGHTS]-(:Lens {id: $lens})
WITH g, collect({network: n.name, strength: a.strength, local_z: a.local_z}) AS acts,
     sum(coalesce(w.w, 0.0) * a.strength) AS score, sum(coalesce(w.base_w, 0.0) * a.strength) AS base_score
RETURN g.id AS segment, g.t AS t, g.text AS text, round(score, 3) AS score, round(base_score, 3) AS base_score,
       acts, g.regions_z AS regions_z
ORDER BY t;

// name: graph_neighborhood
// description: Triples around one pitch for the graph explorer: project, insights, lens, networks, revision, feedback, SIMILAR_TO.
// params: stimulus=pitch_jargon
MATCH (p:Project)-[r:HAS_STIMULUS]->(st:Stimulus {id: $stimulus})
RETURN p.id AS a, 'Project' AS a_label, p.name AS a_name, type(r) AS rel, st.id AS b, 'Stimulus' AS b_label, st.title AS b_name, null AS w
UNION ALL
MATCH (i:Insight {stimulus_id: $stimulus})-[r:ABOUT]->(g:Segment)
RETURN i.id AS a, 'Insight' AS a_label, i.kind AS a_name, type(r) AS rel, g.id AS b, 'Segment' AS b_label, 't=' + toString(g.t) AS b_name, null AS w
UNION ALL
MATCH (st:Stimulus {id: $stimulus})-[r:HAS_SEGMENT]->(g:Segment)<-[:ABOUT]-(:Insight)
RETURN DISTINCT st.id AS a, 'Stimulus' AS a_label, st.title AS a_name, type(r) AS rel, g.id AS b, 'Segment' AS b_label, 't=' + toString(g.t) AS b_name, null AS w
UNION ALL
MATCH (i:Insight {stimulus_id: $stimulus})-[r:SEEN_THROUGH]->(l:Lens)
RETURN i.id AS a, 'Insight' AS a_label, i.kind AS a_name, type(r) AS rel, l.id AS b, 'Lens' AS b_label, l.name AS b_name, null AS w
UNION ALL
MATCH (l:Lens)-[r:WEIGHTS]->(n:Network) WHERE EXISTS { MATCH (:Insight {stimulus_id: $stimulus})-[:SEEN_THROUGH]->(l) }
RETURN l.id AS a, 'Lens' AS a_label, l.name AS a_name, type(r) AS rel, n.name AS b, 'Network' AS b_label, n.name AS b_name, r.w AS w
UNION ALL
MATCH (rv:Revision)-[r:FROM|TO]->(st:Stimulus) WHERE EXISTS { MATCH (rv)-[:FROM|TO]->(:Stimulus {id: $stimulus}) }
RETURN rv.id AS a, 'Revision' AS a_label, rv.id AS a_name, type(r) AS rel, st.id AS b, 'Stimulus' AS b_label, st.title AS b_name, null AS w
UNION ALL
MATCH (rv:Revision)-[r:FIXES]->(i:Insight {stimulus_id: $stimulus})
RETURN rv.id AS a, 'Revision' AS a_label, rv.id AS a_name, type(r) AS rel, i.id AS b, 'Insight' AS b_label, i.kind AS b_name, null AS w
UNION ALL
MATCH (f:Feedback)-[r:CONFIRMS|CONTRADICTS]->(i:Insight {stimulus_id: $stimulus})
RETURN f.id AS a, 'Feedback' AS a_label, f.verdict AS a_name, type(r) AS rel, i.id AS b, 'Insight' AS b_label, i.kind AS b_name, null AS w
UNION ALL
MATCH (f:Feedback)-[r:UPDATED]->(l:Lens) WHERE EXISTS { MATCH (f)-[:CONFIRMS|CONTRADICTS]->(:Insight {stimulus_id: $stimulus}) }
RETURN f.id AS a, 'Feedback' AS a_label, f.verdict AS a_name, type(r) AS rel, l.id AS b, 'Lens' AS b_label, l.name AS b_name, null AS w
UNION ALL
MATCH (:Insight {stimulus_id: $stimulus})-[:ABOUT]->(g:Segment)-[r:SIMILAR_TO]->(h:Segment)
WITH g, r, h ORDER BY r.score DESC
WITH g, collect({h: h, s: r.score})[0] AS top
RETURN g.id AS a, 'Segment' AS a_label, 't=' + toString(g.t) AS a_name, 'SIMILAR_TO' AS rel,
       top.h.id AS b, 'Segment' AS b_label, top.h.stimulus_id + ' t=' + toString(top.h.t) AS b_name, round(top.s, 3) AS w;

// ---- feedback & calibration (P5) ----

// name: feedback_log
// description: All founder feedback, newest first: verdict, comment, the insight it judges, and the lens weight changes it caused.
// params:
MATCH (f:Feedback)-[v:CONFIRMS|CONTRADICTS]->(i:Insight)
OPTIONAL MATCH (f)-[:UPDATED]->(l:Lens)
RETURN f.id AS feedback, type(v) AS verdict, f.comment AS comment, f.created_at AS created_at, i.id AS insight,
       i.stimulus_id AS stimulus, l.id AS lens, f.networks AS networks, f.w_before AS w_before, f.w_after AS w_after
ORDER BY created_at DESC;

// name: revision_fixes
// description: For a Revision: each insight it claims to FIX, and whether founder feedback confirmed or contradicted it.
// params: revision=rev_ledgerly_v2
MATCH (rv:Revision {id: $revision})-[:FIXES]->(i:Insight)
OPTIONAL MATCH (f:Feedback)-[v:CONFIRMS|CONTRADICTS]->(i)
RETURN i.id AS insight, i.kind AS kind, i.t_start AS t_start, i.t_end AS t_end, round(i.severity, 2) AS severity,
       [x IN collect(type(v)) WHERE x IS NOT NULL] AS feedback
ORDER BY t_start;
