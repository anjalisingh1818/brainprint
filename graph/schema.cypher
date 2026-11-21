// BrainPrint graph schema for Relate (relate-db 1.2.0). Applied by graph/ingest.py.
// You can also run it by hand:  relate -d graph/brainprint.rl < graph/schema.cypher
//
// (:Project {id, name})-[:HAS_STIMULUS]->(:Stimulus {id, title, modality, source, duration_s, script})
// (:Stimulus)-[:HAS_SEGMENT]->(:Segment {id, stimulus_id, t, text, embedding[148]})
// (:Segment)-[:NEXT]->(:Segment)                       time order within a stimulus
// (:Segment)-[:ACTIVATES {strength, local_z, raw}]->(:Network)
//     strength = z vs pooled baseline (comparable across pitches); local_z = z within the pitch
// (:Lens {id, name, description})-[:WEIGHTS {w, base_w}]->(:Network)
// (:Insight {id, kind, summary, t_start, t_end, severity, created_by})-[:ABOUT]->(:Segment)
// (:Insight)-[:SEEN_THROUGH]->(:Lens)
// (:Revision {id, note})-[:FROM]->(:Stimulus), -[:TO]->(:Stimulus), -[:FIXES]->(:Insight)
// (:Feedback {id, verdict, comment, created_at})-[:CONFIRMS|CONTRADICTS]->(:Insight)
// (:Segment)-[:SIMILAR_TO {score}]->(:Segment)         top-k vector neighbours in OTHER stimuli

CREATE CONSTRAINT project_id IF NOT EXISTS FOR (n:Project) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT stimulus_id IF NOT EXISTS FOR (n:Stimulus) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT segment_id IF NOT EXISTS FOR (n:Segment) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT network_name IF NOT EXISTS FOR (n:Network) REQUIRE n.name IS UNIQUE;
CREATE CONSTRAINT lens_id IF NOT EXISTS FOR (n:Lens) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT insight_id IF NOT EXISTS FOR (n:Insight) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT revision_id IF NOT EXISTS FOR (n:Revision) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT feedback_id IF NOT EXISTS FOR (n:Feedback) REQUIRE n.id IS UNIQUE;
CREATE INDEX segment_stimulus IF NOT EXISTS FOR (n:Segment) ON (n.stimulus_id);

// Brain-response embedding: 148 Destrieux-region z-scores (within the pitch) per second, L2-normalised.
CREATE VECTOR INDEX segment_embedding IF NOT EXISTS
  FOR (s:Segment) ON s.embedding WITH [s.stimulus_id]
  OPTIONS {indexConfig: {`vector.dimensions`: 148, `vector.similarity_function`: 'cosine'}};
