# Contributing

This project is `jev-scanr`. Its results are written up in [`evals/results/`](evals/results/) and indexed in [`EVIDENCE.md`](EVIDENCE.md).

Thanks for looking. The most useful contributions are **new questions with evidence**, **bug reports with a failing fixture**, and **labels** on cards from your own project. Please open an issue before a large change.

```sh
npm ci                                        # Node 24+
npm run ci                                    # syntax and formatting checks, then all tests
python3 -m unittest discover -s test -p test_pinned_config.py
```

Tests are offline. They never call Jev and never need a key. Please keep it that way.

## Ground rules

- **Jev is the only judge.** Code forms units and gathers context. It must not score, rank, filter or pick candidates. A finding's presence, order and cut come from Jev's probabilities.
- **Nothing sent that the user did not choose.** No new network calls, no reading of files outside the analyzed project, no target code execution.
- **A number without its limits is a bug.** Anything that reports a rate says how many cells, who labeled them and on what project.

## Adding a signal

A new signal lands as `experimental` with a question file, two fixtures and a few labeled cases. No API key is needed for that; step 4 is optional, and a maintainer can run it on the pull request. Everything under "The gate" below is only for turning a signal on by default.

A signal is **one versioned question file plus fixtures**.

1. **Create `signals/<id>.json`** and add the id to `order` in `catalog.json`. Fields:
   - `id` (snake_case, same as the file name), `version` (`1.0.0` for a new question), `status` (`experimental` for anything new).
   - `family`, `kinds` (`function`, `function_chunk`, `clone_pair`), `primitive` (`choice`).
   - `scope`: `whole_unit` (the whole function must be visible) or `chunkable` (can be asked of a line window of a very long function). `clone_pair` signals use `pair`.
   - `question`: one narrow, observable property of the visible code. Not "is this good?", not "is this a bug?", not "would refactoring pay off?". Say what does _not_ count.
   - `criteria`: the option names and what each means. It must include `insufficient`, so Jev can say the context is not enough instead of guessing.
   - `presence`: the option that counts as a finding.
   - `evidence`: `[]` for a new signal.
2. **Add fixtures:** `test/fixtures/<id>/positive/` and `test/fixtures/<id>/negative/`. Each is a tiny project (a few lines to a page). The positive one should make a careful reader answer the `presence` option; the negative one should not. The offline test checks that both produce a request that asks your question.
3. **Add cases to `evals/cases/<id>.jsonl`.** At least one `actionable` and one `no_action` case, each with a label and _who gave it_ (`human`, `llm_reviewer` plus the model, or `author`). `node evals/cli.mjs audit` must pass: it checks the case set (duplicates, label leakage, both directions) and the grader (oracle, null, no-answer, induced error, served model). Author labels are sanity checks, not evidence.
4. **Check the cases against Jev once**, with your own key. It sends only those cases:
   ```sh
   node evals/cli.mjs run --yes --cap-usd 0.05 --signal <id> --out ../eval-out
   node evals/cli.mjs report ../eval-out        # report.html
   ```
   Paste the summary in your pull request. It prints recall and false positives at the cut next to the noise floor. **It is not evidence for the gate.** `scripts/check-signal.mjs` is the quicker version of the same check on the fixtures.
5. Run `npm run ci`.

Changing the text of a question or its options is a new question: bump `version` and clear `evidence`. A test fails if evidence belongs to another version. Evidence is never carried over, because a rewritten question is a different measurement.

## The gate a signal must pass to be on by default

`status: default` needs recorded evidence that passes a gate. A test enforces the alpha gate on the development run, and, since 0.3.0-alpha, the independent test's band (each signal records its result in `independentTest`): at least 8 reviewed items and at least 30% worth a look. The stable gate is what a signal needs to be on by default in a stable release. It is implemented in [`evals/`](evals/README.md), so you can run it on your own data.

**Alpha gate** (the first seven signals; enough for an alpha only): on one project, the 5 highest-probability cells at or above the 0.7 cut (all if fewer) plus 3 random cells below the cut, reviewed; at least 2 of the top cells actionable, and the actionable rate above the cut greater than below it.

**Stable gate.** Everything is written down _before_ the labels exist:

1. **Pre-register.** Commit [`evals/gate.json`](evals/gate.json) (its SHA-256 is `75401b5d71c7d14dc048fb6e23ce64607020ebc285cec46f0f964d294a0ac2af`; `gate --expect-rule-sha` refuses any other), the sampling rule and its seed, and who will label.
2. **Sample at random, not from the top.** From **at least two projects** that nobody proposing the signal has used: a random sample of cells at or above the cut, stratified 0.7–0.85 and 0.85–1, with **n ≥ 8** reviewed per signal, plus the 4 cells just below the cut. Also repeat 50 requests to measure how much P moves (`variance`). If more than 20% of cells move by more than 0.05, the report shows a range and the display rule changes.
3. **Labels from a person, or from a calibrated judge.** An LLM judge must not be Jev, must use its own rubric prompt (`evals/judge/RUBRIC.md`), must pass its three known-negative controls, and must agree with a person on at least 90% of the clear cases (at least 20 of them) on a set the judge did not see (`calibrate`). The first calibration set is the 30-card human subset of our validation experiment. Until a judge is calibrated, only human labels count. The judge's first pass is sealed (hashed) before any repository access.
4. **The bar.** At least **50% actionable**, greater than the rate among the cells just below the cut (30–50% is allowed with a "low precision" label; under 30%, or n < 8, the signal stays experimental).
   **The release count.** A signal with `default` or `default_low_precision` counts as DEFAULT. A stable release needs at least 4 DEFAULT signals; with fewer the release stays an alpha and the result is recorded as it is (the first run of this gate landed on exactly 3, which the rule had not covered; the case was added before any new labels exist). With labels that are not from a person or a calibrated judge, the outcome is `not_decidable`. `gate` prints it.
5. **Report the noise floor.** The result prints `1/sqrt(n)` next to every rate. If the rate is within the noise floor of a bar, the verdict is not decided: label more cells.
6. **Publish** the cards, labels, scripts and the `gate` output so anyone can recount, and record the result in the signal's `evidence` with `questionVersion`.

"Actionable" means the reviewer found concrete evidence that a bounded improvement merits coding verification. It does not mean a confirmed bug. The rubric is in `evals/judge/RUBRIC.md`.

If new evidence drops a default signal below its gate, it moves to `signals/retired.md` with the numbers, and it is not deleted.

## Labeling cards

You can help without writing code: run a scan on your own project, pick cards from `queue.md`, and label each `actionable`, `no_action` or `uncertain` after reading the code. Send the labels with the signal ids. Labels from people who did not write the questions are the scarcest input this project has.

## Code style

Prettier defaults (`npm run check`). Keep modules small and dependency-free where possible; the runtime dependencies are pinned exactly. New dependencies need a reason in the pull request and their license added to `licenses/`.
