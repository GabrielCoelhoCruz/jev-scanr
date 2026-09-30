# Validation gate on two new repositories (2026-09-30)

**Bottom line.** Three of the seven default signals reached a default band in a pre-registered test on two repositories the project had never used: one at or above 50% actionable (`clone_same_policy`) and two in the 30-50% band with a low-precision warning. The rule says stable release at 4 or more and pivot at 2 or fewer, so 3 means **no stable release and no pivot: the project stays an alpha preview.** Every label comes from an LLM reviewer, none is confirmed by a person, and the sample is small, so this is weak evidence.

## Question

Are the findings a signal puts above the 0.7 display cut worth a person's time, on code the authors did not tune the questions on?

## Pre-registration

Frozen before any request was sent (the rule, the seed, the selection of repositories and the gate). The gate, as registered:

> Per signal, aggregating both repos, on the random sample above the display cut (0.7) with n >= 8 reviewed cells: actionable >= 50% and greater than the rate among the below-cut sample -> DEFAULT. 30-50% -> default with a low-precision warning. < 30% or n < 8 (low_n) -> experimental, off. Release v0.1 stable if >= 4 signals are DEFAULT; pivot to the evaluation-harness product if <= 2. Registered checks: if human-vs-Opus agreement on the 30 human cards is < 70%, every LLM number gets a "not human-confirmed" label; if |P1-P2| > 0.05 in more than 20% of the repeats, reports must show a range and the cut becomes "P above cut in two calls". The reviewer's labels decide the gate; the coordinator does not. unreachable_code is experimental: no gate applies unless it reaches n >= 8 anyway.

