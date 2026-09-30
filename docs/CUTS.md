# Per-signal display cuts

Each signal has its own default display cut and floor, stored in [`cuts.json`](../cuts.json). A signal with no entry uses the default pair, 0.7 and 0.5. Every override still works: `--threshold` and `--cut` move all signals, `--cut-signal ID=N` and `--floor-signal ID=N` move one, at scan time or with `jevs rescore`.

| Signal                               | Cut | Floor | Why                                                     |
| ------------------------------------ | --- | ----- | ------------------------------------------------------- |
| `clone_same_policy`                  | 0.7 | 0.5   | the old default; the rule below kept it                 |
| `function_should_split`              | 0.5 | 0.35  | the rule moved both edges down                          |
| `function_multiple_responsibilities` | 0.7 | 0.5   | no constructed data exists; the old default             |
| `name_vs_behavior` (opt-in)          | 0.5 | 0.2   | constructed data set the cut, the real sample the floor |

The other experimental signals have no constructed data and keep 0.7 and 0.5.

## Why `name_vs_behavior` has a low floor

On the 400-function real sample Jev answered `name_fits` for 399 and put no function at 0.7 or above; the highest P was 0.60. A single 0.7 cut would have made the signal silent on that code. The 16 functions a model labeler called imprecise or mismatched sit between 0.00 and 0.50 (mean P 0.119, against 0.023 for the other 384). The 5 `mismatch` functions sit at 0.30, 0.20, 0.11, 0.01 and 0.01, so none of them clears 0.5 either. The planted renames of the constructed set do: 29 of 50 reach 0.5.

So the two datasets fix different edges. The constructed set says where planted, unambiguous mismatches fall (the cut, 0.5, with no untouched control above it). The real sample says where the functions readers find questionable start to outnumber the rest: 5 of the 15 functions at P 0.2 or above (33%) and 5 of 17 at 0.15 or above (29%), so the floor is 0.2. The "uncertain, check" band for this signal is therefore 0.2 up to 0.5. On the real sample it holds 13 functions out of 400 (3%), 4 of them flagged by a labeler (and 1 of 2 at or above 0.5). Expect mostly well-named functions there: the real rate of clear mismatches was about 1%.

The 30% line at 0.2 versus 29% at 0.15 is a difference of one function. A different draw could move the floor. The real numbers rest on 16 functions and 5 mismatches, and no person labeled them.

## Why change the cut

The constructed-contrast evaluation ([`evals/contrast/results/`](../evals/contrast/results/README.md)) ranked planted positives above controls, but at the flat 0.7 cut it caught few of them: 8 of 50 chimeras for `function_should_split`, and 19 of 50 renamed functions for `name_vs_behavior`. The ranking was good and the cut threw most of it away.

## The rule

`node evals/cuts/derive.mjs` applies it, offline, to data committed in this repository, and writes [`evals/cuts/result.json`](../evals/cuts/result.json). `cuts.json` must match its output; `--check` and a test enforce that. The rule was fixed before its output was read.

- **Cut.** The lowest value on a 0.05 grid from 0.50 to 0.70 where all of these hold. Untouched controls of the primary set score at or above it at most 5% of the time. For `function_should_split` and `clone_same_policy`, the harder controls (A2, B2) do so at most 10% of the time. Where labeled real cells exist, at least 30% of the labeled cells at or above it were judged actionable by the LLM reviewer. If nothing qualifies, the cut stays 0.70.
- **Floor.** The lowest value on a 0.05 grid from 0.05 to the cut where at most 10% of primary controls score at or above it and, where labeled real cells exist, at least 30% of the labeled cells at or above it were positive. If nothing qualifies, 0.50. The 30% line is the gate's own line for a low-precision signal (`evals/gate.json`).
- **Data.** Controls: sets A and A2 (`function_should_split`), B and B2 (`clone_same_policy`), C (`name_vs_behavior`), from `live-1` and `live-2`. Real cells for the two function-level signals and `clone_same_policy`: the 95 LLM-labeled cells of [`docs/BASELINE.md`](BASELINE.md). Real cells for `name_vs_behavior`: the 400 randomly sampled functions of the real-code evaluation (live run 3, [pull request 15](https://github.com/GabrielCoelhoCruz/jev-scanr/pull/15)), copied into [`evals/cuts/real-name-cells.json`](../evals/cuts/real-name-cells.json) by `evals/cuts/import-real.mjs` until that evaluation is merged. A cell counts as positive there when either of two model labelers called the function `imprecise` or `mismatch` (16 functions; 5 of them `mismatch`, all by one labeler). No person labeled any of it.

| Signal                  | Positives at the old 0.7 | Positives at the new cut | Untouched controls at the new cut |
| ----------------------- | ------------------------ | ------------------------ | --------------------------------- |
| `function_should_split` | 8 of 50 (16%)            | 19 of 50 (38%)           | 2 of 50 (4%)                      |
| `name_vs_behavior`      | 19 of 50 (38%)           | 29 of 50 (58%)           | 0 of 50 (0%)                      |
| `clone_same_policy`     | 49 of 50 (98%)           | 49 of 50 (98%)           | 2 of 50 (4%)                      |

The full grid, with the harder controls and the labeled cells, is in `result.json`.

## Limits

Read these before trusting a number.

1. **Constructed positives are easier than real candidates.** A recall of 38% on chimeras says nothing about what share of real split candidates sit above 0.5.
2. **The false-alarm rate is measured on controls, not on your code.** A control is an untouched real function. A long real function may deserve a split, and a pair of different functions may share a policy, so controls are not verified negatives. The rate also does not say how many items a scan of your project will add. Lowering the cut from 0.7 to 0.5 adds every cell between them, and no real-code sample exists for that range.
3. **The real-cell check is empty where it matters.** Every LLM-labeled cell in `evals/baseline/cells.json` has P of 0.53 or higher, and all `function_should_split` cells are at or above 0.67. For that signal the 30% condition is therefore the same at every cut from 0.50 to 0.65 (12 of 36) and constrains nothing. The labels are an LLM reviewer's, and that reviewer's `function_should_split` labels disagreed with a second reviewer's.
4. **One run, small n.** 50 to 100 units per set, one pass each, one day, one model version. The 5% and 10% limits are judgments. `clone_same_policy` stays at 0.70 only because 3 of 50 controls (6%) reach 0.65, one over the limit. The choice is on a knife edge and a different run could move it.
5. **`function_multiple_responsibilities` has no constructed set**, so its cut is the old default, not a finding.
6. **The real sample says little about recall.** With 16 imprecise and 5 mismatched functions, no rate above is an estimate of how many real mismatches a cut finds.
7. **Jev's P moves between calls.** The retest in `live-2` moved P by 0.011 on average and 0.06 at most, with no choice flips, in one hour on the same requests. A cut is still a display setting, not a calibration.
8. **The floor is a judgment too.** It follows the same control rate, not a measured yield of the uncertain band.

When human labels exist, [`BANDS.md`](BANDS.md) and [`BASELINE.md`](BASELINE.md) describe how to set the edges from them. Replace this rule then.

## Reproduce

```sh
node evals/cuts/derive.mjs --markdown   # the table above, from committed data, no API call
node evals/cuts/derive.mjs --check      # result.json and cuts.json are what the rule gives
```
