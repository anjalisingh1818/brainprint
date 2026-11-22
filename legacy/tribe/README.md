# tribe/: from a pitch to per-second brain-network predictions

[TRIBE v2](https://github.com/facebookresearch/tribev2) (Meta FAIR, CC BY-NC 4.0) predicts fMRI-like cortical responses to video, audio, or text for an **average subject**. It produces one prediction per second (TR = 1 s) on the fsaverage5 mesh, which has 20,484 vertices. The predictions are already shifted by 5 s to compensate for hemodynamic lag. Text input is first spoken with gTTS and then transcribed, so word timings come out the same way as for audio.

BrainPrint reduces each second to **7 networks** plus **148 Destrieux regions**:

| network | regions (Destrieux 2009, both hemispheres unless noted) |
|---|---|
| visual | occipital cortex, cuneus, calcarine, fusiform, lingual |
| auditory | Heschl's gyrus, transverse temporal sulcus, planum temporale |
| language | **left only**: Broca (IFG opercular/triangular), lateral STG, STS, MTG, angular, supramarginal |
| attention | intraparietal sulcus, superior parietal, middle frontal, superior/inferior frontal sulci |
| default_mode | precuneus, posterior and anterior cingulate, medial and orbital prefrontal |
| motor | pre- and postcentral, central sulcus, paracentral, subcentral |
| other | everything else (medial wall excluded) |

This grouping is **our coarse approximation** for a product demo, not a validated functional parcellation. The exact table lives in [`networks.py`](networks.py) and is versioned (`mapping_version`) in every output file.

## Files
| File | What it does | Needs a GPU? |
|---|---|---|
| `run_tribe.py` | Runs TRIBE on one `.txt`, audio, or video file and writes JSON | yes |
| `colab_run_demos.ipynb` | Runs the 3 demos on Colab in one go and downloads the JSON | Colab GPU |
| `networks.py` | Maps vertices to regions to networks, and holds the aggregation | no |
| `schema.py` | Defines the `brainprint.tribe/v1` JSON format | no |
| `make_placeholder.py` | Writes **synthetic** stand-in JSON (clearly flagged) so the app runs before the GPU step | no |
| `validate.py` | Checks the format of `cache/*.json` and prints a summary. `--selftest` also tests the aggregation | no |
| `cache/` | The committed JSON that the graph ingest and the web app read | |

## The 3 demo pitches (`data/demo/`)
| id | what it tests |
|---|---|
| `pitch_clear` | "Crumb": a concrete story-led pitch, used as the baseline |
| `pitch_jargon` | "Ledgerly v1": a dense jargon block in the middle |
| `pitch_jargon_v2` | "Ledgerly v2": the same product rewritten concretely, for the before/after comparison |

## Run it

**No GPU (placeholders plus checks):**
```bash
pip install -r tribe/requirements.txt
python tribe/validate.py --selftest
python tribe/make_placeholder.py        # only if you want to regenerate the placeholders
```

**Real TRIBE v2 on Colab (or Kaggle):** open `tribe/colab_run_demos.ipynb` in Colab and pick a GPU runtime. Request access to the gated Llama 3.2 model on Hugging Face, then run all cells. Unzip the downloaded `tribe_cache.zip` into `tribe/cache/` and run `python tribe/validate.py`. Each file should now say `REAL`.

**One file on any GPU box (Python 3.11+):**
```bash
pip install "tribev2 @ git+https://github.com/facebookresearch/tribev2.git" -r tribe/requirements.txt
huggingface-cli login
python tribe/run_tribe.py --input my_pitch.mp4 --id my_pitch --out tribe/cache/my_pitch.json
```

## Honesty notes
- The values are model predictions for an average brain. They are not measurements, opinions, emotions, or purchase intent. Treat them as *predicted attention and processing signals*.
- `"source": "synthetic-placeholder"` files come from text heuristics with no neuroscience behind them. They exist only to unblock development, and the UI flags them.