The release count (4 / 2) was registered, but what happens at exactly 3 was not. That gap is recorded in [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and in `evals/gate.json`, where exactly 3 now means "stay alpha". The change was made before any new labels exist, and the changed rule has a new published hash.

## Setup

- **Repositories** (public, MIT, chosen by a written rule from about 500 candidates; both are UI libraries/apps): [`paulrobello/claude-office` @ `3522c16`](https://github.com/paulrobello/claude-office/tree/3522c16399660ac787cd1f4ad4f3255352ec8e6c) (30,644 counted TypeScript lines) and [`reshaped-ui/reshaped` @ `cf7ac31`](https://github.com/reshaped-ui/reshaped/tree/cf7ac31a5aa91ea50ae2c5fd3bb3b420329adaf1) (22,114 lines).
- **What ran.** The prototype scanner this project was derived from (`0.4.1-exp`), with the same seven default questions at the same versions as this repository's catalog plus `unreachable_code` (experimental). **The release pipeline in this repository was not the code that ran**; the questions are the same, the surrounding code is older. Model `jev-1.13.0`, one pass per repository, no retries.
- **Cost.** 1,273 requests (1,223 main and 50 repeats), US$0.174 calculated from the published tariff, not an invoice, against a US$0.70 cap. The reviewer's cost is not included.

## Sampling

Per repository and signal, from the scored cells: a **random** sample of up to 8 cells at or above the cut (4 from 0.7 to 0.85 and 4 from 0.85 to 1, ordered by a hash with a frozen seed), and the **4 cells with the highest P just below the cut**. This is not the highest-P selection. Cards (one review context each) list only the signals they were sampled for, and no score, rank or membership is shown to the reviewer. A signal with fewer than 8 cells above the cut in a repository takes all of them. 145 cells were labeled.

## Labeling

An LLM reviewer (Claude Opus 5.5) labeled each cell `actionable`, `no_action` or `uncertain` with the fixed rubric in [`evals/judge/RUBRIC.md`](../judge/RUBRIC.md) ("actionable" means concrete evidence that a bounded improvement merits coding verification, not a confirmed bug). **Pass 1** saw only the cards and was sealed (hashed) before the reviewer had any repository access. **Pass 2** read the repositories at the pinned commits and is anchored on pass 1, so it is a check directed by pass 1 and not an independent measurement. Pass 1: 40 actionable, 105 no_action. Pass 2: 41 and 104; one label changed (`clone_same_policy` in `reshaped`, no_action to actionable).

## Results

Random above-cut sample, pass 1 (noise floor = 1/sqrt(n), in the table). "Near-below" is the 4 cells just under the cut per repository, both repositories pooled:

| Signal                               | Above cut: claude-office / reshaped | Both repos, pass 1 (noise floor) | Pass 2      | Near-below | Registered band                |
| ------------------------------------ | ----------------------------------- | -------------------------------- | ----------- | ---------- | ------------------------------ |
| `clone_same_policy`                  | 8/8 / 4/8                           | 12/16 (75%, ±25%)                | 13/16 (81%) | 2/8        | default                        |
| `function_should_split`              | 5/8 / 1/8                           | 6/16 (38%, ±25%)                 | 6/16 (38%)  | 2/8        | default, low-precision warning |
| `function_multiple_responsibilities` | 3/8 / 0/0                           | 3/8 (38%, ±35%)                  | 3/8 (38%)   | 2/8        | default, low-precision warning |
| `internal_duplication`               | 3/8 / 1/8                           | 4/16 (25%, ±25%)                 | 4/16 (25%)  | 1/8        | experimental                   |
| `magic_policy_literal`               | 3/8 / 0/8                           | 3/16 (19%, ±25%)                 | 3/16 (19%)  | 0/8        | experimental                   |
| `unused_local_or_parameter`          | 1/6 / 0/3                           | 1/9 (11%, ±33%)                  | 1/9 (11%)   | 2/8        | experimental                   |
| `deep_nesting`                       | 0/0 / 0/0                           | no cells                         | no cells    | 2/8        | experimental                   |
| `unreachable_code`                   | 0/0 / 0/0                           | no cells                         | no cells    | 0/8        | experimental                   |

- `deep_nesting` and `unreachable_code` produced no scored cells above the 0.7 cut in either repository, so they have no sample, and `function_multiple_responsibilities` and `unused_local_or_parameter` produced very few. More cards from these repositories would not fix that; more repositories would.
- The two repositories disagree on two of the three default signals: `clone_same_policy` was 8/8 in `claude-office` and 4/8 in `reshaped`, and `function_should_split` was 5/8 against 1/8.
- Only `clone_same_policy` clears 50%, and its Wilson 95% interval is 57-93% (pass 2: 13/16). `function_multiple_responsibilities` reaches n = 8 only through one repository.
- `unreachable_code` is experimental by registration and outside the gate.

## Repeat variance (registered check)

50 requests were re-sent byte-identically. 9 of 235 cells (3.8%) moved by more than 0.05 (maximum 0.09), one chosen option flipped, and one cell crossed the 0.7 cut. 18% of the repeated requests had at least one such cell, under the registered 20% line, so no range was required. Treat 0.7 as a display setting, not a calibrated threshold.

## Agreement with a second LLM

A second, independent LLM reviewer labeled 39 of the same cells from the cards only. The two reviewers agree on 33 of 39 (85%; Wilson 95% 70-93%; Cohen's kappa 0.67). Per-signal kappas rest on 1 to 8 cells and are not reliable. The second reviewer labeled `function_should_split` actionable on 0 of 8 cells where the first did on 3. **Two LLMs agreeing is not the human calibration this project requires** (at least 90% agreement with a person on at least 20 clear cases), and the judge calibration check reports "not calibrated" for two reasons: the reference labels are not from a person, and 85% is under 90%.

## Limits

- **No human labels.** The 30-card human subset exists and is unlabeled, so the registered check "agreement with people under 70% means every LLM number is marked not human-confirmed" cannot be run. The label applies to everything here.
- Small n (6 to 16 cells per signal), two repositories of one kind (UI code), one reviewer model, one scan per repository.
- The pipeline that ran is the prototype's, not this repository's release code.
- Under [`evals/gate.json`](../gate.json), which requires labels from a person or a calibrated judge, **every signal remains experimental** until one of those exists.
- The labeled cards contain excerpts of the two public repositories and are not included here.

## What would change this

Labels from a person on the 30 human cards (which would also allow a calibrated judge), and a second round on more repositories of different kinds with the exactly-3 rule already in place.
