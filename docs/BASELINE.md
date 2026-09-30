# Free baseline: does Jev rank better than cheap heuristics?

**Result.** On the cells we have labels for, Jev did not beat free heuristics on any of the three default signals. Function length (lines) ranked the labeled cells at least as well as Jev's P for `function_should_split` and `function_multiple_responsibilities`, and jscpd-style token coverage did for `clone_same_policy`. No difference is statistically clear when the two samples are pooled (n = 23 to 36 cells per signal), except one: on the validation-gate sample alone, function length ranked `function_should_split` cells better than Jev (AUC 0.98 against 0.67, interval for the difference excludes 0). Every label is an LLM reviewer's, the samples are small, and the labeled cells were chosen by Jev's own P, so this is weak evidence in both directions. It does not show that Jev adds nothing. It shows that we have no evidence yet that Jev's probability is worth more than a line count on these signals.

No new Jev call was made. Everything is computed from stored answers, stored labels and the source at the pinned commits.

## What was compared

For each default signal, every labeled cell (one unit and one question) from two independent samples:

| Sample                                                                         | Repositories (pinned commits in `evals/baseline/cells.json`) | Cells per signal (`clone_same_policy` / `function_should_split` / `function_multiple_responsibilities`) | How the cells were chosen                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Validation gate ([write-up](../evals/results/validation-gate-2026-09-30.md))   | claude-office, reshaped                                      | 24 / 24 / 16                                                                                            | Random sample above the 0.7 cut, plus the 4 highest-P cells just below it, per repository and signal |
| Showcase ([write-up](../evals/results/showcase-t3code-oh-my-pi-2026-09-30.md)) | t3code, oh-my-pi                                             | 12 / 12 / 7                                                                                             | Random sample above the 0.7 cut, up to 6 per repository and signal                                   |

Total: 95 cells (`clone_same_policy` 36, `function_should_split` 36, `function_multiple_responsibilities` 23). A cell is positive when the LLM reviewer labeled it `actionable`; `no_action` and `uncertain` both count as not positive, as in `evals/gate.json`. The main view uses pass 1 of the reviewer, which was sealed before the reviewer had repository access. Pass 2 is shown as a check; it changed three `clone_same_policy` labels in these cells and none for the two function signals.

**Jev's score** is the stored P for the signal's positive option. **Jev's rule** is the display cut, P at or above 0.7.

**Heuristics** (all free, all computed from the function source at the pinned commit):

