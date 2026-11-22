"""Check tribe/cache/*.json against the brainprint.tribe/v1 format and print a summary.

    python tribe/validate.py              # all files in tribe/cache
    python tribe/validate.py --selftest   # also run aggregate() on fake (T, 20484) preds
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from networks import NETWORKS  # noqa: E402
from schema import SCHEMA  # noqa: E402


def check(doc: dict) -> list[str]:
    errs = []
    if doc.get("schema") != SCHEMA:
        errs.append(f"schema != {SCHEMA}")
    if doc.get("source") not in ("tribe-v2", "synthetic-placeholder"):
        errs.append(f"bad source {doc.get('source')!r}")
    if doc.get("source") == "synthetic-placeholder" and not doc.get("warning"):
        errs.append("placeholder without warning")
    if doc.get("networks") != NETWORKS:
        errs.append("networks list mismatch")
    R = len(doc.get("regions", []))
    if R < 100 or len(doc.get("region_network", [])) != R:
        errs.append(f"regions/region_network bad ({R})")
    secs = doc.get("seconds", [])
    if not secs:
        errs.append("no seconds")
    last = -1
    for s in secs:
        if s["t"] <= last:
            errs.append(f"t not increasing at {s['t']}")
            break
        last = s["t"]
        if set(s["networks"]) != set(NETWORKS) or len(s["regions"]) != R:
            errs.append(f"shape mismatch at t={s['t']}")
            break
        if any(not math.isfinite(v) for v in list(s["networks"].values()) + s["regions"]):
            errs.append(f"non-finite value at t={s['t']}")
            break
    return errs


def selftest() -> None:
    import numpy as np
    from networks import aggregate, load_atlas

    atlas = load_atlas()
    names, vreg, vnet = atlas
    preds = np.zeros((3, 20484), dtype=np.float32)
    preds[1, vnet == NETWORKS.index("visual")] = 1.0  # only "visual" vertices active at t=1
    nets, regs, _ = aggregate(preds, atlas)
    assert nets.shape == (3, 7) and regs.shape == (3, len(names))
    assert nets[1, NETWORKS.index("visual")] == 1.0 and nets[1].sum() == 1.0, nets[1]
    counts = {n: int((vnet == i).sum()) for i, n in enumerate(NETWORKS)}
    print(f"selftest OK: {len(names)} regions; vertices per network {counts}; excluded {int((vnet < 0).sum())}")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
    files = sorted((HERE / "cache").glob("*.json"))
    if not files:
        sys.exit("no files in tribe/cache")
    bad = 0
    for f in files:
        doc = json.loads(f.read_text(encoding="utf-8"))
        errs = check(doc)
        bad += bool(errs)
        secs = doc["seconds"]
        att = [s["networks"]["attention"] for s in secs]
        lo = min(range(len(att)), key=att.__getitem__)
        tag = "REAL" if doc["source"] == "tribe-v2" else "PLACEHOLDER"
        print(f"{'OK ' if not errs else 'ERR'} {f.name:24s} {tag:11s} {doc['duration_s']:3d}s "
              f"attention min at t={secs[lo]['t']}s: \"{secs[lo]['text']}\"" + (f"  {errs}" if errs else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
