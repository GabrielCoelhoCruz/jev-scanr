# Evidence

What we measured, how, and what it does and does not show. Every number below comes from one project, one Jev model version and one LLM reviewer. None of it is human truth. Where a number could mislead, we say so next to it.

## 1. Where the seven signals come from

The scanner started as a prototype with **22 questions** ("signals") across five unit types: functions, similar pairs, catch blocks, sibling functions and comment blocks. One live pass ran on the sanitized daily-tracker project (a TypeScript / React Native app: 170 source files, about 32,000 lines):

- 884 requests, 7,915 questions, `jev-1.13.0`, US$0.168 calculated from the tariff and returned token counts (not an invoice).
- 473 cells came out at or above the 0.7 display cut.
- One LLM reviewer (Claude Opus 5.5) labeled a sample of cells `actionable` / `no_action` / `uncertain` in two passes: first from the request context alone, then again with read access to the repository. The rubric is fixed text: _actionable_ means concrete evidence that a bounded improvement merits coding verification, and it is not a confirmed bug. The pass-1 labels were sealed (hashed) before any repository access. Pass 2 is anchored on pass 1, so it is not an independent judgment.
- The sample per signal: the **5 highest-probability cells at or above the cut**, plus 3 random cells below it. A rule frozen before the labels was used to join labels to cells.

**Result of the join.** With a rule written down before the join (keep if at least 2 of the top-5 cells were actionable and the top rate beat the below-cut rate; drop if none was), **7 signals kept, 1 needed its question fixed, 14 dropped**:

|            | Signals | Top cells reviewed | Actionable | Rate |
| ---------- | ------: | -----------------: | ---------: | ---: |
| Kept       |       7 |                 29 |         21 |  72% |
| All others |      15 |                 41 |          1 |   2% |

Below the cut, **0 of 64** random cells were actionable, for every signal. The per-signal numbers are in each `signals/*.json` file (`evidence`) and in [`signals/retired.md`](signals/retired.md).

**The clearest case.** `clone_behavior_difference` marked 183 of 195 similar pairs at or above the cut, and 0 of the 5 reviewed were actionable. The reviewer found style variants and identical bodies. The 14 dropped signals produced 255 of the 473 items above the cut. That is more than half the report, and it came from questions that did not work. Cutting the questions removed that noise. Swapping the model did not.

### Case study: a real run on one app

The prototype run behind these numbers was on the author's own app, [`GabrielCoelhoCruz/daily-tracker`](https://github.com/GabrielCoelhoCruz/daily-tracker) at commit `6b8e9d08767e0364f78ccdf763ea654429cf5fc8` (a React Native / Expo app). A sanitized copy was scanned, with two files withheld. The run put 473 cells at or above the cut. One of them shows what a useful item looks like, and what it takes to confirm one.

`buildMetrics` in `components/history/HistoryMetricsGrid.tsx` (lines 23–79) came out at P=0.99 for `magic_policy_literal`. It colours a weekly score with two bare thresholds:

```ts
const averageColor =
  review.averageScore != null && review.averageScore >= 75
    ? theme.colors.semantic.success
    : review.averageScore != null && review.averageScore >= 50
      ? theme.colors.accent.DEFAULT
```

The reviewer's first pass, from the request context alone, said `uncertain`: it could not tell whether a shared constant or helper already existed. With repository access it changed to `actionable`. On the same History screen, `WeeklyReviewCard` colours the same score at 90 / 75 / 50, and a helper, `getExecutionScoreTone`, already encodes 90 / 75 / 50. So the 75 / 50 bands are a real inconsistency, and the refactor is to use the helper. The item alone only said "unexplained literals". Confirming it took reading the repository, which is what the queue asks you or your agent to do. Nobody has confirmed this as a bug, and the app was not changed by this project.

## 2. What these numbers do not show

