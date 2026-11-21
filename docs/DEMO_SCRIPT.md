# BrainPrint: 90-second demo video script

**Setup before recording**
- `cd web && npm run dev` with a Groq key in `web/.env.local`. Make sure the free daily quota isn't used up: do a test run *before* the day of recording, or set `GROQ_MODEL=openai/gpt-oss-20b`.
- **Browser:** 1440 px wide, dark mode, zoom 100%, starting on the **Pitch timeline** page with `pitch_jargon` selected.
- **If you ran the Colab notebook** (real TRIBE data), the yellow "synthetic placeholder" banner disappears. Re-ingest first: `python graph/ingest.py` with the server stopped. **If you did not,** keep the banner visible and say the placeholder line below. Do not hide it.
- **Pre-warm** the slow steps so the video doesn't wait on them: open the Idea Lab once and press "Get advice" once.

| time | screen | narration |
|---|---|---|
| **0:00–0:08** | Pitch timeline, Ledgerly v1. The Engagement line dips through the middle. | "Before you pitch, test it on two kinds of brain. Here's a startup pitch, second by second." |
| **0:08–0:22** | Drag the cursor into the 21–35 s band. The brain map lights up, and the insight card reads *Attention dip*. | "Meta's TRIBE v2 predicts how an *average* brain's networks respond. In the jargon block, the predicted attention signal drops and default-mode rises. These are predictions, not opinions." *(If placeholder: "In this demo the curves are placeholder data; the real model runs on a GPU in our Colab notebook.")* |
| **0:22–0:32** | Graph explorer: hover a dashed `SIMILAR_TO` edge, click it, and the view jumps to Ledgerly v2. | "Every panel is a Cypher query on one Relate file. Vector search over brain-response patterns finds similar moments in other pitches, and a revision that fixed them." |
| **0:32–0:42** | Ask the graph, then "Suggest a concrete rewrite". The answer appears with citation chips and "6/6 citations verified". | "The agent answers from graph facts only, and every node it cites is checked against what the queries actually returned." |
| **0:42–0:50** | Select the insight and press "✓ Real issue". The calibrated badge and the dashed "before calibration" line appear. | "My feedback is stored in the graph and recalibrates the lens. TRIBE itself is never retrained." |
| **0:50–1:05** | Brain Library, Cautious investor: answer one question. The reveal reads "The brain had predicted … ✓", and the KPI tiles show "CV 64–73% vs 59% baseline". | "Second kind of brain: mindsets I train by answering. Each brain commits to a prediction *before* I answer, so its accuracy is honest, and we show it against a baseline." |
| **1:05–1:20** | Idea Lab, Ledgerly v1 matrix: jargon points ✗ for both brains, "5 hours a month" ✓. Click a cell to show the starred answers behind it. Scroll to World knowledge (`ai` → *artificial intelligence*, Wikidata Q11660) and a web check verdict. | "Paste an idea. It's split into claims, linked to Wikidata, and every brain predicts which points land and which put it off. Each prediction shows its evidence from the graph." |
| **1:20–1:30** | Zoom out on the Idea knowledge graph, then end on the repo README. | "TRIBE predictions, trained brains, ideas, Wikidata and web sources: one Relate file, one connected context. BrainPrint." |

**Optional 10-second cut (if the video can be longer):** with the web app stopped, show Claude Code with `docs/mcp.example.json` installed, asking "which pitch moments are similar to Ledgerly's jargon block?". Relate's MCP `read_cypher` answers from the same file.

**Honesty checklist for the narration**
- Say "predicted attention signal", never "viewers were bored".
- Brains are "models of answers I gave", never "customers" or "the market".
- Show the accuracy-vs-baseline number on screen at least once.
- If the TRIBE data is still placeholder, say so (see 0:08).
