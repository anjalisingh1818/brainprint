# Relate — verified API notes for BrainPrint

Researched 2026-11-21. Sources:
- **Engine repo:** https://github.com/relatedb/relate (Apache-2.0, Rust, v1.2.x). `github.com/neo4j/relate` **does not exist** (404); the hackathon's "Relate by Neo4j" is this repo.
- **Docs:** https://relatedb.ai, plus `docs/api/{python,wasm,mcp,javascript}/spec.md`, `docs/guides/vector-similarity.md`, and `docs/limitations.md` in the repo.
- **Ideas vault:** https://github.com/jexp/relate-ideas, a markdown vault that is itself a Relate store (`--snapshot-format markdown`).

Legend: ✅ = I ran it locally (Windows 11, Python 3.12, `relate-db==1.2.0`). 📄 = taken from the docs, not run yet.

---

## 1. Install

| Surface | Command | Status |
|---|---|---|
| Python | `pip install relate-db` (the import is `import relate`). Wheels: Win x64, Linux x64/arm64, macOS arm64, Py ≥3.9 | ✅ 1.2.0 |
| Node (native) | `npm install @relate/relate` (Node 18+) | 📄 |
| Browser WASM | `npm install @relate/relate-wasm` (1.2.0, ~7 MB unpacked) | 📄 version checked on npm |
| CLI | `irm https://relatedb.ai/install.ps1 \| iex` (Windows) / `curl -sSfL https://relatedb.ai/install.sh \| bash` | 📄 |

The PyPI name `relate` belongs to a different project. Always install `relate-db`.

## 2. Storage modes

| Mode | Open with | Notes |
|---|---|---|
| In-memory | `":memory:"` | Lost when the process exits |
| Directory | `"./graph"` | WAL plus Parquet shards (default codec) |
| Directory, JSON codec | CLI `--snapshot-format json` | Readable `graph.json`, empty stores only |
| **Single file** | `"./brainprint.rl"` | WAL, snapshot and catalog in one file ✅ |

✅ Verified: create → close → reopen `read_only=True` preserves nodes and relationships, and the folder holds only `t.rl` (40 KB for a tiny graph).

**Single-writer lease:** a second *writable* open of the same store is refused. Readers must use `read_only=True` (Python) or `{ readOnly: true }` (Node).

**→ BrainPrint uses single-file mode: `graph/brainprint.rl`, committed to the repo.**

## 3. Python API (`relate-db`)

```python
import relate
conn = relate.connect("graph/brainprint.rl")          # or read_only=True
conn.execute("CREATE (:Project {id: $id, name: $name})", {"id": "p1", "name": "Demo"})
rows = conn.execute("MATCH (p:Project) RETURN p.id AS id").fetchall()  # list[Record]; Record is a dict
n = conn.execute("MATCH (n) RETURN count(n) AS n").single().n          # attribute access works
conn.execute("UNWIND $rows AS r CREATE (:Segment {id: r.id})", {"rows": [...]})  # bulk path
conn.close()
```

- sqlite3/DB-API style: `execute`, `executemany`, `fetchone/fetchmany/fetchall`, `single()`, `data()`, `consume()` (counters, timings), `.graph()` (nodes and rels of a result), `to_df()` with `[pandas]`, `to_arrow()` with `[arrow]`.
- Autocommit by default. For a transaction: `conn.autocommit = False` → `conn.commit()` or `conn.rollback()`.
- Errors inherit from `relate.RelateError` and carry `neo4j_code` and `retryable`.
- `threadsafety = 1`: use a connection only on the thread that opened it.
- Parameter types: None, bool, int, float, str, list, dict, datetime, plus `relate.Vector` and `relate.Point`.
- `relate.viz.to_visualization_graph(...)` turns a result into a neo4j-viz graph.

## 4. Node API (`@relate/relate`): what the Next.js server will use