- `function_should_split` and `function_multiple_responsibilities`: function length in lines (chosen in advance as the main one), statement count, cyclomatic complexity (decision points plus one, nested functions included), parameter count and token count. Higher means more likely to be positive.
- `clone_same_policy`: jscpd-style duplicated-token coverage (the share of the smaller function's tokens that sit in a 10-token run also found in the other; chosen in advance as the main one), the 5-token shingle Jaccard the scanner itself used to form the pair, a raw-token 5-gram Jaccard, and the size of the smaller member. jscpd's own default window is 50 tokens, which is longer than most of these pairs, so this is the same idea with a shorter window, not the tool itself.

**Equivalent cut.** A heuristic has no 0.7. For a fair comparison of "actionable rate above a cut", each heuristic keeps the same number of cells as Jev kept above 0.7 in the same pool (k), taken from the top of its own ranking. Ties at the edge share the remaining slots equally.

**Rank metric.** AUC: the chance that a random actionable cell scores above a random non-actionable one (ties count half, 0.5 is chance). Intervals are 95% percentile bootstrap over cells (2,000 resamples, fixed seed). Differences use the same resamples for both scorers.

## Results (pass 1 labels, both samples pooled)

| Signal                               | Cells (actionable) | Jev above 0.7 (k) | Actionable above cut: Jev | Same k, main heuristic | AUC: Jev (95% interval) | AUC: main heuristic (95% interval) | AUC difference, Jev minus heuristic |
| ------------------------------------ | ------------------ | ----------------- | ------------------------- | ---------------------- | ----------------------- | ---------------------------------- | ----------------------------------- |
| `function_should_split`              | 36 (12)            | 28                | 10/28 = 36%               | 43% (function length)  | 0.71 (0.48 to 0.90)     | 0.88 (0.74 to 0.98)                | -0.17 (-0.42 to 0.06)               |
| `function_multiple_responsibilities` | 23 (11)            | 15                | 9/15 = 60%                | 67% (function length)  | 0.70 (0.45 to 0.91)     | 0.80 (0.58 to 0.96)                | -0.10 (-0.43 to 0.22)               |
| `clone_same_policy`                  | 36 (19)            | 28                | 17/28 = 61%               | 68% (token coverage)   | 0.70 (0.52 to 0.86)     | 0.73 (0.54 to 0.88)                | -0.03 (-0.23 to 0.18)               |

How to read it:

- **Point estimates favor the heuristic on all three signals, and every pooled interval on the difference includes zero.** With 23 to 36 cells, a real gap of 0.1 to 0.2 AUC would not be detectable. "No detectable difference" is the accurate reading, not "they are equal".
- **The rate above the cut barely beats picking a cell at random from the pool** for `function_should_split` (36% against a pool rate of 33%). For the other two it is 60% against 48% and 61% against 53%. The pool is enriched by Jev's selection, so the pool rate is not the rate for a random function.
- **The other heuristics** (statements, tokens, complexity) track function length closely for the two function signals (AUC 0.79 to 0.87 for should_split, 0.75 to 0.81 for multiple_responsibilities). Parameter count points the wrong way (AUC 0.44 and 0.35: functions with more parameters were less often actionable). The scanner's own pairing Jaccard ranks the clone pairs at chance (AUC 0.51); it was used to form the pairs, so they all already pass it. The "Jev ahead" verdict for parameter count on `function_multiple_responsibilities` in `evals/baseline/result.json` is a comparison against a cue that points the wrong way, not a win over a useful baseline.
- **Best-of-all-heuristics is not reported as a headline**, because picking the best one after seeing the labels would flatter the baseline. The full table for every heuristic and view is in `evals/baseline/result.json`.

### Sensitivity views (same file)

| View                                                                             | What changes                     | `function_should_split`                                                      | `function_multiple_responsibilities` | `clone_same_policy`                                             |
| -------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| Pass 2 labels                                                                    | three `clone_same_policy` labels | unchanged                                                                    | unchanged                            | Jev AUC 0.75, token coverage 0.76                               |
| Validation gate only (has below-cut cells, so Jev's P varies over a wider range) | 24, 16 and 24 cells              | Jev 0.67, length 0.98; difference -0.30 (-0.59 to -0.05): **baseline ahead** | Jev 0.66, length 0.69                | Jev 0.74, token coverage 0.66; difference +0.08 (-0.18 to 0.38) |
| Second LLM reviewer (39 gate cells only)                                         | too few cells                    | 0 of 8 labeled actionable, so AUC is undefined                               | 7 cells, not analyzable              | 5 cells, not analyzable                                         |

The second reviewer labeled `function_should_split` actionable on none of its 8 cells where the first reviewer did on 3. For that signal the verdict depends on which LLM labels it, which is one more reason not to lean on any of these numbers.

## What this does and does not show

- **Labels are an LLM reviewer's, not a person's.** "Actionable" means the reviewer found concrete evidence that a bounded change merits verification, not that there is a bug. Two LLMs agreed on 33 of 39 cells (85%), and they disagreed most on the signal where the gap above is widest. Nothing here is calibrated against a human.
- **Small n.** 95 cells, 23 to 36 per signal, 11 to 19 positives. The noise floor is about 1/sqrt(n), 17% to 21% here. Bootstrap intervals are wide and assume cells are independent, which they are not quite (several cells can sit in one file).
- **The pool was picked by Jev.** Every labeled cell had P of about 0.53 or higher. Heuristics were scored only inside that pool, so this measures whether a heuristic can sort cells that Jev had already put near the top, not whether it would have found them. The restricted range also pulls Jev's own AUC down, because the pool holds few cells that Jev scored low. The showcase sample has only cells at or above 0.7. These two effects mean the test is not neutral: it is harder for Jev's AUC than a random sample of all functions would be. A fair full comparison needs labels on cells chosen without looking at either scorer, for example a random sample of functions ranked by both.
- **Function length and Jev may find different things.** If most long functions in these repositories are also the ones an LLM reviewer calls worth splitting, length will rank well. That says something about the labels as much as about the scorers. It does not say that every long function should be split.
- **Four repositories.** Two UI libraries or apps (claude-office, reshaped) and two coding-agent projects (t3code, oh-my-pi), all TypeScript. Results may differ on other code.
- **The pairs were already filtered by similarity.** Every `clone_same_policy` cell passed the scanner's shingle-similarity retrieval, so a similarity heuristic is being tested on pairs that are all similar. That favors neither scorer cleanly.

This is not a finding that the signals are useless. The project's gate (`evals/gate.json`) asks whether above-cut items are worth a person's time, and on that test `clone_same_policy` reached 75% and the two function signals 38%. The question here is different: does Jev's number sort better than a free one? On these cells we cannot show that it does.

## Reproduce

Stage B needs only this repository:

```sh
node evals/baseline/analyze.mjs --markdown          # tables, about a second
node evals/baseline/analyze.mjs --out evals/baseline/result.json
```

It reads `evals/baseline/cells.json`: one row per labeled cell with P, the labels, the path and line range of the unit at the pinned commit, and the computed features. It holds no source text. `test/baseline.test.mjs` recomputes the result from the cells and compares it with the committed `result.json`, with literal expected values.

Stage A rebuilt `cells.json` from the stored material (`evals/baseline/build-cells.mjs`): the review cards, the labels, Jev's stored answers and the four repositories checked out at the pinned commits. The cards and answers contain excerpts of other people's repositories and are not in this repository, so only the maintainers can rerun stage A. It checks each input against a pinned sha256, rejoins every card to its stored answer, and fails unless the per-signal counts match the published gate and showcase aggregates exactly. They do.

## When human labels exist

Calibration against people (the method of `typed_evals`: reliability bins, expected calibration error, Brier score against human labels) is out of scope until there are human labels. The 30-card subset of the validation experiment is still unlabeled. When labels exist:

1. Add a `labels.human` field to the cells they cover (the cell `id` is stable) and add `{ name: "human", label: "human", sample: "all" }` to `VIEWS` in `evals/baseline/analyze.mjs`. Every number above then reruns against people, with the same bootstrap.
2. Bin cells by Jev's P and compare the human actionable rate per bin with the rate the band claims. That tells whether 0.7 and 0.5 are in the right place per signal, which `docs/BANDS.md` says today they are not known to be.
3. Only then compare rank quality again. If a heuristic still ties or wins, it belongs in the queue as a cheap pre-filter, not only in this document.

Changing the labeler changes the answer for at least one signal (see the second reviewer above), so do not refresh this page with the new labels unless the old result stays next to it.