- **The 72% is an upper bound.** Reviewed cells are the _highest_-probability ones. For `magic_policy_literal` (72 cells above the cut) and `internal_duplication` (74), only 5 each were reviewed. Nothing is known about the other 67 and 69.
- **Small n.** `deep_nesting` rests on 2 cells, `unused_local_or_parameter` on 3, `function_multiple_responsibilities` on 4, `unreachable_code` on 1. One label moves a verdict.
- **One reviewer, one model family, no human labels.** Claude Opus 5.5 labeled every cell. No person has labeled any. Agreement with the reviewer is agreement with a model.
- **One project, the author's own.** A single React Native app. That is the only corpus with positive multi-signal evidence.
- **The below-cut sample says little about the cut.** 0 of 64 is consistent with a good cut, but most below-cut cells sit far under 0.7. Random draws rarely land near the boundary, and we did not test what lies just below it.
- **P is not stable.** Jev's probabilities are rounded to two decimals, and the one request we had to send twice returned a different distribution the second time. We have not measured the variance; treat 0.7 as a display setting, not a calibrated threshold. When a chosen option is within 0.01 of another, the report flags a `near tie`.
- **The measured requests carried 22 questions; this release sends 7 or 8.** The question text is identical, but each request is now smaller, so for some units the byte-budget trimming keeps more context (on the daily-tracker snapshot, 47 of 686 unsplit units differ, and none has less), and similar pairs are asked one question instead of three. We have not re-measured Jev's answers on the new requests, so the probabilities may differ from the ones behind these numbers.
- **Validation does not carry over between question versions or corpora.** An earlier prototype question about narrating comments scored 19 of 20 on one project (with a different answer type) and 0 of 5 on this one. Each catalog entry carries its own evidence, and a rewritten question starts with none.

## 3. The test on independent repositories, and why it failed

Before this design, an earlier version was tried on two independent public repositories (`ArcaneWizards/open-source`, a show-control monorepo, and `Borodin/typescript-telegram-bot-api`, an API client). That test asked a different question: does Jev, used to _rerank_ candidates chosen by deterministic rules, beat the deterministic ranking? A pre-registered gate said yes only if it gained at least 10 points pooled and lost nothing on either repository.

It **failed**. At K = 10 over both repositories, Jev had 5 of 93 actionable slots and the deterministic ranking had 9 of 93. Positives were very sparse: 10 actionable cells out of 179 reviewed.

Why, as far as the review showed:

- The two strongest candidates the reviewer found sat in packages whose source had been cut off by the request byte limit, so the model never saw them. The current pipeline no longer drops focus source.
- One unresolved helper (`callApi`) explained 16 of 38 "uncertain" labels, which one more step of `this.*` resolution would have resolved. That is still not implemented.
- Some behavior lived in native (`.cpp`/`.mm`) files outside TypeScript resolution.

That test measured reranking, and this tool no longer reranks. **The jev-only pipeline in this repository has not been run on those independent repositories.** Nothing here says it would do better or worse there.

## 4. What would change our minds, and what comes next

A signal is on by default only if it passes a written gate ([`CONTRIBUTING.md`](CONTRIBUTING.md)). The seven current defaults passed the _alpha_ gate on one project. The stable gate is stricter, and none of them has passed it with labels from a person:

- **The first run of this experiment** is reported in section 5. It reached 3 default signals, and labels from a person are still missing. **The design was:** two new public MIT TypeScript repositories that nobody on this project has used, a random sample above the cut (not the top-5), four cells just below the cut, 50 repeated requests to measure how much P moves, a fresh LLM reviewer, and 30 cards labeled by a person.
- **Stable release if at least 4 signals are default** (50% actionable, or 30-50% with the low-precision label) on the random above-cut sample with n ≥ 8. **If 2 or fewer do,** the useful part of this work is the evaluation protocol (frozen rules, sealed labels, a blind join), and this scanner becomes its example.
- If people agree with the reviewer on fewer than 70% of the human-labeled cards, every number in this file gets a "not human-confirmed" label.

Everything above is reproducible from the questions in `signals/`, the frozen sampling and join rules, and the labels, which we plan to publish with the results.

## 5. Result of the pre-registered independent test (LLM labels only)

Section 4 described this experiment as planned. It has now run on `paulrobello/claude-office` and `reshaped-ui/reshaped`, with the sampling, the join and the gate frozen before any label existed. A fresh Opus reviewer labeled all 145 sampled cells from the cards alone (pass 1, sealed before it had repository access), then again with repository access (pass 2). **No person has labeled anything yet, so every number below is "not human-confirmed".**

