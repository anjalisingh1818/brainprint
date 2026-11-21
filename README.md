# BrainPrint 🧠

**See where your pitch loses people before you show it to anyone.**

You upload a short product pitch (a video or a script). Meta's **TRIBE v2** brain-encoding model predicts, second by second, which brain networks the pitch is likely to activate. BrainPrint stores those predictions in a **Relate** graph, one `.rl` file committed to this repo. An agent then queries the graph to find where the *predicted attention/processing signals* drop, suggests edits, and learns from your feedback.

> Built for the **Relate by Neo4j Hackathon**, theme *"Context, connected"*.

> ⚠️ **What this is not:** TRIBE predicts average brain *activity*. It does not predict opinions, emotions, or buying intent. "Lenses" are weightings over brain networks, not real people or audience segments. See [Limitations](#limitations).

---

## Why Relate
_TODO (P6). In short: the pitch, its segments, the predicted brain-network activations, the agent's insights, revisions, and your feedback form one connected context. The agent reasons over that context with Cypher and vector search, and the whole thing ships as a single portable file. Verified API notes: [docs/RELATE_NOTES.md](docs/RELATE_NOTES.md)._

## How it works
```
pitch (video/script) ──► /tribe  TRIBE v2 → per-second activation, 7 networks (JSON)
                               │
                               ▼
                         /graph  ingest → graph/brainprint.rl (Relate, single file)
                               │      Project, Stimulus, Segment, Network, Lens,
                               │      Insight, Revision, Feedback + SIMILAR_TO (vectors)
                               ▼
                         /web    Next.js: timeline · brain heatmap · graph explorer
                                 · agent chat (cites graph nodes) · before/after
```

## Repo layout
| Path | What it holds |
|---|---|
| `tribe/` | TRIBE v2 runner for Colab/Kaggle GPUs. `tribe/cache/` holds the committed JSON for the 3 demo clips |
| `graph/` | Relate schema, ingest, queries, and the store `brainprint.rl` |
| `web/` | Next.js + TypeScript app |
| `data/demo/` | Demo pitch scripts and clip references (media files are not committed) |
| `docs/` | `RELATE_NOTES.md`, demo script, design notes |

## Quick start
Requirements: Python ≥ 3.9 and Node 18+. You don't need a GPU, because the demo uses cached TRIBE output.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r graph/requirements.txt -r tribe/requirements.txt
python graph/smoke_test.py            # → "OK relate-db 1.2.0: persisted 3 nodes ..."
python tribe/validate.py --selftest   # → selftest OK + one line per cached clip
python graph/ingest.py --reset        # → rebuilds graph/brainprint.rl (already committed; optional)
python graph/queries.py all           # → 6 named Cypher queries over the graph
```
The graph model and the queries are described in [graph/README.md](graph/README.md).

**Web app** (reads `graph/brainprint.rl` directly through the Node Relate client):
```bash
cd web && npm install && npm run dev  # → http://localhost:3000
```
Stop the web server before re-running `graph/ingest.py` or `graph/queries.py`, because a Relate store has a single writer ([why](docs/RELATE_NOTES.md)). UI details: [web/README.md](web/README.md).
**Agent** ("Ask the graph" panel): it works with **no key at all** in graph-only mode. For written answers, copy `web/.env.example` to `web/.env.local` and set a **free** `GROQ_API_KEY` (no card needed: console.groq.com), or use a local Ollama model, or set `ANTHROPIC_API_KEY` for Claude. Then restart `npm run dev`.

## Reproducing the TRIBE step (GPU)
The web app reads cached JSON from `tribe/cache/`, so you don't need a GPU to run the demo. To regenerate the cache with real TRIBE v2 predictions, open [`tribe/colab_run_demos.ipynb`](tribe/colab_run_demos.ipynb) in Colab, pick a GPU runtime, and request access to the gated Llama 3.2 model on Hugging Face. Then unzip the output into `tribe/cache/` and run `python tribe/validate.py`. The network mapping and the JSON format are described in [tribe/README.md](tribe/README.md).

## The agent
The "Ask the graph" panel sends your question plus the UI context (the pitch, the second under the cursor, the selected insight, and the lens) to [`web/app/api/agent`](web/app/api/agent/route.ts). Which model answers depends on `web/.env.local` ([`.env.example`](web/.env.example)):

| mode | model | how it uses the graph | cost |
|---|---|---|---|
| **graph-first** (default) | Groq `openai/gpt-oss-120b`, or a local Ollama model | The server runs 9 fixed Relate queries for the moment in focus: the insight's evidence, the weakest second, the words around it, a **live vector search** for similar moments in other pitches, and the revision's before/after. It turns the results into tagged facts (~2k tokens) and makes **one** model call | free (Groq free plan or local) |
| graph only | none | The same 9 queries, with the answer written from a template | free, no key |
| tool agent | Claude Opus 5.5 (`ANTHROPIC_API_KEY`) | Multi-step tool use: `get_schema`, `run_named_query`, `get_segment_context`, `find_similar_moments`, `read_cypher` ([`web/lib/agent.ts`](web/lib/agent.ts)) | paid |

Graph-first exists because of Groq's free-plan limit of 8K tokens per minute: an agent that loops through tools would exceed it, but one call on pre-fetched facts fits. Small models are also more reliable this way. The shared queries live in [`web/lib/graphTools.ts`](web/lib/graphTools.ts) and the explainer in [`web/lib/explain.ts`](web/lib/explain.ts). `read_cypher` (Claude mode) classifies every statement with `EXPLAIN`, and only read plans run (the same rule Relate's MCP server uses).

**Citations are checked, not just requested.** Answers cite nodes inline as `[[Insight:pitch_jargon:attention_dip:25]]`. The server records every value the graph queries returned during that turn and marks each citation **verified** or not, and it repairs citations where a small model dropped the label. In the UI, citations are clickable chips that jump to the node (unverified ones show dashed red), and a "Graph queries used" list shows every query with its row count and timing.

**Honesty guardrails.** The server, not the model, adds the "placeholder data" note whenever the pitch isn't real TRIBE output. The prompt forbids causal or feeling claims ("viewers were confused"), any predicted numbers for a rewrite, and invented statistics in suggested rewrites. Rewrites may only reuse facts that are in the script.

> Privacy: with Groq, the pitch script and the graph facts for the moment in focus are sent to Groq's API. Use Ollama or graph-only mode for private pitches.

## Using the graph from any MCP host
Relate ships an MCP server in its CLI. With the [Relate CLI installed](https://relatedb.ai), the committed [`.mcp.json`](.mcp.json) lets Claude Code (and any other MCP host) query the same single-file graph read-only through Relate's `get_schema` / `read_cypher` tools:
```json
{ "mcpServers": { "brainprint-relate": { "command": "relate",
  "args": ["serve", "--mcp", "stdio", "--database", "graph/brainprint.rl", "--read-only"] } } }
```
Stop the web server first, because the store allows one process to hold it at a time ([why](docs/RELATE_NOTES.md)).

## Demo
_TODO (P6): 90-second video script in `docs/DEMO_SCRIPT.md`._

## Limitations
_TODO (P6)._ These will cover at least:
- TRIBE outputs are model predictions of fMRI-like responses averaged across subjects, not measurements of any viewer.
- The network grouping (7 networks) is a coarse aggregation chosen by us.
- Feedback only tunes a light calibration layer. There is no training on TRIBE itself.

## License
MIT for this project's code. TRIBE v2 and Relate keep their own licenses.
