"""Aggregate TRIBE v2 vertex predictions (fsaverage5) into 7 coarse brain networks.

TRIBE v2 predicts one value per cortical vertex per second on the fsaverage5 mesh
(10,242 vertices per hemisphere, left first, then right = 20,484). We label each vertex
with the Destrieux 2009 atlas (shipped by nilearn for fsaverage5) and group the atlas
regions into 7 networks.

The grouping is OUR coarse, hand-made approximation for a product demo, not a validated
functional parcellation. It is versioned (MAPPING_VERSION) and written into every output
JSON so results stay traceable. Changing the table below changes the numbers.
"""
from __future__ import annotations

import numpy as np

MAPPING_VERSION = 1
N_VERTS_PER_HEMI = 10242
NETWORKS = ["visual", "auditory", "language", "attention", "default_mode", "motor", "other"]

# Destrieux label -> network. Labels not listed fall into "other".
# "language" is applied to the LEFT hemisphere only (classic left-lateralised language
# network); right-hemisphere homologues of these regions go to "other".
_MAP: dict[str, str] = {
    # visual: occipital cortex + ventral visual stream
    **{k: "visual" for k in [
        "G_cuneus", "S_calcarine", "Pole_occipital", "G_occipital_middle", "G_occipital_sup",
        "G_and_S_occipital_inf", "S_oc_middle_and_Lunatus", "S_oc_sup_and_transversal",
        "S_occipital_ant", "G_oc-temp_lat-fusifor", "G_oc-temp_med-Lingual",
        "S_oc-temp_med_and_Lingual", "S_collat_transv_post", "S_parieto_occipital",
    ]},
    # auditory: Heschl's gyrus, planum temporale, transverse temporal sulcus
    **{k: "auditory" for k in [
        "G_temp_sup-G_T_transv", "S_temporal_transverse", "G_temp_sup-Plan_tempo", "Lat_Fis-post",
    ]},
    # language (left only): Broca, lateral STG/STS, MTG, angular/supramarginal
    **{k: "language" for k in [
        "G_front_inf-Opercular", "G_front_inf-Triangul", "G_temp_sup-Lateral", "S_temporal_sup",
        "G_temporal_middle", "G_pariet_inf-Angular", "G_pariet_inf-Supramar",
    ]},
    # attention: dorsal attention / frontoparietal control regions
    **{k: "attention" for k in [
        "S_intrapariet_and_P_trans", "G_parietal_sup", "G_front_middle", "S_front_middle",
        "S_front_sup", "S_precentral-sup-part", "S_front_inf",
    ]},
    # default mode: posterior cingulate / precuneus / medial prefrontal
    **{k: "default_mode" for k in [
        "G_precuneus", "G_cingul-Post-dorsal", "G_cingul-Post-ventral", "S_subparietal",
        "G_and_S_cingul-Ant", "G_front_sup", "G_rectus", "G_subcallosal", "S_suborbital",
    ]},
    # motor / somatosensory
    **{k: "motor" for k in [
        "G_precentral", "S_central", "G_postcentral", "S_postcentral", "G_and_S_paracentral",
        "S_precentral-inf-part", "G_and_S_subcentral",
    ]},
}
_LEFT_ONLY = {"language"}
_EXCLUDE = {"Unknown", "Medial_wall"}


def _decode(x) -> str:
    return x.decode() if isinstance(x, (bytes, np.bytes_)) else str(x)


def load_atlas():
    """Return (region_names[ R ], vertex_region[20484] (-1 = excluded), vertex_network[20484] (-1 = excluded))."""
    from nilearn import datasets

    d = datasets.fetch_atlas_surf_destrieux(verbose=0)
    labels = [_decode(l) for l in d["labels"]]
    maps = {"lh": np.asarray(d["map_left"]), "rh": np.asarray(d["map_right"])}
    assert maps["lh"].shape == maps["rh"].shape == (N_VERTS_PER_HEMI,), "atlas is not fsaverage5"

    region_names: list[str] = []
    vertex_region = np.full(2 * N_VERTS_PER_HEMI, -1, dtype=np.int32)
    vertex_network = np.full(2 * N_VERTS_PER_HEMI, -1, dtype=np.int32)
    for h_i, hemi in enumerate(["lh", "rh"]):
        offset = h_i * N_VERTS_PER_HEMI
        for lab_idx, name in enumerate(labels):
            if name in _EXCLUDE:
                continue
            mask = maps[hemi] == lab_idx
            if not mask.any():
                continue
            net = _MAP.get(name, "other")
            if net in _LEFT_ONLY and hemi == "rh":
                net = "other"
            region_names.append(f"{hemi}.{name}")
            vertex_region[offset:offset + N_VERTS_PER_HEMI][mask] = len(region_names) - 1
            vertex_network[offset:offset + N_VERTS_PER_HEMI][mask] = NETWORKS.index(net)
    return region_names, vertex_region, vertex_network


def region_network(region_names: list[str]) -> list[str]:
    """Network name for each region name like 'lh.G_cuneus'."""
    out = []
    for r in region_names:
        hemi, name = r.split(".", 1)
        net = _MAP.get(name, "other")
        if net in _LEFT_ONLY and hemi == "rh":
            net = "other"
        out.append(net)
    return out


def aggregate(preds: np.ndarray, atlas=None) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """preds (T, 20484) -> (networks (T, 7), regions (T, R), region_names).

    Each value is the mean predicted response over the vertices in that network or region.
    """
    preds = np.asarray(preds, dtype=np.float32)
    if preds.ndim != 2 or preds.shape[1] != 2 * N_VERTS_PER_HEMI:
        raise ValueError(f"expected (T, {2 * N_VERTS_PER_HEMI}) fsaverage5 predictions, got {preds.shape}")
    region_names, vreg, vnet = atlas or load_atlas()
    nets = np.stack([preds[:, vnet == i].mean(axis=1) for i in range(len(NETWORKS))], axis=1)
    regs = np.stack([preds[:, vreg == i].mean(axis=1) for i in range(len(region_names))], axis=1)
    return nets, regs, region_names
