# web/: the BrainPrint app (Next.js 15 + TypeScript)

The app reads and writes the Relate store `graph/brainprint.rl` **directly** through the native Node client `@relate/relate`. There's no database server and no Python at runtime.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

## Pages
- `/` **Brain Panel:** ask a problem or idea. Each brain answers in its own voice, then the panel is synthesised, with optional point-by-point reactions and world knowledge.
- `/brains` **Brain Library:** create brains, train them by **Talk** (natural conversation) or **Quiz** (predict, then check), and see each brain's style, concept profile, self-checks, cross-validation and graph.

## API
| route | what it does |
|---|---|
| `GET/POST/DELETE /api/brains` | List, create and delete brains. `{action: "talk", message}` learns beliefs and style; `?next=1` gives the next quiz question (with a pending prediction); answering resolves the self-check; `{action: "crossvalidate"}` runs 4-fold cross-validation |
| `GET/POST /api/panel` | `{action: "ask"}` stores a question (split into claims), `{action: "respond", brain}` gets one brain's answer, `{action: "synthesize"}` builds the synthesis. `GET ?idea=` returns the stored state |
| `GET/POST /api/ideas` | List questions; point-by-point predictions per brain (cached as `PREDICTS` edges); `advice=1` gives advice with verified citations |
| `GET/POST /api/knowledge` | Wikidata entity linking (`link`), web check (`check`), and a question's concepts, bridges and graph |

## Code
- [`lib/relate.ts`](lib/relate.ts): one store handle per process. The Node client can't release a lock, see [docs/RELATE_NOTES.md](../docs/RELATE_NOTES.md).
- [`lib/talk.ts`](lib/talk.ts): Talk mode. It extracts beliefs with verbatim quotes and style, and reuses matching claims through the vector index.
- [`lib/panel.ts`](lib/panel.ts): panel answers (GraphRAG per brain) and synthesis.
- [`lib/brains.ts`](lib/brains.ts): seeding, stance prediction, Quiz, cross-validation, delete.
- [`lib/ideas.ts`](lib/ideas.ts): splits questions into claims and predicts point by point.
- [`lib/knowledge.ts`](lib/knowledge.ts): Wikidata entity linking and web checks.
- [`lib/llm.ts`](lib/llm.ts): Groq / Ollama / none, with automatic fallback when the daily quota is used up.
- [`lib/embed.ts`](lib/embed.ts): local MiniLM sentence embeddings.

**First run:** the server seeds the probe bank ([`data/probe_claims.json`](data/probe_claims.json)) and the example brains ([`data/example_brains.json`](data/example_brains.json)) if the graph has none. The committed graph already includes them, plus the Talk-built Skeptical CFO and one answered panel question.

**Gotcha:** while `npm run dev` runs, no other process can open `graph/brainprint.rl` for writing. Stop the server first.
