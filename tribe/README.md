# tribe/

This folder will hold the TRIBE v2 runner, built in P1. It takes a clip or a script and writes JSON with per-second activation aggregated into 7 networks: visual, auditory, language, attention, default-mode, motor, and other.

- `cache/`: committed output JSON for the 3 demo clips, which the web app reads.
- The runner targets a Colab or Kaggle GPU.
