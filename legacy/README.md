# legacy/: the TRIBE v2 pitch-timeline module (its runner is reused by brainwave/)

BrainPrint started as a "pitch timeline". Meta's **TRIBE v2** predicted how an average brain's networks respond to each second of a pitch, and those predictions were stored in Relate as segments, networks, lenses and insights. The project then refocused on the **Brain Panel** (persona brains built by talking). The timeline was removed from the app, and its pipeline is kept here for reference.

| path | what it was |
|---|---|
| `tribe/` | TRIBE v2 runner (`run_tribe.py`), the Colab notebook (`colab_run_demos.ipynb`), the 7-network / Destrieux aggregation (`networks.py`), placeholder curves (`make_placeholder.py`), and a validator |
| `graph/` | Python ingest of TRIBE JSON into Relate, named Cypher queries, schema, and a smoke test |
| `data/demo/` | The three demo pitch scripts. They are also the examples in `web/data/examples.json`. |

Notes:
- **Placeholder data:** the TRIBE curves in `tribe/cache/` are **synthetic placeholders**. Real predictions need a GPU run of the Colab notebook.
- **Paths:** the scripts' relative paths assume their original locations (`tribe/`, `graph/`). To run them, check out commit `7bc35c6`, the last commit with the timeline app. The web pages that displayed this data (timeline, brain heatmap, lens feedback) are in that commit too.
