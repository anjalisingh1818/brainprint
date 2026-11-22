"""Static graph content: networks, lenses, projects, and the demo revision.

Lenses are WEIGHTINGS over predicted brain-network signals. They are not people,
personas, or audience segments.
"""

NETWORKS = {
    "visual": "Occipital and ventral visual cortex: predicted processing of what is seen.",
    "auditory": "Primary/secondary auditory cortex: predicted processing of sound and speech acoustics.",
    "language": "Left fronto-temporal language regions: predicted processing of words and sentences.",
    "attention": "Dorsal attention / frontoparietal control: predicted externally focused attention.",
    "default_mode": "Precuneus, cingulate, medial prefrontal: often rises when attention drifts inward.",
    "motor": "Sensorimotor strip: predicted motor/somatosensory processing.",
    "other": "All remaining cortex (medial wall excluded).",
}

# Each lens: weights over network z-scores. score(segment) = sum_n w_n * strength_n
LENSES = [
    {
        "id": "engagement", "name": "Engagement",
        "description": "Predicted external attention, minus default-mode drift.",
        "weights": {"attention": 0.6, "auditory": 0.15, "visual": 0.15, "default_mode": -0.5},
    },
    {
        "id": "clarity", "name": "Clarity",
        "description": "Language processing that is backed by attention (not effortful overload).",
        "weights": {"language": 0.4, "attention": 0.5, "default_mode": -0.3},
    },
    {
        "id": "visual_hook", "name": "Visual hook",
        "description": "Predicted visual processing with attention; most relevant to video pitches.",
        "weights": {"visual": 0.7, "attention": 0.3},
    },
]

PROJECTS = [
    {"id": "crumb", "name": "Crumb", "stimuli": ["pitch_clear"]},
    {"id": "ledgerly", "name": "Ledgerly", "stimuli": ["pitch_jargon", "pitch_jargon_v2"]},
]

# Demo revision: Ledgerly v2 rewrites the jargon block of v1. FIXES edges point at v1's
# rule insights. Whether the fix held is measured by queries, and later by your feedback.
REVISIONS = [
    {"id": "rev_ledgerly_v2", "from": "pitch_jargon", "to": "pitch_jargon_v2",
     "note": "Replaced the jargon block with a concrete customer story (Maya) and one-line value prop."},
]