```js
const { Database } = require("@relate/relate");
const db = Database.open("graph/brainprint.rl", { readOnly: true });
const r = db.connect().query("MATCH (s:Segment) RETURN s.id AS id", { /* params */ });
r.rows; // [{ id: ... }]
```
`queryAsync(cypher, params?)` also exists. 📄 Not run yet; I'll verify it in P3.

## 5. WASM API (`@relate/relate-wasm`)

```js
import init, { RelateDb } from "@relate/relate-wasm";
await init();
const db = new RelateDb();                                   // :memory: only
const res = JSON.parse(db.execute("RETURN 1 AS n", null));   // params passed as a JSON *string*
db.executeScript("CREATE (:A); CREATE (:B)", null);          // returns one envelope per statement
```
Limits from the spec:
- **Cannot open a `.rl` file or a filesystem path.** It only opens `:memory:` or `opfs://name`, and OPFS works only in a dedicated worker.
- JSON codec only, and single-threaded.
- A Rust panic traps the instance; check for it with `isWasmTrap`.

**→ WASM is optional for BrainPrint** (for example, an in-browser "play with the graph" panel seeded from a Cypher dump). It is not the main store.

## 6. Cypher dialect

The dialect is current Cypher with the openCypher TCK as its floor. It supports:
- `MATCH/OPTIONAL MATCH/CREATE/MERGE/SET/REMOVE/DELETE/FOREACH/UNWIND/WITH/UNION`
- `CALL {}` subqueries
- Indexes and constraints
- Quantified path patterns
- 80+ functions
- `EXPLAIN` and `PROFILE`

It has one transaction level, the whole graph lives in memory, and each statement runs against one graph.

## 7. Vector search ✅ (all three forms ran)

```cypher
-- (a) brute-force scoring, no index
MATCH (s:Segment)
WITH s, vector.similarity.cosine(s.embedding, $q) AS score
RETURN s.id, score ORDER BY score DESC LIMIT 5;

-- (b) index + SEARCH clause (supports pre-filtering on WITH [...] properties)
CREATE VECTOR INDEX seg_emb FOR (s:Segment) ON s.embedding
  OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}};
MATCH (s:Segment)
SEARCH s IN (VECTOR INDEX seg_emb FOR $q LIMIT 5) SCORE AS sim
RETURN s.id, sim;

-- (c) Neo4j-compatible procedure
CALL db.index.vector.queryNodes('seg_emb', 5, $q) YIELD node, score RETURN node.id, score;
```
- Cosine similarity is **rebounded to [0,1]**: 1 means the same direction, 0.5 means orthogonal. Thresholds must use this scale.
- Embeddings are stored as plain float lists on nodes.
- The vector index is an **exact scan**, not HNSW. It costs O(n), with no recall loss, which is fine at our scale.
- `SCORE AS x` is required to name the score.
- A `WHERE` inside `SEARCH` may only use properties declared in the index's `WITH [...]`.

## 8. MCP

The MCP server is part of the CLI binary. The old standalone `relate-mcp` binary is retired.

```bash
relate serve --mcp stdio --database graph/brainprint.rl            # host spawns it, no auth
relate serve --mcp 7475 --database graph/brainprint.rl --auth u:p  # streamable HTTP, Basic auth
relate serve --mcp stdio --database graph/brainprint.rl --read-only   # hides write_cypher
```
Host config (Claude Desktop/Code style):
```json
{ "mcpServers": { "relate": { "command": "relate",
  "args": ["serve", "--mcp", "stdio", "--database", "graph/brainprint.rl", "--read-only"] } } }
```
Tools (JSON-RPC 2.0, protocol `2024-11-05`):
| Tool | Input | Notes |
|---|---|---|
| `get_schema` | `{sample_size?}` | Labels, counts, property types, relationships |
| `read_cypher` | `{statement, parameters?}` | Rejects writes and DDL (it classifies the statement with EXPLAIN first) |
| `write_cypher` | `{statement, parameters?}` | Not listed under `--read-only` |

Results come back as the wire envelope `{columns, columnTypes, rows:[{...}], stats, notifications, elapsed_ms, error}`. 📄 I haven't run this yet because the CLI isn't installed. I'll verify it in P4.

