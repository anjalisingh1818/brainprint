# BrainPrint 🧠

**Test a pitch on two kinds of "brain" before you show it to anyone.**

1. **Pitch timeline:** Meta's **TRIBE v2** brain-encoding model predicts, second by second, how an *average* brain's networks respond to your pitch (script or video). BrainPrint shows where the *predicted attention/processing signals* drop, explains why, and suggests edits.
2. **Brain Library + Idea Lab:** you **train "brains"**, models of particular mindsets (a cautious investor, a busy freelancer, your own), by answering questions. Each brain commits to a prediction before every question, so its accuracy is measured honestly. Paste an idea, and BrainPrint splits it into points and predicts which points **land** with which brain and which **put it off**, with the reasons and recommended edits.

Everything (predictions, insights, brains, answers, ideas, feedback) lives in one **Relate** knowledge graph: a single `.rl` file committed to this repo. Every answer cites the graph nodes it used, and those citations are verified.

> Built for the **Relate by Neo4j Hackathon**, theme *"Context, connected"*. Demo video script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

> 📌 **Data status:** the three demo pitches in `tribe/cache/` are **synthetic placeholder curves**, and the app labels them as such everywhere. Real TRIBE v2 predictions take one GPU run of [`tribe/colab_run_demos.ipynb`](tribe/colab_run_demos.ipynb). Everything else (graph, brains, ideas, Wikidata, web checks) is real and works the same either way.

> ⚠️ **What this is not:** TRIBE predicts average brain *activity*. It does not predict opinions, emotions, or buying intent. "Lenses" are weightings over brain networks, not people. A trained brain is a model of **the answers its trainer gave**, shown with its measured accuracy. It is not a real person, a customer survey, or a market forecast. See [Limitations](#limitations).

---

## Why Relate
BrainPrint is one connected context. Each question the app answers **joins several kinds of knowledge** that would otherwise sit in separate stores:

| question | what it joins in one Cypher query |
|---|---|
| "What happened at moments like this in other pitches, and did a revision fix them?" | TRIBE segments → `SIMILAR_TO` (vector index) → other pitches' segments → insights → `FIXES` ← revisions → your `Feedback` |
| "How does this lens score each second?" | segments `-[:ACTIVATES]->` networks `<-[:WEIGHTS]-` lens, with weights recalibrated by your feedback (a live join, not a stored number) |
| "Will this point land with the investor brain, and why?" | claim → vector index → the brain's most similar answered claims (`STANCE`) + concept paths `MENTIONS` → GraphRAG prediction |
| "What is this idea about, and what else does it touch?" | claims → concepts → `SAME_AS` Wikidata entities → parent classes ← other ideas' concepts (bridges); web `Source`s `-[:EVIDENCE]->` claims |

**How BrainPrint uses Relate**
- **Mode:** a **single-file store**, [`graph/brainprint.rl`](graph/brainprint.rl), committed to git. It is embedded in-process, with no database server. The Python ingest writes it with `relate-db` and the Next.js server reads and writes it with `@relate/relate`; the same file works across both languages (verified).
- **Optional MCP:** the Relate CLI's MCP server exposes the same file to any MCP host ([below](#using-the-graph-from-any-mcp-host)).
- **Cypher features used:** `MERGE` / `UNWIND` batch upserts, `CALL (x) { … }` per-row subqueries, `COUNT { … }`, `EXISTS { … }`, `UNION ALL` graph projections, uniqueness constraints and range indexes, and explicit transactions (`begin` / `commit` / `rollback`) with `checkpoint()`.
- **Vector search:** **two vector indexes**, `segment_embedding` (148-d predicted brain-response patterns) and `claim_embedding` (384-d MiniLM text embeddings). They are queried with the `SEARCH … VECTOR INDEX … SCORE AS` clause and `vector.similarity.cosine`.
- **Safety:** `EXPLAIN`-based read-only classification for any model-generated Cypher.
- **Single source of truth:** every UI panel and every agent fact is a named query in [`graph/queries.cypher`](graph/queries.cypher), the same file the Python CLI runs.

**What we learned about Relate 1.2** (verified, with workarounds, in [docs/RELATE_NOTES.md](docs/RELATE_NOTES.md)):
- **Locking:** a `.rl` writer is exclusive, and even read-only opens fail while it is open.
- **Node handles:** the Node client has no `close()`, so a process keeps its lock until it exits. The server therefore holds one handle, and the MCP config is opt-in.
- **Vector filters:** `SEARCH … WHERE` filters allow equality only. We over-fetch and then filter.
- **Lock errors in Node** surface as a generic `internal error`.

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
                                 · Brain Library (train mindset brains) · Idea Lab
                                   (idea → claims → concepts → per-brain predictions)
                                        │
            free services ─────────────┤  Groq (gpt-oss: predictions, advice, browser_search)
                                        │  Wikidata + Wikipedia (entity linking)
                                        │  MiniLM embeddings (local, CPU)
```

## Repo layout
| Path | What it holds |
|---|---|
| `tribe/` | TRIBE v2 runner for Colab/Kaggle GPUs. `tribe/cache/` holds the committed JSON for the 3 demo clips |
| `graph/` | Relate schema, ingest, queries, and the store `brainprint.rl` |
| `web/` | Next.js + TypeScript app |
| `data/demo/` | Demo pitch scripts and clip references (media files are not committed) |
| `web/data/` | Probe statements and the two example brains (scripted answers) used to seed the Brain Library |
| `docs/` | [`RELATE_NOTES.md`](docs/RELATE_NOTES.md) (verified Relate API + findings), [`DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md), [`mcp.example.json`](docs/mcp.example.json) |

