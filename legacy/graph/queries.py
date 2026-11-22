"""Run the named queries in graph/queries.cypher against graph/brainprint.rl (read-only).

    python graph/queries.py                       # list the queries
    python graph/queries.py all                   # run every query with its default params
    python graph/queries.py lens_timeline --stimulus pitch_clear --lens clarity
    python graph/queries.py similar_moments --insight pitch_jargon:attention_dip:25 --json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
QUERIES_FILE = HERE / "queries.cypher"
STORE = HERE / "brainprint.rl"


def load_queries(path: Path = QUERIES_FILE) -> dict[str, dict]:
    """Parse queries.cypher into {name: {description, params, cypher}}."""
    out: dict[str, dict] = {}
    for block in re.split(r"(?m)^// name:", path.read_text(encoding="utf-8"))[1:]:
        lines = block.splitlines()
        name = lines[0].strip()
        meta = {"description": "", "params": {}}
        body = []
        for line in lines[1:]:
            m = re.match(r"^// (description|params):\s*(.*)$", line)
            if m and not body:
                if m.group(1) == "description":
                    meta["description"] = m.group(2).strip()
                else:
                    meta["params"] = dict(kv.split("=", 1) for kv in
                                          (p.strip() for p in m.group(2).split(",")) if kv)
            elif not line.startswith("//"):
                body.append(line)
        cypher = "\n".join(body).strip().rstrip(";").strip()
        out[name] = {**meta, "cypher": cypher}
    return out


def run(conn, name: str, params: dict | None = None, queries: dict | None = None) -> list[dict]:
    q = (queries or load_queries())[name]
    p = {**q["params"], **(params or {})}
    return [r.to_dict() for r in conn.execute(q["cypher"], p)]


def _table(rows: list[dict], width: int = 60) -> str:
    if not rows:
        return "  (no rows)"
    cols = list(rows[0].keys())
    cell = lambda v: (s if len(s := (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))) <= width
                      else s[: width - 1] + "…")
    data = [[cell(r[c]) for c in cols] for r in rows]
    w = [max(len(c), *(len(row[i]) for row in data)) for i, c in enumerate(cols)]
    fmt = lambda row: "  " + " | ".join(x.ljust(w[i]) for i, x in enumerate(row))
    return "\n".join([fmt(cols), "  " + "-+-".join("-" * x for x in w), *map(fmt, data)])


def main() -> None:
    import relate

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252

    queries = load_queries()
    args = sys.argv[1:]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    if not args:
        for n, q in queries.items():
            print(f"{n:18s} {q['description']}\n{'':18s} params: {q['params'] or '-'}")
        return
    name, rest = args[0], args[1:]
    params = {rest[i].lstrip("-"): rest[i + 1] for i in range(0, len(rest) - 1, 2)}
    conn = relate.connect(str(STORE), read_only=True)
    names = list(queries) if name == "all" else [name]
    for n in names:
        if n not in queries:
            sys.exit(f"unknown query {n!r}; run without arguments to list them")
        rows = run(conn, n, params if name != "all" else None, queries)
        if as_json:
            print(json.dumps({"query": n, "rows": rows}, ensure_ascii=False))
        else:
            print(f"\n== {n}  {({**queries[n]['params'], **(params if name != 'all' else {})}) or ''}\n"
                  f"   {queries[n]['description']}\n{_table(rows)}")
    conn.close()


if __name__ == "__main__":
    main()