`relate serve` can also serve **Bolt** (`--bolt 7687`, so the stock `neo4j` drivers and neo4j-browser work) and an **HTTP Query API v2** (`--http 7474`) from the same process.

## 9. Decisions for BrainPrint

1. **Store:** `graph/brainprint.rl`, one file in git, written by the Python ingest (`relate-db`).
2. **Web reads:** Next.js API routes open the same file with `@relate/relate` `{readOnly:true}`. Python never runs at request time.
3. **Writes from the web (feedback, P5):** ~~the Next.js server owns the single writable connection~~ (revised in P2 after the lock tests in §11). Every request opens the store, runs its query, and closes it again (~19 ms). Feedback writes open the store writable just as briefly. Nothing holds a lock between requests, so ingest, `queries.py`, and `relate serve --mcp` can run whenever no request is in flight.
4. **Agent (P4):** I'll build two paths for the same 3 tools:
   - (a) In-app, Claude tool-use calls `get_schema`/`read_cypher` against the Node connection, with the same names and contract as Relate MCP.
   - (b) Documented: `relate serve --mcp stdio --read-only`, so any MCP host (Claude Code, Claude Desktop) can query the committed graph directly.

   Every answer cites node ids returned by the queries.
5. **SIMILAR_TO:** segment embeddings go in a `CREATE VECTOR INDEX`. `SIMILAR_TO {score}` edges are materialised at ingest from the top-k `SEARCH` results, so they show up in the graph explorer, and live `SEARCH` serves new queries.
6. **Windows note:** the Windows `relate.exe` has no self-update. To upgrade, rerun the installer.

## 10. Open questions and risks

- I haven't confirmed whether a `.rl` file written by Python 1.2.0 opens cleanly with the Node 1.2.x native package. I'll test it at the start of P3. Fallback: serve the graph through a small Python FastAPI or `relate serve --http`.
- Git churn: every write rewrites the `.rl` file, which is a binary diff. That's acceptable, but I'll commit it only at phase milestones.
- The whole graph must fit in memory. That's trivial at our size (3 clips × ~60 s × 7 networks).

## 11. Verified in P2 (relate-db 1.2.0, Windows, single `.rl` file) ✅

**Locking is stricter than the docs suggest for `.rl` files:**
| Already open | Then try | Result |
|---|---|---|
| writer | second writer | ❌ `storage locked` |
| writer | **reader** (`read_only=True`) | ❌ `storage locked`. The docs' "use read_only for readers" does not help while a writer is open |
| reader | second reader | ✅ works |
| reader | writer | ❌ `storage locked` |

So a writer needs exclusive access. Opening the 1.2 MB store, running a query, and closing it takes **~19 ms**, which is why every request opens and closes its own connection (§9.3). `--read-only=live` (WAL following) is documented only for directory stores, not `.rl`.

**Vector `SEARCH ... WHERE` accepts equality-style predicates only.** `WHERE s.stimulus_id <> $x` fails with `InvalidSearchFilterPredicate`. What works: a per-row subquery `CALL (x) { MATCH (s) SEARCH s IN (VECTOR INDEX idx FOR x.embedding LIMIT n) SCORE AS sim RETURN s, sim }`, over-fetching and filtering afterwards in `WITH ... WHERE`. `db.index.vector.queryNodes(idx, k, x.embedding)` also works per row.

**Also confirmed working:**
- `CREATE CONSTRAINT ... IF NOT EXISTS ... IS UNIQUE`
- `CREATE VECTOR INDEX ... WITH [s.prop] OPTIONS {indexConfig: ...}`
- `MERGE ... SET n += map`, `ON CREATE SET`
- `UNWIND $rows` with nested maps and lists
- `CALL (a, b) { ... }` scoped subqueries
- `COUNT { MATCH ... }`
- `collect({...})[0..$k]`
- `FOREACH (_ IN CASE ... | MERGE ...)`
- `DETACH DELETE`
- `SHOW INDEXES`
- `toString(datetime())`