## Quick start
**Run the demo** (needs Node 18+ only; the graph is already in the repo). Prebuilt Relate binaries ship for Windows x64, Linux x64/arm64 and macOS:
```bash
git clone https://github.com/anjalisingh1818/brainprint && cd brainprint/web
npm install
npm run dev        # → http://localhost:3000  (Pitch timeline · Brain Library · Idea Lab)
```
Everything works with no key: the agent and the Idea Lab fall back to graph-only answers, and the demo idea's LLM predictions are cached in the graph. For written answers, live predictions, entity linking and web checks, copy `web/.env.example` to `web/.env.local`, add a **free** `GROQ_API_KEY` (console.groq.com, no card needed), and restart. On first use the app downloads a 23 MB embedding model.

**Rebuild the graph and run the Python tools** (Python ≥ 3.9, no GPU; stop the web server first):

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r graph/requirements.txt -r tribe/requirements.txt
python graph/smoke_test.py            # → "OK relate-db 1.2.0: persisted 3 nodes ..."
python tribe/validate.py --selftest   # → selftest OK + one line per cached clip
python graph/ingest.py                # → upserts tribe/cache/*.json into graph/brainprint.rl (keeps brains, ideas, feedback)
# python graph/ingest.py --reset --force   # full rebuild: also deletes the demo brains/idea (re-seeded on next web start)
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

## Feedback loop: it learns from you, without retraining anything
Select an insight and mark it **✓ Real issue** or **✗ Not an issue**, with an optional note:

1. **Graph write:** a `(:Feedback)-[:CONFIRMS|CONTRADICTS]->(:Insight)` edge plus `(:Feedback)-[:UPDATED]->(:Lens)`, written in one Relate transaction and checkpointed into `graph/brainprint.rl` ([`web/lib/feedback.ts`](web/lib/feedback.ts)).
2. **Light calibration:** only the current lens's `WEIGHTS.w` change. "Real issue" gives `w_n -= 0.1·tanh(m_n)`; "not an issue" gives `w_n += 0.1·tanh(m_n)`, where `m_n` is the network's mean strength over the insight's seconds. So the lens learns to score moments like this lower (or higher). Each weight stays within ±0.5 of its hand-set `base_w`. TRIBE and its predictions are never changed or retrained.
3. **Visible effect:** the timeline adds a dashed "before calibration" line, the Calibration panel shows each weight's base, current value, and drift, and a learning log lists every Feedback node with **undo** (which reverts exactly its delta) and **reset to base**.
4. **The agent uses it:** founder feedback outranks rule insights. A contradicted insight is reported as "judged not an issue, no fix needed"; a confirmed one becomes the priority, quoting your note.
5. **Before/after:** the Before/after panel overlays the lens score of a Revision's original and revised pitch, with mean, worst second, and insight counts from `revision_impact`. It also shows which of the revision's claimed `FIXES` your feedback has confirmed.

