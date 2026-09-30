# Evidence

The index of what we measured. Each write-up in [`evals/results/`](evals/results/) gives the method, the sample, the result and what it does **not** show. The short version: every label so far comes from an LLM reviewer, **no person has labeled anything**, every sample is small, and nothing here is confirmed by a maintainer or a test. Read the limits before you trust a number.

| Write-up                                                                                | What it measured                                                                         | Headline                                                                                                                                                                       | Main limit                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Signal curation on one app](evals/results/signal-curation-daily-tracker.md)            | 22 candidate questions, scored on one TypeScript/React Native app and reviewed by an LLM | 7 kept by a rule written before the labels: 21 of 29 top cells actionable (72%) against 1 of 41 for the rest; 0 of 64 random cells below the cut                               | The 72% is an upper bound (highest-probability cells only); one project, the author's own                                                                                                       |
| [Validation gate on two new repositories](evals/results/validation-gate-2026-09-30.md)  | Pre-registered random above-cut sample on two repositories never used before             | 3 of 7 signals reached a default band (only `clone_same_policy` above 50%); those three are the alpha defaults                                                                 | Small n, LLM labels, the prototype pipeline ran (same questions); the repositories disagree on two of the three signals                                                                         |
| [Showcase on t3code and oh-my-pi](evals/results/showcase-t3code-oh-my-pi-2026-09-30.md) | What the scanner surfaces on two public MIT repositories, at pinned commits              | 28 of 79 sampled cells actionable in the sealed first pass (35%), 34 after a repository-reading second pass that leans toward confirming; five candidates listed as hypotheses | 2.8% to 6.8% of each repository has a judged unit; no below-cut sample, so not a gate; one candidate reproduced, with an open unmerged PR (oh-my-pi#13847); maintainers not otherwise contacted |
| [One candidate in detail](evals/results/daily-tracker-case-study.md)                    | What a useful item looks like and what it takes to confirm one                           | A literal-thresholds item that a repository read turned into "a helper already exists"                                                                                         | One item, chosen to illustrate                                                                                                                                                                  |

## The gate

A signal is on by default in a stable release only if it passes the written gate in [`CONTRIBUTING.md`](CONTRIBUTING.md) ([`evals/gate.json`](evals/gate.json), pinned by hash): a random above-cut sample from two or more projects, n of at least 8, at least 50% actionable and above the below-cut rate (30-50% with a low-precision label), labels from a person or a calibrated judge. A stable release needs at least 4 default signals; with fewer, including the exactly-3 result of the first run, the release stays an alpha. No judge is calibrated yet, because the 30 human-labeled cards that would calibrate it do not exist, so under that rule **every signal is still experimental**. In 0.3.0-alpha the three signals that reached a default band in the independent test are on by default and the rest are opt-in; these are alpha defaults.

## Terms

- **Cell:** one signal's question asked about one function or pair. **Card:** the context a reviewer sees for one or more cells.
- **Above the cut:** Jev's probability for a cell is at or above 0.7, the display cut.
- **Worth a look ("actionable"):** the reviewer found concrete evidence that a bounded improvement merits coding verification. It is not a confirmed bug.
- **First pass / second pass:** the reviewer labels from the cards alone and seals those labels (hashes them) before seeing the repository, then labels again with repository access. The second pass is anchored on the first.
- **Noise floor:** 1 divided by the square root of the number of cells, shown next to every rate. A difference smaller than this is within noise.
- **Band:** the pre-registered ranges: above 50% is default, 30% to 50% is default with a low-precision warning, below 30% (or fewer than 8 cells) is experimental.

## Limits that apply to everything here

- **No human labels.** One LLM reviewer family (Claude Opus 5.5) labeled every sample; a second LLM agreed on 85% of 39 shared cells, which is not calibration against a person.
- **A label is not a confirmed bug.** "Actionable" means the reviewer found concrete evidence that a bounded improvement merits coding verification.
- **P is not stable.** Jev's probabilities are rounded to two decimals and moved by more than 0.05 on 3.8% of repeated cells. The 0.7 cut is a display setting.
- **Question versions do not carry over.** A rewritten question starts with no evidence; each catalog entry carries its own.
- Costs are calculated from the published tariff and returned token counts, not invoices.
- Per-cell labels and cards contain excerpts of other people's repositories and are not included here.
