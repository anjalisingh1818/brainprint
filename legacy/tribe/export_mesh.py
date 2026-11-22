"""Export a light 2D brain mesh for the web heatmap: web/public/brain_mesh.json.

Takes the fsaverage5 *inflated* surface from nilearn (the same mesh TRIBE predicts on) and
the Destrieux region of every vertex. It prepares 4 orthographic views (left lateral, left
medial, right medial, right lateral). For each view it keeps the faces nearest the camera,
sorted back to front (painter's algorithm), with a per-face shade. The browser then only
fills triangles in the colour of their region's value.

    python tribe/export_mesh.py
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from networks import N_VERTS_PER_HEMI, load_atlas  # noqa: E402

OUT = HERE.parent / "web" / "public" / "brain_mesh.json"
# view: (hemisphere, viewer side along x: -1 = looking from -x, +1 = from +x)
VIEWS = [("lh", "lateral", -1), ("lh", "medial", +1), ("rh", "medial", -1), ("rh", "lateral", +1)]


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def main() -> None:
    from nilearn import datasets, surface

    fs = datasets.fetch_surf_fsaverage("fsaverage5")
    _, vreg, _ = load_atlas()
    out = {"format": "brainprint.mesh/v1", "views": []}
    for hemi, kind, side in VIEWS:
        mesh = surface.load_surf_mesh(fs[f"infl_{'left' if hemi == 'lh' else 'right'}"])
        coords, faces = np.asarray(mesh[0], dtype=np.float32), np.asarray(mesh[1], dtype=np.int64)
        off = 0 if hemi == "lh" else N_VERTS_PER_HEMI
        region = vreg[off:off + N_VERTS_PER_HEMI]

        # camera looks along +x if side == -1 (viewer at -x). Screen: anterior (+y) to the left for
        # a left-lateral view, matching the usual radiological picture.
        sx = coords[:, 1] * side          # screen x
        sy = -coords[:, 2]                # screen y (down)
        depth = coords[:, 0] * side       # smaller = closer to viewer

        tri = coords[faces]
        normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-9
        facing = -normals[:, 0] * side    # >0: normal points at the viewer
        d = depth[faces].mean(axis=1)
        keep = (facing > 0) | (d < np.median(d))
        idx = np.where(keep)[0]
        idx = idx[np.argsort(-d[idx])]    # far -> near
        shade = np.clip(0.55 + 0.45 * np.abs(facing[idx]), 0, 1)

        # normalise to an integer grid 0..1000 (aspect kept)
        x0, y0 = sx.min(), sy.min()
        scale = 1000.0 / max(sx.max() - x0, sy.max() - y0)
        xy = np.stack([(sx - x0) * scale, (sy - y0) * scale], axis=1).round().astype(np.uint16)
        face_region = region[faces[idx, 0]].astype(np.int16)  # colour by first vertex's region (-1 = none)
        out["views"].append({
            "hemi": hemi, "kind": kind,
            "width": int(xy[:, 0].max()) + 1, "height": int(xy[:, 1].max()) + 1,
            "xy": b64(xy.reshape(-1)), "faces": b64(faces[idx].astype(np.uint16).reshape(-1)),
            "face_region": b64(face_region), "shade": b64((shade * 255).astype(np.uint8)),
            "n_faces": int(len(idx)),
        })
        print(f"{hemi} {kind}: {len(idx)} faces")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
