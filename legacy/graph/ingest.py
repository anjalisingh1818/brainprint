"""Load tribe/cache/*.json into the Relate store graph/brainprint.rl.

    python graph/ingest.py            # upsert (MERGE): keeps Feedback and calibration
    python graph/ingest.py --reset    # delete the store and rebuild from scratch

Relate allows one writer per store. Stop the web server (P3+) before running this.

Steps:
  1. schema.cypher: constraints, a property index, and a vector index
  2. Network, Lens -[:WEIGHTS]-> Network, Project
  3. per stimulus: Stimulus, Segment chain (NEXT), ACTIVATES{strength, raw}
     strength = z vs the pooled baseline of all stimuli (comparable across pitches)
     local_z  = z vs this stimulus' own mean/std (where it dips *within* the pitch)
  4. rule-based Insights (attention dip / drift / overload) -[:ABOUT]-> Segments
  5. Revision -[:FROM/TO]-> Stimulus, -[:FIXES]-> Insight
  6. SIMILAR_TO: top-3 vector neighbours of each segment in OTHER stimuli, via the
     Relate vector index (SEARCH clause)
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import relate

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from seed import LENSES, NETWORKS, PROJECTS, REVISIONS  # noqa: E402

STORE = HERE / "brainprint.rl"
CACHE = ROOT / "tribe" / "cache"
SIMILAR_K = 3
SIMILAR_MIN = 0.6    # Relate cosine is rebounded to [0,1]; 0.5 = orthogonal
RULE_Z = 0.75        # |local z| threshold for rule insights
RULE_MIN_LEN = 2     # seconds


def run_script(conn, path: Path) -> None:
    text = "\n".join(l for l in path.read_text(encoding="utf-8").splitlines() if not l.strip().startswith("//"))
    for stmt in (s.strip() for s in text.split(";")):
        if stmt:
            conn.execute(stmt)


def load_docs() -> list[dict]:
    docs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CACHE.glob("*.json"))]
    if not docs:
        sys.exit(f"no JSON in {CACHE}; run tribe/make_placeholder.py or the Colab notebook first")
    return docs


def pooled_stats(docs, key_fn, n):
    """Mean/std per dimension over all seconds of all docs."""
    vals = [[] for _ in range(n)]
    for d in docs:
        for s in d["seconds"]:
            for i, v in enumerate(key_fn(d, s)):
                vals[i].append(v)
    means = [sum(v) / len(v) for v in vals]
    stds = [max(1e-6, math.sqrt(sum((x - m) ** 2 for x in v) / len(v))) for v, m in zip(vals, means)]
    return means, stds


def runs(flags: list[bool], min_len: int):
    """Yield (start_idx, end_idx_inclusive) for runs of True of length >= min_len."""
    start = None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                yield start, i - 1
            start = None


def quote(text: str, n: int = 90) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def rule_insights(doc: dict, z: list[dict], lz: list[dict]) -> list[dict]:
    """Deterministic, explainable rules. A moment is flagged when it is unusual *within the
    pitch* (local z) AND on the bad side of the pooled baseline (z). Ids are stable."""
    sid, secs = doc["stimulus_id"], doc["seconds"]
    rules = [
        ("attention_dip", "engagement",
         [l["attention"] < -RULE_Z and g["attention"] < 0 for l, g in zip(lz, z)],
         "Predicted attention signal dips"),
        ("drift", "engagement",
         [l["default_mode"] > RULE_Z and g["default_mode"] > 0 and l["attention"] < 0 for l, g in zip(lz, z)],
         "Predicted default-mode signal rises while attention falls (possible drift)"),
        ("overload", "clarity",
         [l["language"] > RULE_Z and g["language"] > 0 and l["attention"] < 0 for l, g in zip(lz, z)],
         "High predicted language load without matching attention (possible overload)"),
    ]
    out = []
    for kind, lens, flags, label in rules:
        for a, b in runs(flags, RULE_MIN_LEN):
            net = {"attention_dip": "attention", "drift": "default_mode", "overload": "language"}[kind]
            sev = sum(abs(lz[i][net]) for i in range(a, b + 1)) / (b - a + 1)
            words = quote(" ".join(secs[i]["text"] for i in range(a, b + 1)))
            t0, t1 = secs[a]["t"], secs[b]["t"]
            out.append({
                "id": f"{sid}:{kind}:{t0}", "kind": kind, "lens": lens, "stimulus_id": sid,
                "t_start": t0, "t_end": t1, "severity": round(sev, 3),
                "summary": f"{label} for {t1 - t0 + 1}s (t={t0}-{t1}s) during: \"{words}\"",
                "segment_ids": [f"{sid}:{secs[i]['t']}" for i in range(a, b + 1)],
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="delete graph/brainprint.rl first")
    ap.add_argument("--force", action="store_true", help="with --reset: also delete trained brains and feedback")
    ap.add_argument("--store", default=str(STORE))
    args = ap.parse_args()
    store = Path(args.store)
    if args.reset and store.exists():
        # Brains, ideas and feedback are created in the web app and live only in this file: don't destroy them silently.
        with relate.connect(str(store), read_only=True) as ro:
            n = lambda cy: ro.execute(cy).single().n
            mine = n("MATCH (b:Brain) WHERE NOT coalesce(b.example, false) RETURN count(b) AS n")
            fb = n("MATCH (f:Feedback) RETURN count(f) AS n")
            ideas = n("MATCH (i:Idea) RETURN count(i) AS n")
            answers = n("MATCH (k:Check) WHERE k.pending = false RETURN count(k) AS n")
        if (mine or fb or ideas or answers) and not args.force:
            sys.exit(f"--reset would delete {mine} trained brain(s), {ideas} idea(s), {answers} answered self-check(s) and "
                     f"{fb} feedback node(s) created in the web app. Re-run with --reset --force to confirm.")
        store.unlink()
        print(f"reset: deleted {store.name}")

    docs = load_docs()
    nets = docs[0]["networks"]
    R = len(docs[0]["regions"])
    n_mean, n_std = pooled_stats(docs, lambda d, s: [s["networks"][n] for n in nets], len(nets))
    r_mean, r_std = pooled_stats(docs, lambda d, s: s["regions"], R)

    try:
        conn = relate.connect(str(store))
    except relate.RelateError as e:
        sys.exit(f"cannot open {store} for writing ({e}). Is the web server running? Stop it and retry.")

    run_script(conn, HERE / "schema.cypher")

    # 2. networks, lenses, projects
    conn.execute(
        "UNWIND $rows AS r MERGE (n:Network {name: r.name}) "
        "SET n.description = r.description, n.baseline_mean = r.mean, n.baseline_std = r.std",
        {"rows": [{"name": n, "description": NETWORKS[n], "mean": n_mean[i], "std": n_std[i]}
                  for i, n in enumerate(nets)]},
    )
    for lens in LENSES:
        conn.execute("MERGE (l:Lens {id: $id}) SET l.name = $name, l.description = $description",
                     {k: lens[k] for k in ("id", "name", "description")})
        # base_w is the hand-set prior; w is the live (calibrated) weight. Keep w if it already exists.
        conn.execute(
            "MATCH (l:Lens {id: $id}) UNWIND $ws AS x MATCH (n:Network {name: x.net}) "
            "MERGE (l)-[r:WEIGHTS]->(n) ON CREATE SET r.w = x.w SET r.base_w = x.w",
            {"id": lens["id"], "ws": [{"net": k, "w": v} for k, v in lens["weights"].items()]},
        )
    for p in PROJECTS:
        conn.execute("MERGE (p:Project {id: $id}) SET p.name = $name", {"id": p["id"], "name": p["name"]})

    # 3. stimuli + segments + activations
    stim_project = {s: p["id"] for p in PROJECTS for s in p["stimuli"]}
    all_insights = []
    for d in docs:
        sid = d["stimulus_id"]
        conn.execute(
            "MERGE (s:Stimulus {id: $id}) SET s.title = $title, s.modality = $modality, s.source = $source, "
            "s.warning = $warning, s.duration_s = $duration_s, s.script = $script, "
            "s.mapping_version = $mv, s.region_names = $regions "
            "WITH s OPTIONAL MATCH (p:Project {id: $pid}) "
            "FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | MERGE (p)-[:HAS_STIMULUS]->(s))",
            {"id": sid, "title": d["title"], "modality": d["modality"], "source": d["source"],
             "warning": d.get("warning"), "duration_s": d["duration_s"], "script": d.get("script"),
             "mv": d.get("atlas", {}).get("mapping_version"), "pid": stim_project.get(sid),
             "regions": d["regions"]},
        )
        z_rows, lz_rows, seg_rows = [], [], []
        l_mean, l_std = pooled_stats([d], lambda _d, s: [s["networks"][n] for n in nets], len(nets))
        lr_mean, lr_std = pooled_stats([d], lambda _d, s: s["regions"], R)
        for s in d["seconds"]:
            z = {n: (s["networks"][n] - n_mean[i]) / n_std[i] for i, n in enumerate(nets)}
            lz = {n: (s["networks"][n] - l_mean[i]) / l_std[i] for i, n in enumerate(nets)}
            # embedding = the moment's region pattern relative to its own pitch, so similar
            # "shapes" (e.g. a dip) match across pitches with different overall levels
            emb = [(v - lr_mean[i]) / lr_std[i] for i, v in enumerate(s["regions"])]
            regions_z = [round(x, 3) for x in emb]  # un-normalised, for the brain heatmap
            norm = math.sqrt(sum(x * x for x in emb)) or 1.0
            z_rows.append(z)
            lz_rows.append(lz)
            seg_rows.append({
                "id": f"{sid}:{s['t']}", "t": s["t"], "text": s["text"],
                "embedding": [round(x / norm, 6) for x in emb], "regions_z": regions_z,
                "acts": [{"net": n, "strength": round(z[n], 4), "local_z": round(lz[n], 4),
                          "raw": s["networks"][n]} for n in nets],
            })
        conn.execute(
            "MATCH (st:Stimulus {id: $sid}) UNWIND $rows AS r "
            "MERGE (g:Segment {id: r.id}) SET g.stimulus_id = $sid, g.t = r.t, g.text = r.text, g.embedding = r.embedding, g.regions_z = r.regions_z "
            "MERGE (st)-[:HAS_SEGMENT]->(g) "
            "WITH g, r UNWIND r.acts AS a MATCH (n:Network {name: a.net}) "
            "MERGE (g)-[x:ACTIVATES]->(n) SET x.strength = a.strength, x.local_z = a.local_z, x.raw = a.raw",
            {"sid": sid, "rows": seg_rows},
        )
        conn.execute(
            "MATCH (g:Segment {stimulus_id: $sid}) WITH g ORDER BY g.t "
            "WITH collect(g) AS gs UNWIND range(0, size(gs) - 2) AS i "
            "WITH gs[i] AS a, gs[i + 1] AS b MERGE (a)-[:NEXT]->(b)",
            {"sid": sid},
        )
        all_insights += rule_insights(d, z_rows, lz_rows)

    # 4. rule insights (stable ids; stale rule insights without feedback are removed)
    live_ids = [i["id"] for i in all_insights]
    conn.execute(
        "MATCH (i:Insight {created_by: 'rule'}) WHERE NOT i.id IN $ids AND NOT (i)<-[:CONFIRMS|CONTRADICTS]-() "
        "DETACH DELETE i", {"ids": live_ids},
    )
    conn.execute(
        "UNWIND $rows AS r MERGE (i:Insight {id: r.id}) "
        "SET i.kind = r.kind, i.summary = r.summary, i.t_start = r.t_start, i.t_end = r.t_end, "
        "i.severity = r.severity, i.stimulus_id = r.stimulus_id, i.created_by = 'rule' "
        "WITH i, r MATCH (l:Lens {id: r.lens}) MERGE (i)-[:SEEN_THROUGH]->(l) "
        "WITH i, r UNWIND r.segment_ids AS gid MATCH (g:Segment {id: gid}) MERGE (i)-[:ABOUT]->(g)",
        {"rows": all_insights},
    )

    # 5. revisions
    for rv in REVISIONS:
        conn.execute(
            "MATCH (a:Stimulus {id: $from}), (b:Stimulus {id: $to}) "
            "MERGE (r:Revision {id: $id}) SET r.note = $note "
            "MERGE (r)-[:FROM]->(a) MERGE (r)-[:TO]->(b) "
            "WITH r MATCH (i:Insight {stimulus_id: $from, created_by: 'rule'}) MERGE (r)-[:FIXES]->(i)",
            rv,
        )

    # 6. SIMILAR_TO via the vector index. SEARCH filters only allow equality-style
    #    predicates, so over-fetch and drop same-stimulus hits afterwards.
    conn.execute("MATCH (:Segment)-[r:SIMILAR_TO]->() DELETE r")
    over = SIMILAR_K + max(len(d["seconds"]) for d in docs) + 5
    conn.execute(
        "MATCH (x:Segment) "
        "CALL (x) { MATCH (s:Segment) SEARCH s IN (VECTOR INDEX segment_embedding FOR x.embedding LIMIT $over) "
        "SCORE AS sim RETURN s, sim } "
        "WITH x, s, sim WHERE s.stimulus_id <> x.stimulus_id AND sim >= $min "
        "WITH x, s, sim ORDER BY sim DESC "
        "WITH x, collect({s: s, sim: sim})[0..$k] AS top UNWIND top AS h "
        "WITH x, h.s AS s, h.sim AS sim MERGE (x)-[r:SIMILAR_TO]->(s) SET r.score = sim",
        {"over": over, "min": SIMILAR_MIN, "k": SIMILAR_K},
    )

    counts = conn.execute(
        "MATCH (n) WITH labels(n)[0] AS l, count(*) AS c RETURN l, c ORDER BY l"
    ).fetchall()
    rels = conn.execute("MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS c ORDER BY t").fetchall()
    conn.close()
    srcs = sorted({d["source"] for d in docs})
    print(f"ingested {len(docs)} stimuli from {CACHE.relative_to(ROOT)} (source: {', '.join(srcs)}) into {store.name}")
    print("  nodes: " + ", ".join(f"{r['l']}={r['c']}" for r in counts))
    print("  rels:  " + ", ".join(f"{r['t']}={r['c']}" for r in rels))
    print(f"  file:  {store.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
