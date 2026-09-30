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

A signal is on by default only if it passes a written gate ([`CONTRIBUTING.md`](CONTRIBUTING.md)). The seven current defaults passed the _alpha_ gate on one project. The stable gate is stricter, and none of them has passed it yet:

- **Next experiment (planned, pre-registered):** two new public MIT TypeScript repositories that nobody on this project has used, a random sample above the cut (not the top-5), four cells just below the cut, 50 repeated requests to measure how much P moves, a fresh LLM reviewer, and 30 cards labeled by a person.
- **Stable release if at least 4 signals reach 50% actionable** on the random above-cut sample with n ≥ 8. **If 2 or fewer do,** the useful part of this work is the evaluation protocol (frozen rules, sealed labels, a blind join), and this scanner becomes its example.
- If people agree with the reviewer on fewer than 70% of the human-labeled cards, every number in this file gets a "not human-confirmed" label.

Everything above is reproducible from the questions in `signals/`, the frozen sampling and join rules, and the labels, which we plan to publish with the results.
