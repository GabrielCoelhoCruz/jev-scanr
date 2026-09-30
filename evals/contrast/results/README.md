# Live run 1: constructed contrast

Run on 2026-09-30 with `run.mjs`: 300 requests, one question each, one pass, no retries, concurrency 1, model `jev-1.13.0` on every response, cap US$0.50. All 300 succeeded. Provider-reported input: 407,289 tokens, calculated US$0.0171 at US$0.042 per million (not an invoice). The receipt estimated 344,702 tokens (bytes divided by 3), so that estimate ran 15% low; the worst-case bound (US$0.046) held. `live-1/journal.jsonl` holds every answer, `requests.json` the receipt and request hashes, `result.json` and `result.md` the analysis (`analyze.mjs`, rules fixed in `../README.md` before the run).

## Result

| Set                                                                                  | Jev AUC (95% interval) | Matched heuristic AUC                       | Difference                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| A `function_should_split`, chimeras against length-matched functions                 | 0.81 (0.72 to 0.89)    | lines 0.50 (0.38 to 0.61)                   | +0.31 (0.21 to 0.41)                                                         |
| B `clone_same_policy`, rewritten copies against different functions, overlap matched | 1.00 (0.99 to 1.00)    | scanner shingle overlap 0.50 (0.38 to 0.61) | +0.50 (0.39 to 0.61); against vocabulary overlap (0.68) +0.31 (0.21 to 0.43) |
| C `name_vs_behavior`, candidate signal, renamed against original                     | 0.97 (0.94 to 0.99)    | lines 0.50 (tied by construction)           | +0.47 (0.44 to 0.49)                                                         |

On all three sets Jev ranks the constructed positives above the controls where the matched free feature is at chance. This is the first evidence in this project that Jev's P carries information that function length and token overlap do not.

What the number hides:

- **Rates at the cut are low where recall matters.** Set A: 16% of chimeras reach P 0.7 (2% of controls). Set C: 38% of renamed functions (0% of originals). Only B is sharp: 98% against 4%. Jev ranks well but, at the default cut, misses most A and C positives. Mean P for A positives is 0.39.
- **Paired view, C:** the renamed function scored higher than its untouched twin in 49 of 50 pairs (mean difference 0.51).

## Reading limits (hypotheses, not conclusions)

1. **Constructed positives are easier than real ones.** A chimera has two unrelated halves; a real function that should split rarely does. B positives are the same function twice. These results show Jev can tell a planted contrast. They do not show it finds the cases people want refactored.
2. **B is not isolated from every lexical cue.** Only scanner shingle overlap is matched. Vocabulary overlap (0.68) and size ratio (0.69) still separate the classes, and I did not measure others a rewritten copy keeps: identical string literals, property names, type annotations and call sequences. An AUC of 1.00 is far above the 0.68 of the best measured leak, but a cue I did not measure could account for part of it. A natural next check is a third B control: a pair of different functions that share string literals and property names.
3. **Set A cues.** The chimera leaves a local that is assigned and never used (`<name>Result`), and concatenated parameters (params AUC 0.56). Neither is matched. Jev may partly be reading the seam's oddities. A rerun where the first half's result is consumed by the second would test that.
4. **Set C** shows Jev registers a mismatched name. The donor names were spot-checked by name only. Controls were never flagged (0 of 50 at the cut), so the false-alarm rate on untouched real code is low here, but only 50 functions with zero name-word overlap were tried, about 9% of eligible ones.
5. **Noise.** One pass, rounded P, and the TypeSafe self-consistency note below. No variance rerun was made.
6. **n.** 50 and 50 per set. Intervals are wide for differences under about 0.15; the observed gaps are well above that.

## Context found while building this (leads from the Jev ecosystem site, checked against the pages)

- **Escape options.** All eight catalog signals and the candidate signal offer an `insufficient` option. The warning that a Choice question without one is answered with confidence 1.00 does not apply to any question in this run.
- **Near-0.5 noise.** The "Jev as a judge" guide reports one insurance-claim example, 15 repeats of a 14-question rubric: mean per-question sd 0.0102, yet answers to one question ranged 0.43 to 0.53, across 0.5. The guide itself calls it a single-example test by TypeSafe. The default floor of the "uncertain" band is 0.5, so cells near it can switch bands between calls. That argues for a wider uncertain band or a two-call rule, as `evals/` already registers for variance. This run's AUCs do not depend on a cut.
- **Perch benchmark** (`perchscan/benchmark-results` on Hugging Face). It pairs a method before and after a real transactional change plus benign reference methods, scores each side without the patch, and targets bugs and security issues. The shape resembles ours (paired, unseen patch), but its labels are real commits, the tasks are bug and security detection rather than split or clone, and its page states no license I could read, so I did not reuse it. It reports Jev's "pair order" at 42.5% (bug) and 40.5% (security), below 50%, on a different task; nothing here confirms or contradicts that. Our design differs in that the change is mechanical and the heuristic's own feature is matched.