Random sample above the 0.7 cut, both repositories pooled, pass 1 (pass 2 differs in one cell, `clone_same_policy` in `reshaped`, and changes no verdict):

| Signal                               | Actionable above cut | Below the cut (4 nearest per repo) | Registered verdict             |
| ------------------------------------ | -------------------- | ---------------------------------- | ------------------------------ |
| `clone_same_policy`                  | 12/16 (75%)          | 2/8 (25%)                          | default                        |
| `function_should_split`              | 6/16 (38%)           | 2/8 (25%)                          | default, low-precision warning |
| `function_multiple_responsibilities` | 3/8 (38%)            | 2/8 (25%)                          | default, low-precision warning |
| `internal_duplication`               | 4/16 (25%)           | 1/8 (13%)                          | experimental                   |
| `magic_policy_literal`               | 3/16 (19%)           | 0/8 (0%)                           | experimental                   |
| `unused_local_or_parameter`          | 1/9 (11%)            | 2/8 (25%)                          | experimental                   |
| `deep_nesting`                       | 0 cells              | 2/8 (25%)                          | experimental (n < 8)           |
| `unreachable_code`                   | 0 cells              | 0/8                                | experimental, outside the gate |

- **Outcome of the registered gate:** 3 of 7 signals passed a gate whose bands include low-precision defaults. Only `clone_same_policy` cleared 50%; `function_should_split` and `function_multiple_responsibilities` are in the 30-50% band. The two repositories disagree on two of the three (`clone_same_policy` is 8/8 in one and 4/8 in the other; `function_should_split` is 5/8 against 1/8). Nothing is human-confirmed. The release rule says stable at 4 or more and pivot at 2 or fewer, and it did not say what happens at exactly 3. **So v0.1 is not declared stable: it stays an alpha preview.** For the alpha, `clone_same_policy` is on by default, `function_should_split` and `function_multiple_responsibilities` are on by default with the low-precision warning, and every other signal is experimental and opt-in. If only signals at 50% or above counted, the count would be 1; we did not read the rule that way, because the registered text calls the 30-50% band "default with a low-precision warning".
- **Sample sizes are small.** The noise floor 1/sqrt(n) is 25% for n = 16 and 35% for n = 8. Only `clone_same_policy` clears the 50% bar, and its Wilson 95% interval is 57-93% (pass 2: 13/16). `function_multiple_responsibilities` reached n = 8 only on one repository, and `deep_nesting` and `unreachable_code` had no scored cells above the cut.
- **Repeat variance:** in 9 of 235 repeated cells (3.8%) P moved by more than 0.05, and 18% of the 50 repeated requests had at least one such cell. That is under the registered 20% line, so no range is required.
- **Agreement with a second LLM:** on the 39 cells both reviewers labeled, HOME-16 pass 1 and the HOME-17 labeler agree on 33 (85%, Cohen's kappa 0.67). Per signal the counts are small (1 to 8 cells), so the per-signal kappas (0.00 to 1.00) are not reliable. All 6 disagreements: HOME-16 said actionable and HOME-17 said no_action on `clone_same_policy` (1) and `function_should_split` (3), and the reverse on `magic_policy_literal` (1) and `internal_duplication` (1).
- **What this does not show:** two language models agreeing is not the human calibration this project requires (at least 90% agreement with a person). Under `evals/gate.json` (labels must come from a person or a calibrated judge) every signal stays experimental, and the 30 human-labeled cards are still unlabeled. The check "agreement with people under 70% means label everything not human-confirmed" cannot be run without them, so the label applies by default.

**Lesson and fix.** A pre-registered rule needs a written outcome for every count, including the one in the middle. The gate now has one (`evals/gate.json`, `release`: exactly 3 means stay alpha), added before any new labels exist, and the changed rule has a new hash in `CONTRIBUTING.md`. We also fixed a labeling trap: a file in the human-labels format can no longer be loaded as human unless it says `"labelerKind": "human"`, so the second reviewer's LLM labels cannot be counted as a person's.

Inputs are pinned by hash in `handoffs/HOME-7-validation-gate/` (labels, cards, receipt); the private sample key is kept out of the repository and identified only by its hash (`82f2316c...8fd3`).
