"""P0 smoke test: proves Relate is installed and single-file persistence + vector search work.

Run:  python graph/smoke_test.py
Writes a throwaway store to graph/smoke.tmp.rl (gitignored) and deletes it afterwards.
"""
import os

import relate

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "smoke.tmp.rl")


def main() -> None:
    if os.path.exists(PATH):
        os.remove(PATH)

    conn = relate.connect(PATH)
    conn.execute(
        "UNWIND $rows AS r CREATE (:Segment {id: r.id, embedding: r.emb})",
        {"rows": [
            {"id": "s1", "emb": [1.0, 0.0, 0.0]},
            {"id": "s2", "emb": [0.9, 0.1, 0.0]},
            {"id": "s3", "emb": [0.0, 1.0, 0.0]},
        ]},
    )
    conn.execute(
        "CREATE VECTOR INDEX seg_emb FOR (s:Segment) ON s.embedding "
        "OPTIONS {indexConfig: {`vector.dimensions`: 3, `vector.similarity_function`: 'cosine'}}"
    )
    conn.close()

    # Reopen read-only: data must have persisted in the single .rl file.
    ro = relate.connect(PATH, read_only=True)
    n = ro.execute("MATCH (s:Segment) RETURN count(s) AS n").single().n
    hits = ro.execute(
        "MATCH (s:Segment) SEARCH s IN (VECTOR INDEX seg_emb FOR $q LIMIT 2) SCORE AS sim "
        "RETURN s.id AS id, sim",
        {"q": [1.0, 0.0, 0.0]},
    ).fetchall()
    ro.close()
    os.remove(PATH)

    assert n == 3, f"expected 3 segments after reopen, got {n}"
    assert [h["id"] for h in hits] == ["s1", "s2"], hits
    print(f"OK  relate-db {relate.__version__}: persisted {n} nodes in one .rl file; "
          f"vector SEARCH top-2 = {[(h['id'], round(h['sim'], 3)) for h in hits]}")


if __name__ == "__main__":
    main()
