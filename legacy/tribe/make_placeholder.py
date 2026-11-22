"""Make SYNTHETIC placeholder JSON for the demo scripts. This is NOT TRIBE output.

Why it exists: TRIBE v2 needs a GPU plus gated Llama-3.2 access, so it can't run on every
laptop. The rest of the app (graph, UI, agent) still needs data in the right shape while
the real Colab run is pending. These files are marked `"source": "synthetic-placeholder"`
plus a warning, and the UI shows a banner for them. Replace them by running
tribe/colab_run_demos.ipynb, which overwrites tribe/cache/*.json with real predictions.

The curves come from simple text heuristics (word rate, word length, jargon density) and
a fixed random seed. They carry no neuroscience. They only exist so that downstream code
has realistic shapes and value ranges to work with.

    python tribe/make_placeholder.py            # writes tribe/cache/<id>.json for all demos
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from networks import MAPPING_VERSION, NETWORKS, load_atlas, region_network  # noqa: E402
from schema import build_doc, write_doc  # noqa: E402

ROOT = HERE.parent
DEMOS = [
    ("pitch_clear", "Crumb: bakery leftovers (clear pitch)"),
    ("pitch_jargon", "Ledgerly v1 (jargon-heavy pitch)"),
    ("pitch_jargon_v2", "Ledgerly v2 (revised pitch)"),
]
WORDS_PER_SEC = 2.5  # roughly gTTS speaking rate
JARGON = set("""ai-native end-to-end orchestration leverages multi-agent reconciliation composable
api-first architecture synergistic heterogeneous workflows compliant zero-trust governance
interoperability legacy erp ecosystems rails proprietary embeddings-driven categorisation
predictive modelling adaptive tax-liability forecasting paradigm conceptualise fiscal posture""".split())


def synth(text: str, seed: int):
    rng = np.random.default_rng(seed)
    tokens = re.findall(r"[A-Za-z0-9'\-]+[.,:!?]?", text)
    T = int(np.ceil(len(tokens) / WORDS_PER_SEC))
    per_sec = [tokens[int(t * WORDS_PER_SEC): int((t + 1) * WORDS_PER_SEC)] for t in range(T)]
    words_txt = [" ".join(w) for w in per_sec]

    nets = np.zeros((T, len(NETWORKS)), dtype=np.float32)
    fatigue = 0.0
    for t, ws in enumerate(per_sec):
        clean = [w.strip(".,:!?").lower() for w in ws]
        n = len(clean)
        jarg = sum(1 for w in clean if w in JARGON or len(w) >= 12) / max(n, 1)
        concrete = sum(1 for w in clean if w.isdigit() or w in {"maya", "bakery", "photo", "bread", "receipts",
                                                              "five", "four", "seventy", "hours", "euros"}) / max(n, 1)
        fatigue = min(1.0, max(0.0, fatigue * 0.85 + 0.35 * jarg - 0.4 * concrete))
        speech = 1.0 if n else 0.0
        nets[t] = [
            0.04 + rng.normal(0, 0.01),                                    # visual (audio-only input)
            0.10 + 0.20 * speech + rng.normal(0, 0.015),                    # auditory
            0.05 + 0.22 * speech + 0.08 * jarg + rng.normal(0, 0.015),      # language
            0.28 - 0.22 * fatigue + 0.08 * concrete + rng.normal(0, 0.015), # attention
            0.08 + 0.18 * fatigue + rng.normal(0, 0.015),                   # default_mode
            0.03 + rng.normal(0, 0.008),                                    # motor
            0.06 + rng.normal(0, 0.01),                                     # other
        ]
    # light temporal smoothing, like a slow hemodynamic response
    k = np.array([0.25, 0.5, 0.25])
    nets = np.stack([np.convolve(np.pad(nets[:, j], 1, mode="edge"), k, mode="valid")
                     for j in range(nets.shape[1])], axis=1)
    return nets, words_txt, rng


def main() -> None:
    region_names, _, _ = load_atlas()
    reg_net = region_network(region_names)
    for seed, (sid, title) in enumerate(DEMOS):
        script = (ROOT / "data" / "demo" / f"{sid}.txt").read_text(encoding="utf-8")
        nets, words_txt, rng = synth(script, seed)
        regs = np.stack([nets[:, NETWORKS.index(n)] for n in reg_net], axis=1)
        regs = regs + rng.normal(0, 0.02, regs.shape)
        doc = build_doc(
            stimulus_id=sid, title=title, modality="text", source="synthetic-placeholder",
            warning="SYNTHETIC PLACEHOLDER: heuristic curves, not TRIBE v2 output. "
                    "Run tribe/colab_run_demos.ipynb to replace with real predictions.",
            networks=NETWORKS, regions=region_names, region_network=reg_net,
            times=list(range(len(words_txt))), words_per_second=words_txt,
            net_values=nets, reg_values=regs, script=script,
            model={"repo": "none (synthetic)", "mesh": "fsaverage5", "tr_s": 1.0},
            atlas={"name": "Destrieux 2009 (nilearn, fsaverage5)", "mapping_version": MAPPING_VERSION},
        )
        out = HERE / "cache" / f"{sid}.json"
        write_doc(doc, out)
        print(f"wrote {out.relative_to(ROOT)} ({doc['duration_s']} s, PLACEHOLDER)")


if __name__ == "__main__":
    main()
