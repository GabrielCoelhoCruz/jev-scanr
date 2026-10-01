# Evals: testing a signal the way we did

Everything a contributor needs to check whether a question deserves to be on by default. The design follows the checklists in Anthropic's [`skills/claude-api/shared/evals`](https://github.com/anthropics/skills/tree/main/skills/claude-api/shared/evals) (`build-eval.md`, `eval-audit.md`, `report/SCHEMA.md`), written here for this task. Its report builder is vendored unchanged in [`vendor/anthropic-skills/`](vendor/anthropic-skills/) under Apache-2.0, with its license and provenance. Results use that project's layout, so `report.html` renders from them.

```sh
node evals/cli.mjs audit          # offline, free: case-set audit and grader self-checks
node evals/cli.mjs --help
```

## Two questions, two evals

1. **Does the question separate positive from negative cases?** Case sets in `cases/<signal>.jsonl`: a small project, a label, and who gave the label. `run` asks Jev once per case and reports recall, false-positive rate and precision at the cut, next to the **noise floor** (about `1/sqrt(n)`, so 8 cases cannot see a difference under about ±35 points) and the majority-class baseline. The starter sets are our own fixtures, labeled by us. They are sanity checks, and every report says so.
2. **Are the findings above the cut worth a person's time?** That is the gate. It takes a _random_ sample of above-cut cells from two or more projects, labels from a person or a calibrated judge, and a rule committed before the labels exist (`gate.json`, hash printed by `gate`).

## What `audit` checks, and why

- **The case set.** Schema, duplicates and near-duplicates, contradictory labels, label leakage (the source or path naming the signal or the answer), label balance and majority baseline, and both directions per signal (a signal that only has positives can be gamed by "always fire"). Every label carries its source: `human`, `llm_reviewer` (and which model) or `author`. Labels from the model that the eval is meant to judge would reward imitation, so `jev*` cannot be a judge.
- **The grader,** by pushing known inputs through the same runner and grader that a live run uses:
  - **Oracle.** Answers copied from the labels must score 100%.
  - **Null.** An always-negative answer must get zero recall, and an always-positive one zero specificity.
  - **No answer is not a negative.** A model that says `insufficient` is counted as _abstained_, never as a true or false negative. Abstentions and errors are reported next to the rates.
  - **An error is not a zero.** An API failure is written to `errors.jsonl` with a failure class and stops the run. It is not a graded failure. There are no retries.
  - **Served model.** A response from any model other than `jev-1.13.0` is rejected and recorded as `served_model_mismatch`.

## Free baseline

`baseline/` compares Jev's stored P with free heuristics (function length, complexity, token similarity) on the labeled cells, from stored answers and labels only. Result and caveats: [`docs/BASELINE.md`](../docs/BASELINE.md). `node evals/baseline/analyze.mjs` reruns it offline.

## Constructed contrast

`contrast/` tests Jev against free heuristics on units built by mechanical change (chimeras, rewritten copies, swapped names), with the heuristic's own feature matched between the classes. Design, limits and the analysis rules fixed before the live run: [`contrast/README.md`](contrast/README.md).

## P variance

Jev's probabilities are rounded to two decimals and are not reproducible from call to call, so a cut on P has a blurry edge. `variance` re-sends N answered requests once (chosen by a frozen seed) and reports how many cells moved by more than 0.05, the largest move, choice flips and cut crossings. The registered rule: if more than 20% of cells move by more than 0.05, show a range instead of a number and require P at or above the cut in two calls.

A cut crossing is now measured at each signal's own default cut from `cuts.json` (0.7 for most, 0.5 for `function_should_split` and `name_vs_behavior`), not one global 0.7, because the display edges differ per signal. `variance.json` carries `cutBySignal` (the edge and crossing count per signal) and `cut`/`cutMeaning`; pass `--cut N` to re-band every cell at one override edge instead. A repeat must be measured before its crossings mean anything: the only published repeat (50 requests, 235 cells, one crossing at the 0.7 cut) was run on the prototype pipeline, and its journals are not in this repository, so this repo has no recorded repeat to re-band offline. `compareRuns` re-bands any stored journal pair offline to fill that gap when one exists; until then, treat the per-signal crossing counts as unmeasured here rather than borrowing the prototype's number.

## LLM judges

- **Not the question's prompt.** The judge gets a rubric-based prompt of its own (`judge/RUBRIC.md`: the frozen actionability rubric plus one note per signal). It is never shown Jev's instructions, any probability or any model output, and the code is marked as untrusted data.
- **Known negatives.** Every batch includes three controls: trivial code, empty input, and code with a different problem from the one asked about. A judge that does not label them `no_action`, `uncertain` and `no_action` is rejected.
- **Not Jev, not the same family as the model under test.** `judge-import` refuses `jev*`.
- **Calibrated before it can decide.** See [`calibration/README.md`](calibration/README.md): about 90% agreement with a person on the clear cases. The first calibration set is the 30-card human subset of our validation experiment, when its labels exist. Until then the gate accepts only human labels.
- **Rationale, one property per call, structured output.** Each answer is a JSON line with label, rationale and citations.

## Files

`cli.mjs` (commands), `lib/` (cases, grader, runner, variance, judge, gate, stats), `cases/` (starter sets), `judge/RUBRIC.md`, `gate.json`, `calibration/`, `vendor/anthropic-skills/` (Apache-2.0, unchanged).

Live commands send case sources to the Jev API with your `TYPESAFE_API_KEY` (environment only), one request at a time, no retries, and need `--yes` and `--cap-usd`.
