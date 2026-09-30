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
