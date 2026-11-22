"""Run Meta's TRIBE v2 on one pitch (script .txt, audio, or video) and write BrainPrint JSON.

Needs a CUDA GPU (Colab/Kaggle T4 works), Python >= 3.11, and a Hugging Face token with
access to the gated Llama 3.2 model TRIBE uses as its text encoder
(request it on Hugging Face; if access is missing, TRIBE's error names the exact repo). See tribe/README.md.

    python tribe/run_tribe.py --input data/demo/pitch_clear.txt --id pitch_clear \
        --title "Clear pitch" --out tribe/cache/pitch_clear.json

API used (facebookresearch/tribev2, tribev2/demo_utils.py):
    TribeModel.from_pretrained("facebook/tribev2", cache_folder=...)
    model.get_events_dataframe(text_path=|audio_path=|video_path=)  -> events DataFrame
    model.predict(events=df) -> (preds[T, 20484], segments)  # 1 row per 1 s TR, fsaverage5
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from networks import MAPPING_VERSION, NETWORKS, aggregate, load_atlas, region_network  # noqa: E402
from schema import build_doc, write_doc  # noqa: E402

MODALITY = {".txt": "text", ".wav": "audio", ".mp3": "audio", ".flac": "audio", ".ogg": "audio",
            ".mp4": "video", ".mov": "video", ".mkv": "video", ".avi": "video", ".webm": "video"}


def words_by_second(events, times: list[float]) -> list[str]:
    """Join the transcribed words whose onset falls in [t, t+1)."""
    words = events[events["type"] == "Word"] if "type" in events else events.iloc[0:0]
    out = []
    for t in times:
        w = words[(words["start"] >= t) & (words["start"] < t + 1.0)].sort_values("start")
        out.append(" ".join(str(x) for x in w["text"].tolist()))
    return out


def load_model(cache_folder: str = "./tribe_cache"):
    from tribev2.demo_utils import TribeModel  # imported late so --help works without TRIBE

    return TribeModel.from_pretrained("facebook/tribev2", cache_folder=cache_folder)


def run(model, input_path: str, stimulus_id: str, title: str | None, out: str,
        save_raw: bool = False, atlas=None) -> dict:
    src = Path(input_path)
    modality = MODALITY.get(src.suffix.lower())
    if modality is None:
        raise ValueError(f"unsupported input type: {src.suffix}")

    df = model.get_events_dataframe(**{f"{modality}_path": str(src)})
    preds, segments = model.predict(events=df)
    times = [float(s.start) for s in segments]
    print(f"[{stimulus_id}] TRIBE preds {preds.shape}, t={times[0]:.1f}..{times[-1]:.1f}s")
    if save_raw:
        np.save(Path(out).with_suffix(".npy"), preds.astype(np.float16))

    atlas = atlas or load_atlas()
    nets, regs, region_names = aggregate(preds, atlas)
    doc = build_doc(
        stimulus_id=stimulus_id,
        title=title or stimulus_id,
        modality=modality,
        source="tribe-v2",
        networks=NETWORKS,
        regions=region_names,
        region_network=region_network(region_names),
        times=times,
        words_per_second=words_by_second(df, times),
        net_values=nets,
        reg_values=regs,
        script=src.read_text(encoding="utf-8") if modality == "text" else None,
        model={"repo": "facebook/tribev2", "mesh": "fsaverage5", "n_vertices": int(preds.shape[1]),
               "tr_s": 1.0, "hemodynamic_offset_s": 5, "subject": "average",
               "note": "Predicted fMRI-like response for an average subject; offset already compensates hemodynamic lag."},
        atlas={"name": "Destrieux 2009 (nilearn, fsaverage5)", "mapping_version": MAPPING_VERSION},
    )
    write_doc(doc, out)
    print(f"[{stimulus_id}] wrote {out}: {doc['duration_s']} s, {len(region_names)} regions")
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help=".txt script, audio, or video file")
    ap.add_argument("--id", required=True, help="stimulus id, e.g. pitch_clear")
    ap.add_argument("--title", default=None)
    ap.add_argument("--out", required=True, help="output JSON path")
    ap.add_argument("--cache-folder", default="./tribe_cache", help="TRIBE feature/model cache")
    ap.add_argument("--save-raw", action="store_true", help="also save raw (T, 20484) preds as .npy")
    args = ap.parse_args()
    run(load_model(args.cache_folder), args.input, args.id, args.title, args.out, args.save_raw)


if __name__ == "__main__":
    main()
