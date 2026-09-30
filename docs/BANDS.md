# Bands and `jevs rescore`

A hard cut throws away the one piece of information Jev gives you about how sure it was. `queue.md` now sorts items into three bands instead, so a cell at P = 0.66 is not treated the same as one at 0.12, and not the same as one at 0.95.

| Band             | P for the signal's positive option                                   | Where it goes                                                                                                   |
| ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Worth a look     | at or above the signal's cut (default 0.7, see [`CUTS.md`](CUTS.md)) | `queue.md`, first list, highest P first. Also `report.json` `findings`, unchanged                               |
| Uncertain, check | at or above the floor (default 0.5) and below the cut                | `queue.md`, second list. Also `report.json` `uncertain`                                                         |
| Below the band   | below the floor                                                      | Not in `queue.md`. Only in `report.json` (`blocks[].signals[]` with `band: "below"`), counted in `bands.counts` |

An item is still a hypothesis in every band. "Uncertain" says Jev leaned toward the positive option without being sure; expect more `no change` outcomes there than in the first list.

## Where the edges come from

- **The cut (top edge)** is the signal's default cut from `cuts.json`: 0.7 for most signals, which is the cut used in the validation gate and the showcase sample, and 0.5 for `function_should_split` and `name_vs_behavior`, derived from the constructed-contrast data ([`CUTS.md`](CUTS.md) gives the rule and says how weak it is). Move it per run with `--threshold` (or `--cut`, `--cut-signal`). `catalog.json` still carries `displayThresholdDefault` (0.7) as the fallback for evaluation scripts.
- **The floor (lower edge)** is 0.5, or the cut when the cut is lower. It is a judgment, not a measurement. For a three-option question, P at or above 0.5 means the positive option holds the majority of Jev's probability, so it is the answer Jev chose (apart from a near tie). Below 0.5 Jev's most likely answer was another option.
- **Evidence that the band is worth reading, and how weak it is.** The labeled cells just under the cut (the 4 highest-P cells below 0.7 per repository and signal, 8 per signal) were judged actionable by the LLM reviewer in 2 of 8 cases for each of the three default signals (pass 1). Above the cut the same reviewer said 10 of 28 (`function_should_split`), 9 of 15 (`function_multiple_responsibilities`) and 17 of 28 (`clone_same_policy`) in the pooled samples. So the band has a non-zero yield that is lower than above the cut, and 2 of 8 is 25%, under the 30% line that `evals/gate.json` uses for a low-precision signal. The noise floor at n = 8 is about 35 points. That is why these items sit in a separate list labeled "uncertain" and are not merged into the first one.
- **Labeled P range.** The labeled below-cut cells span P = 0.62 to 0.68 (`clone_same_policy`), 0.67 to 0.69 (`function_should_split`) and 0.53 to 0.65 (`function_multiple_responsibilities`). No labeled cell exists under 0.53, so the floor of 0.5 has no labeled data behind it at all. Treat the lower half of the band as untested.
- **Why a band at all.** Jev's P is not reproducible between calls: in the validation gate's repeat (50 requests re-sent unchanged, 235 cells) 3.8% of cells moved by more than 0.05, at most 0.09, and one cell crossed the 0.7 cut. A cell at 0.66 can be a 0.71 on the next call.
- **Per-signal edges.** The labeled real cells (8 per signal under 0.7, none under 0.53) cannot tell the three default signals apart, so the real-code evidence did not move any edge. The edges that differ from 0.7 and 0.5 come from constructed data only ([`CUTS.md`](CUTS.md)); below 0.67 there is no labeled real cell for `function_should_split`. The edges are stored per signal (`report.json` `bands.edges`) and every option has a per-signal form. When human labels exist, the gate's own lines give a rule: the cut is the lowest P at which the human actionable rate is at least 50%, and the floor the lowest P at which it is at least 30% (see [`BASELINE.md`](BASELINE.md), "When human labels exist").

## Options

```sh
jevs scan . --run --yes --cap-usd 1 --threshold 0.6 --floor 0.4     # at scan time
jevs report --plan PLAN --run-dir RUN --out DIR --floor 0.45          # from a plan and its journal
```

A floor above its cut is refused. A cut below 0.5 lowers the default floor to match, which empties the uncertain band unless you set `--floor`.

## `jevs rescore`: re-cut an existing run, offline

```sh
jevs rescore RUN --cut 0.6
jevs rescore RUN --cut 0.6 --floor 0.4
jevs rescore RUN --cut-signal function_should_split=0.8 --floor-signal function_should_split=0.55
```

`RUN` is the output folder of a scan (the one holding `plan.json` and `run/`). To try it without a key or a scan, use the recorded demo run that ships with the package (it holds `plan.json` and `journal.jsonl`): `jevs rescore examples/demo-app/expected --cut 0.5 --out /tmp/demo-rescored` from a clone, or the command `jevs demo` prints at its end for an installed copy. `rescore` reads the stored answers there and sends nothing: no API call, no key, no cost. It writes a new folder next to the old files, `RUN/rescored-<settings>/` (for example `rescored-cut-0.6` or `rescored-cut-0.6_floor-0.4`), with `queue.md`, `report.md` and `report.json`. It never overwrites: if that folder exists it stops and says so, and `--out DIR` chooses another. The original `queue.md`, `report.md` and `report.json` are not touched.

| Option                                     | Meaning                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `--cut N`                                  | the cut for every signal (0 to 1)                                                                         |
| `--floor N`                                | the floor for every signal                                                                                |
| `--cut-signal ID=N`, `--floor-signal ID=N` | one signal, repeatable, applied after `--cut` and `--floor`                                               |
| `--plan FILE`                              | use this plan instead of `RUN/plan.json` (the journal is `RUN/run/journal.jsonl`, or `RUN/journal.jsonl`) |
| `--out DIR`                                | write here instead of `RUN/rescored-<settings>/`                                                          |

It needs at least one of the four cut and floor options. It cannot rescore a continuation plan (use `jevs report` with the base plan), and it cannot rescore a run folder that has no `plan.json`, because items under the old cut need the plan's context to be listed. Moving the cut changes only what is shown; it never changes an answer, and the same answers give the same report.

`rescore` matches stored answers to the plan's requests by their content, not by the plan's hash. So a plan rebuilt later, by another scanner version or from another folder, still re-bands a run whose requests are identical to it. If they are not, `rescore` stops and says the plan has no request with the content the run answered.

## What changed in `report.json`

Earlier fields are unchanged; fields were added.

- Every cell in `blocks[].signals[]` has `floor` and `band` (`worth_a_look`, `uncertain`, `below`, or `null` when it has no score).
- `findings` is still the list at or above the cut. Each item gained `floor` and `band`.
- New: `uncertain` (the same item shape, P from the floor up to the cut, highest P first), `floors` (per signal) and `bands` (`meaning`, `edges` per signal, `counts`).
- Each entry of `views` gained `floor` and `uncertain`.
- `reportHash` changes because the content does. Reports from earlier versions are still valid; rebuilding one gives it the new fields.

`report.md` has an "Uncertain band" and a "Floor" column in its per-signal table.

## Limits

The bands sort items for reading. They are not calibrated probabilities, the labels behind the numbers above are from an LLM reviewer, and the floor is untested below 0.53. See [`BASELINE.md`](BASELINE.md) for how Jev's P compares with free heuristics on the same cells.
