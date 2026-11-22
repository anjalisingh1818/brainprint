"""Output format shared by run_tribe.py, make_placeholder.py and validate.py.

One JSON file per stimulus, `brainprint.tribe/v1`:

{
  "schema": "brainprint.tribe/v1",
  "stimulus_id": "pitch_clear",
  "title": "...",
  "modality": "text" | "audio" | "video",
  "source": "tribe-v2" | "synthetic-placeholder",
  "warning": null | "...",            # non-null for placeholders
  "model": {...},                      # repo, mesh, TR, hemodynamic offset
  "atlas": {...},                      # atlas name + network mapping version
  "networks": ["visual", ...7],
  "regions": ["lh.G_cuneus", ...],     # ~148 Destrieux regions
  "region_network": ["visual", ...],   # network of each region
  "duration_s": 52,
  "script": "full text, if known",
  "seconds": [
    {"t": 0, "text": "words heard in [t, t+1)",
     "networks": {"visual": 0.01, ...}, "regions": [0.02, ...]}
  ]
}
Values are TRIBE's predicted response (average subject), averaged over vertices.
They are not measurements of any real viewer.
"""
from __future__ import annotations

import json
from pathlib import Path

SCHEMA = "brainprint.tribe/v1"


def build_doc(*, stimulus_id, title, modality, source, networks, regions, region_network,
              times, words_per_second, net_values, reg_values, script=None, warning=None,
              model=None, atlas=None) -> dict:
    seconds = []
    for i, t in enumerate(times):
        seconds.append({
            "t": int(round(t)),
            "text": words_per_second[i],
            "networks": {n: round(float(net_values[i][j]), 5) for j, n in enumerate(networks)},
            "regions": [round(float(v), 5) for v in reg_values[i]],
        })
    return {
        "schema": SCHEMA,
        "stimulus_id": stimulus_id,
        "title": title,
        "modality": modality,
        "source": source,
        "warning": warning,
        "model": model or {},
        "atlas": atlas or {},
        "networks": list(networks),
        "regions": list(regions),
        "region_network": list(region_network),
        "duration_s": (seconds[-1]["t"] + 1) if seconds else 0,
        "script": script,
        "seconds": seconds,
    }


def write_doc(doc: dict, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