Feedback and calibrated weights survive `python graph/ingest.py`: insight ids are stable, and ingest only sets `w` when it creates the edge.

## Brain Library and Idea Lab: brains you train
**Brain Library** (`/brains`):
- **Create a brain:** give it a name and a one-line description. Two **example brains** with scripted answers ship with the app.
- **Train it:** the app picks the statement the brain has the least evidence about, from a 36-statement probe bank and your ideas' points.
- **Held-out self-test:** the brain **commits to a prediction first**, stored as a pending `(:Check)`. Then you answer agree, neutral, or disagree (for idea points: lands, neutral, puts me off), with an optional note.
- **Feedback:** the reveal shows whether the brain was right and which of your earlier answers it relied on. Every check counts towards the brain's self-test accuracy. "Run cross-validation" (4-fold) compares its accuracy with the always-say-the-most-common-answer baseline.

**Idea Lab** (`/ideas`):
- **Split the idea:** paste an idea or pitch. Groq splits it into 4–10 claims and links each to concepts. An offline sentence splitter is used when no LLM is configured.
- **Predict:** every brain predicts whether each point lands or puts it off. One call per brain, cached as `PREDICTS` edges until the brain learns something new.
- **Explain:** click a cell to see why (the brain's most similar answers from the vector index, plus shared concepts). If a prediction is wrong, teach the brain right there.
- **Advise:** "Get advice" writes graph-grounded recommendations with **verified citations**.
- **Link to TRIBE:** an idea can be linked to its TRIBE-analysed pitch (`PITCHED_AS`).

**How a brain predicts (GraphRAG over a knowledge graph):** predicting a brain's stance on a claim is *link prediction* `(:Brain)-[:STANCE]->(:Claim)`.
1. The graph retrieves the evidence: the brain's most similar answered claims (Relate `VECTOR INDEX claim_embedding` over local MiniLM sentence embeddings) and concept paths `(target)-[:MENTIONS]->(:Concept)<-[:MENTIONS]-(answered)<-[:STANCE]-(brain)`.
2. A free LLM (Groq) reads that evidence and predicts, citing the answers it used.
3. Without an LLM, a graph-only predictor is used.

**Measured accuracy** (4-fold cross-validation with random folds, 22 scripted answers per example brain; baseline = always predict the brain's most common answer):

| predictor | Cautious investor | Busy freelancer |
|---|---|---|
| majority baseline | 59% | 64% |
| embedding similarity only (first attempt, dropped) | 32% | 36% |
| graph-only (similarity + concepts + base rate) | ≈ baseline | ≈ baseline |
| GraphRAG + Groq, **with** per-target "similar answer → stance" hints | 50–68% | 41–50% |
| **GraphRAG + Groq gpt-oss-120b (final)**: the graph picks and orders the evidence, with no stance hints | **64–82%** over 4 runs (mean ≈ 72%) | **64–68%** over 3 runs (mean ≈ 65%) |

What we learned, measured rather than assumed:
- Semantic similarity alone predicts stance *worse than guessing*, because "AI makes me interested" and "AI is hype" sound alike but carry opposite stances.
- Feeding those similarity hints to the LLM dragged it down too.
- The final design beats the baseline for the investor brain (≈ 72% vs 59%) and only ties it for the freelancer brain (≈ 65% vs 64%).

With 22 answers the numbers are noisy, which is why every brain shows its own measured accuracy. Treat predictions from a brain that doesn't beat its baseline as weak.

## World knowledge: Wikidata, Wikipedia and web checks
An idea's concepts don't stay isolated strings. On the Idea Lab's **World knowledge** card:
- **Entity linking** (a core knowledge-graph technique) links each concept to Wikidata in three steps:
  1. **Candidate generation:** Wikidata search.
  2. **In-context disambiguation:** Groq sees the concept, the claims it came from, and the candidates. It may only pick a QID from the candidate list, or say "none" and suggest a better search term (`ai` → *artificial intelligence*).
  3. **Exact-label fallback:** without an LLM, only exact label matches are accepted.

  Links are stored as `(:Concept)-[:SAME_AS]->(:WikiEntity)`, with Wikidata parents `-[:INSTANCE_OF|SUBCLASS_OF]->(:WikiEntity)` and the Wikipedia summary. Our first heuristic linker mapped `ai` to *Anguilla* and `receipts` to a US appropriations act. Disambiguation in context fixed that.
- **Bridges:** other statements in the graph (probe statements, other ideas) that share a Wikidata entity or parent class with this idea, ignoring over-generic classes such as *academic discipline*. This is the "context, connected" part: two ideas about *subscription* and *recurring payment* meet through Wikidata even if they never share a word.
- **Web check** of a point (button on each row):
  1. **Search:** Groq's built-in `browser_search` (gpt-oss models) searches the web.
  2. **Store sources:** **only pages the tool actually returned** are stored, as `(:Source {url, title, snippet})-[:EVIDENCE]->(:Claim)`.
  3. **Judge:** a second, tool-free call judges the claim against those sources (supports / contradicts / mixed / unclear) and marks which ones it used.

  We don't keep the search model's inline citations: in testing it attributed a number to a "FreshBooks survey" that none of the opened pages contained.
- **Advice** cites `[[Concept:...]]` with its Wikidata meaning and `[[Source:url]]` for web evidence, and the server verifies those citations too.

**Free-tier budget:** Groq's free plan allows about **200,000 tokens per day per model**. One idea evaluation costs roughly 3–5k tokens per brain, a web check about 5k, cross-validating a brain about 10k, and entity-linking all 58 seed concepts about 40k. That's comfortable for a demo, but a long session can exhaust it (we did). The app then falls back to graph-only predictions and template answers instead of failing. Setting `GROQ_MODEL=openai/gpt-oss-20b` uses a separate daily quota.

APIs: Wikidata `wbsearchentities` / `wbgetentities`, Wikipedia REST `page/summary`, and Groq `browser_search`. Requests are serial and spaced out, honouring `Retry-After`. Linking all 58 seed concepts takes a few minutes once, and a new idea's concepts are linked in the background.

## Using the graph from any MCP host
Relate ships an MCP server in its CLI. With the [Relate CLI installed](https://relatedb.ai), copy [`docs/mcp.example.json`](docs/mcp.example.json) to `.mcp.json` (Claude Code) or into your MCP host's config. The host can then query the same single-file graph read-only through Relate's `get_schema` / `read_cypher` tools. This is verified: reads return rows, and a `CREATE` is rejected with "Only MATCH queries are allowed".
```json
{ "mcpServers": { "brainprint-relate": { "command": "relate",
  "args": ["serve", "--mcp", "stdio", "--database", "graph/brainprint.rl", "--read-only"] } } }
```
The config is **opt-in** on purpose. An MCP host keeps `relate serve` running, and its read lock stops the web app from opening the store for writing. Use one or the other at a time ([details](docs/RELATE_NOTES.md)).

## Demo
A 90-second walkthrough, shot by shot with narration and an honesty checklist: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Limitations
- **The demo TRIBE curves are synthetic placeholders** until the Colab notebook is run. The UI and the agent say so on every placeholder pitch.
- TRIBE outputs are model predictions of fMRI-like responses averaged across subjects, not measurements of any viewer. TRIBE v2 is licensed CC BY-NC 4.0 (non-commercial).
- The network grouping (7 networks) is a coarse aggregation chosen by us.
- Feedback only tunes a light calibration layer. There is no training on TRIBE itself.
- Brains are trained on few answers, so their accuracy is noisy. They model what the trainer said, not real people or markets. LLM predictions can be confidently wrong, which is why every prediction shows its evidence and every brain shows its measured accuracy.
- Groq sees the claims and the brain's answers when it predicts. Use Ollama or run without an LLM for private material.
- Wikidata links are chosen by a model from search candidates and can still be wrong (check the QID link). Web checks depend on what the search returns and on a model's reading of it. They are pointers to sources, not fact-checking.
- **One process at a time** may hold `graph/brainprint.rl` for writing (the web server, `ingest.py`, or an MCP server). This is a Relate single-file constraint, documented in [RELATE_NOTES](docs/RELATE_NOTES.md).
- Built and tested on Windows 11 with Node 24 and Python 3.12. Other platforms rely on Relate's published binaries and haven't been tested by us.

## License
MIT for this project's code. TRIBE v2 and Relate keep their own licenses.
