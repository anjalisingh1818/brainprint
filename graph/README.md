# graph/: the BrainPrint Relate store

Everything BrainPrint knows lives in **one file, [`brainprint.rl`](brainprint.rl)**. It's a Relate single-file store (WAL, snapshot, and catalog in one file), committed to git. The predictions, the network weightings, the insights, the revisions, and your feedback all share it, so one Cypher query can join any of them.

## Model
```
(:Project)-[:HAS_STIMULUS]->(:Stimulus)-[:HAS_SEGMENT]->(:Segment)-[:NEXT]->(:Segment)
(:Segment)-[:ACTIVATES {strength, local_z, raw}]->(:Network)   7 networks
(:Lens)-[:WEIGHTS {w, base_w}]->(:Network)                     3 lenses = weightings, not people
(:Insight)-[:ABOUT]->(:Segment)      (:Insight)-[:SEEN_THROUGH]->(:Lens)
(:Revision)-[:FROM]->(:Stimulus)     (:Revision)-[:TO]->(:Stimulus)     (:Revision)-[:FIXES]->(:Insight)
(:Feedback)-[:CONFIRMS|CONTRADICTS]->(:Insight)                your verdict on an insight
(:Feedback)-[:UPDATED]->(:Lens)                                the calibration step it applied
(:Segment)-[:SIMILAR_TO {score}]->(:Segment)                   vector neighbours in other pitches
```
- **Segment** = one second of a pitch. `embedding` holds the 148 Destrieux-region values for that second, z-scored within the pitch and L2-normalised. It's indexed by `CREATE VECTOR INDEX segment_embedding`, so "moments that look alike in the brain" become a vector search.
- **ACTIVATES.strength** is a z-score against the pooled baseline of all pitches, so it's comparable across pitches. **local_z** is a z-score within the pitch, so it shows where the pitch dips relative to itself.
- **Lens score** of a segment = Σ over networks of `WEIGHTS.w × ACTIVATES.strength`. This is a graph join, not a stored number, so recalibrating `w` in P5 changes every score immediately.
- **Insights** come from explainable rules. A moment is flagged when it's unusual within the pitch (`|local_z| > 0.75`) and on the bad side of the pooled baseline for ≥ 2 s. The rules are `attention_dip`, `drift` (default-mode up while attention is down), and `overload` (language up while attention is down). Insight ids are stable, so feedback survives re-ingest.

Full schema: [`schema.cypher`](schema.cypher). Seed content (networks, lenses, projects, the demo revision): [`seed.py`](seed.py).

## Build and query
```bash
pip install -r graph/requirements.txt -r tribe/requirements.txt
python graph/ingest.py --reset     # rebuild brainprint.rl from tribe/cache/*.json (< 1 s)
python graph/ingest.py             # upsert; keeps Feedback and calibrated weights
python graph/queries.py            # list the named queries
python graph/queries.py all        # run all of them with default params
python graph/queries.py lens_timeline --stimulus pitch_clear --lens clarity
```

## The queries ([`queries.cypher`](queries.cypher))
This one file is shared by the CLI, the web app, and the agent.

| name | question it answers |
|---|---|
| `overview` | Which pitches exist, where their data came from, mean Engagement, and how many insights each has |
| `lens_timeline` | Per-second lens score of a pitch (the WEIGHTS × ACTIVATES join) |
| `weakest_moments` | The 5 lowest-scoring seconds, with the words heard and the insights that cover them |
| `insight_evidence` | Why each insight fired (its top 3 driving networks) and what feedback it has |
| `similar_moments` | Moments in **other** pitches that look alike in the brain (SIMILAR_TO / vector index), and whether they were flagged or fixed |
| `revision_impact` | Before/after for a Revision: mean and minimum lens score, insight counts, claimed vs confirmed fixes |

The file also holds 4 UI queries (`lenses`, `stimulus_meta`, `stimulus_seconds`, `graph_neighborhood`) that the web app uses for its panels, plus `feedback_log` and `revision_fixes` for the feedback loop.

## Concurrency (important)
A writer needs exclusive access to a `.rl` file. While anything holds it writable, even read-only opens fail with `storage locked`, although several readers can share the file. The Python scripts open the store per run and close it again. The **web server holds one handle for as long as it runs**, because the Node client can't release one (see [docs/RELATE_NOTES.md §11–12](../docs/RELATE_NOTES.md)).

**Stop the web server before running `ingest.py` or `queries.py`.**
