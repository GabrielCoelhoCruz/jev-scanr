# Scan report

Provenance: **live**. Plan `61f3eff3513d…`, catalog 0.1.0-alpha, signals: clone_same_policy, function_should_split, magic_policy_literal, internal_duplication, function_multiple_responsibilities, unused_local_or_parameter, deep_nesting.
85 cells (unit × question): 85 scored. 7 at or above the display cut. 15 units in 15 requests.

The display cut is a display setting, not a calibration. Jev probabilities are rounded to two decimals, are not reproducible from call to call, and are not the chance of a bug or of a worthwhile change.

Cost (calculated from provider-returned usage, not an invoice): **US$0.0011** for 27,240 input tokens over 15 attempts.

| Signal | Status | Scored | At or above cut | Cut | Model said insufficient | Evidence so far |
|---|---|---:|---:|---:|---:|---|
| clone_same_policy@3.0.0 | default | 1 | 1 | 0.7 | 0 | 5/5 actionable above the cut (daily-tracker, LLM reviewer) |
| function_should_split@1.0.0 | default | 14 | 1 | 0.7 | 0 | 4/5 actionable above the cut (daily-tracker, LLM reviewer) |
| magic_policy_literal@1.0.0 | default | 14 | 1 | 0.7 | 0 | 3/5 actionable above the cut (daily-tracker, LLM reviewer) |
| internal_duplication@1.0.0 | default | 14 | 1 | 0.7 | 0 | 3/5 actionable above the cut (daily-tracker, LLM reviewer) |
| function_multiple_responsibilities@1.0.0 | default | 14 | 1 | 0.7 | 0 | 2/4 actionable above the cut (daily-tracker, LLM reviewer) |
| unused_local_or_parameter@1.0.0 | default | 14 | 1 | 0.7 | 0 | 2/3 actionable above the cut (daily-tracker, LLM reviewer) |
| deep_nesting@1.0.0 | default | 14 | 1 | 0.7 | 0 | 2/2 actionable above the cut (daily-tracker, LLM reviewer) |

Next: open `queue.md`. Every item there is something to verify, not to apply.