# Live run 2: follow-up controls

Run on 2026-09-30 after live-1, with `run.mjs --units controls.json`: 192 requests, one pass, no retries, concurrency 1, every response from `jev-1.13.0`, cap US$0.50. All 192 succeeded. Provider-reported input 278,929 tokens, calculated US$0.0117 (the receipt estimated 240,116 tokens; live-1's 18% undercount predicted about 285,000). Files in `live-2/`: `journal.jsonl`, `requests.json`, `result.json` and `result.md` (analysis per the rules in `../README.md`, "Follow-up controls", written before the run), `retest.json`.

| Set                                                                                                 | Jev AUC (95% interval) | Matched / leaking feature AUC                             | Difference                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| A2, chimeras whose second half consumes the first half's result (46 + 46)                           | 0.76 (0.66 to 0.85)    | lines 0.50 (0.38 to 0.62)                                 | +0.26 (0.16 to 0.37)                                                        |
| B2, rewritten copies against negatives that share literals, property names and type names (50 + 50) | 0.98 (0.95 to 1.00)    | scanner overlap 0.56; surface overlap 0.79 (0.71 to 0.86) | +0.42 against scanner overlap; +0.19 (0.12 to 0.27) against surface overlap |

## Reading, against the rules fixed beforehand

- **A2.** The rule said: if Jev stays within the A interval of live-1 (0.72 to 0.89), the dangling local was not what Jev read. 0.76 is inside it. It is lower than live-1 A on the same 46 pairs (0.81, computed from the stored answers), and the same chimeras scored 0.05 lower on average once the result was consumed (20 of 46 down by more than 0.05, 6 up). So the dangling local may have added some signal, but most of the separation remains without it. At the 0.7 cut, 13% of the consumed chimeras fire (live-1: 16%), against 2% of controls. Hypothesis, not a measurement of the cause.
- **B2.** The rule said: a value above the lower end of the B interval (0.99) makes the surface cue unlikely to explain B, a fall toward the surface-overlap AUC (0.79) means Jev tracks surface, between is partial. 0.98 is 0.01 under that line, and its interval (0.95 to 1.00) overlaps B's. By the letter that is "between". It is far from 0.79, and among negatives Jev's P did not rise with surface overlap: the 28 hard negatives (surface overlap at least 0.8) average P 0.26, the 22 others 0.30. The positives are the same 50 texts as in B, and their P barely moved. The mean P of controls rose from 0.17 (B) to 0.28, so the harder negatives did cost some separation.
- **Hard negatives.** 4 of 28 reach the 0.7 cut. The top scorers are `normalizedImageUrl` and `explicitFaviconUrl` (P 0.96), `formatLocalTimestamp` and `formatDateWithLocalOffset` (0.95), `mapWithConcurrency` and `mapPool` (0.85), `PinFieldUncontrolled` and `TabsUncontrolled` (0.75). At least the first three look like real same-operation pairs written twice, so I do not count them as errors. Nobody has verified that, and a human read of these pairs is the obvious next step.
- **Test-retest.** 96 units have identical text in live-1 and live-2 (46 untouched controls of A, 50 copies of B). Mean absolute change in P 0.011, largest 0.06, 5 changed by more than 0.05, correlation 0.96 (B2) to 0.995 (A2), no choice flips and no crossing of 0.5 or 0.7. That is small next to the 0.43 to 0.53 spread the TypeSafe guide reports for one borderline question, so near-0.5 flips were not seen here. The two runs were about an hour apart and used the same requests; this does not cover days, other prompts or borderline cells.

Limits that stand from live-1: constructed positives are easier than real candidates; A2 still has the concatenated-parameters cue (params AUC 0.56); B2 does not match surface overlap (0.79), it only narrows the gap; no human read of the units.
