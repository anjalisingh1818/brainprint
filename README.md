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
pip install -r graph/requirements.txt
python graph/smoke_test.py            # → "OK relate-db 1.2.0: persisted 3 nodes ..."
```
_The web app and agent steps arrive in P3–P4._

## Reproducing the TRIBE step (GPU)
_TODO (P1)._

## Using the graph from any MCP host
_TODO (P4): `relate serve --mcp stdio --database graph/brainprint.rl --read-only`._

## Demo
_TODO (P6): 90-second video script in `docs/DEMO_SCRIPT.md`._

## Limitations
_TODO (P6)._ These will cover at least:
- TRIBE outputs are model predictions of fMRI-like responses averaged across subjects, not measurements of any viewer.
- The network grouping (7 networks) is a coarse aggregation chosen by us.
- Feedback only tunes a light calibration layer. There is no training on TRIBE itself.

## License
MIT for this project's code. TRIBE v2 and Relate keep their own licenses.
