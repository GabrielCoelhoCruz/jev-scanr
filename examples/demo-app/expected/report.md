# Scan report

Provenance: **live**. Plan `65338442af64…`, catalog 0.1.0-alpha, signals: clone_same_policy, function_should_split, function_multiple_responsibilities.
29 cells (unit × question): 29 scored. 5 at or above the display cut. 15 units in 15 requests.

The display cut is a display setting, not a calibration. Jev probabilities are rounded to two decimals, are not reproducible from call to call, and are not the chance of a bug or of a worthwhile change.

Coverage: read 10 of 10 source files (100%).

Cost (calculated from provider-returned usage, not an invoice): **US$0.0008** for 19,754 input tokens over 15 attempts, 3 s wall-clock at concurrency 8.

| Signal | Status | Scored | At or above cut | Uncertain band | Cut | Floor | Model said insufficient | Evidence so far |
|---|---|---:|---:|---:|---:|---:|---:|---|
| clone_same_policy@3.0.0 | default | 1 | 1 | 0 | 0.7 | 0.5 | 0 | 5/5 actionable above the cut (daily-tracker, LLM reviewer) |
| function_should_split@1.0.0 | default | 14 | 2 | 0 | 0.5 | 0.35 | 0 | 4/5 actionable above the cut (daily-tracker, LLM reviewer) |
| function_multiple_responsibilities@1.0.0 | default | 14 | 2 | 0 | 0.7 | 0.5 | 0 | 2/4 actionable above the cut (daily-tracker, LLM reviewer) |

Next: open `queue.md`. Every item there is something to verify, not to apply.
