# web/: BrainPrint UI (Next.js 15 + TypeScript)

The UI reads the Relate store `graph/brainprint.rl` **directly** through the native Node client `@relate/relate`. There's no Python and no separate database server at runtime.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```
Requirements: Node 18+. Prebuilt native binaries ship for Windows x64, Linux x64/arm64, and macOS.

## How it reads the graph
- [`lib/relate.ts`](lib/relate.ts) opens the store once per server process and parses [`graph/queries.cypher`](../graph/queries.cypher), the same file the Python CLI uses.
- [`app/api/query/route.ts`](app/api/query/route.ts): `GET /api/query?name=<query>&<param>=...` runs **named queries only**, so the browser never sends raw Cypher. `GET /api/query` lists them.
- Every panel is one named query:

| panel | query |
|---|---|
| pitch cards | `overview` |
| lens buttons and formula | `lenses` |
| timeline (lens score or 7 networks) | `stimulus_seconds` |
| brain heatmap (148 regions at the selected second) | `stimulus_seconds` (`regions_z`) + `stimulus_meta` (`region_names`) |
| insight cards (drivers, feedback) | `insight_evidence` |
| graph explorer | `graph_neighborhood` |

The brain heatmap draws the real fsaverage5 inflated surface that TRIBE predicts on. It's exported once by `python tribe/export_mesh.py` to `public/brain_mesh.json` (committed) and coloured per Destrieux region on a canvas.

## Using it
- **Pick a pitch** with the cards at the top. A banner warns when its data is a synthetic placeholder.
- **Switch lens** between Engagement, Clarity, and Visual hook. The formula shows the live weights stored on the `WEIGHTS` edges.
- **Scrub the timeline** by dragging. The words for that second and the brain map follow. Coloured bands are insights; click one to select it.
- **Graph explorer:** hover a node or edge to see it in Cypher notation. Click an insight to select it, or click a segment to jump there. Dashed `SIMILAR_TO` edges lead to similar moments in *other* pitches, and clicking one switches pitch.

## Feedback, calibration, before/after
- **Select an insight**, then use **✓ Real issue** / **✗ Not an issue** with an optional note. This calls `POST /api/feedback`, which writes the Feedback node and nudges the current lens's weights. `DELETE /api/feedback?id=` undoes one feedback exactly, and `POST {action: "reset", lens}` resets a lens to its base weights.
- **Calibration panel:** base vs current weights and the learning log. **Before/after panel:** a Revision's original vs revised pitch under the current lens.

## Brain Library (`/brains`) and Idea Lab (`/ideas`)
- `GET/POST /api/brains`: list, create, next question (creates a **pending Check** with the brain's prediction before the question is shown), answer, and `{action: "crossvalidate"}`. See [`lib/brains.ts`](lib/brains.ts).
- `GET/POST /api/ideas`: create an idea (claims are extracted by Groq, or by the offline splitter), evaluate it (cached `PREDICTS` edges), and `advice=1` for recommendations with verified citations. See [`lib/ideas.ts`](lib/ideas.ts).
- **Embeddings:** local `Xenova/all-MiniLM-L6-v2` (quantized, ~23 MB, downloaded once on first use, CPU only), see [`lib/embed.ts`](lib/embed.ts).
- **First run:** the server seeds the probe bank ([`data/probe_claims.json`](data/probe_claims.json)) and the two example brains ([`data/example_brains.json`](data/example_brains.json)) if the graph has none.

## World knowledge (`/api/knowledge`)
- `POST {action: "link", idea?, relink?}`: entity-links concepts to Wikidata (candidate search + Groq disambiguation restricted to the candidates), plus parent classes and the Wikipedia summary.
- `POST {action: "check", claim}`: web check through Groq `browser_search`. Only pages the tool returned are stored as `(:Source)`; a second tool-free call gives the verdict.
- `GET ?idea=`: concepts with links, bridges through shared Wikidata classes, web checks, and graph triples. See [`lib/knowledge.ts`](lib/knowledge.ts).

## Agent panel
`POST /api/agent` picks the model from `web/.env.local` (see `.env.example`): Groq (free) or Ollama for the **graph-first** explainer, Claude for the multi-step **tool agent**, or none for **graph-only** mode, which is also a checkbox in the panel. Details and guardrails are in the main README under "The agent".

## Gotcha
The Node client can't release its lock on the store, so **stop `npm run dev` before running `python graph/ingest.py` or `python graph/queries.py`**. Otherwise they report `storage locked`.
