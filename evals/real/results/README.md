# Live run 3: Jev on the random real-code sample

Run on 2026-09-30 with `../contrast/run.mjs --units evals/real/units.json`: 400 requests, one question each, one pass, no retries, concurrency 1, stop on first error, cap US$0.15. All 400 succeeded on `jev-1.13.0`. Provider-reported input 502,760 tokens, calculated US$0.0211 (estimate 433,572; earlier runs predicted about 512,000). Files in `live-3/`: `journal.jsonl`, `requests.json`, `result.json`, `result.md`. The labels existed before any request; the analysis rules are in `../README.md`.

## Pre-registered outcome

**No conclusion.** Every primary view has fewer than 15 positives (0 under agreement-only, 0 under claude, 5 under gpt). This run does not show whether Jev ranks mismatched names better than function length does. Nothing below changes that.

## Descriptive readout

No person has read these functions or these labels. The two labelers are models.

- **Alert rate on ordinary code.** Jev put **0 of 400** functions at or above the default cut 0.7. Two reach 0.5 (0.60 and 0.50) and nine reach 0.3. Median P is 0.01, mean 0.027. Jev's chosen option was `name_fits` for 399 of 400 units. In this sample, on code both readers found almost entirely well named, the default cut raised no false alarm; it also flagged nothing a reader called mismatched, so its recall here is 0 of 5 for the GPT mismatches.
- **Highest P.** The top unit, `openNumberContextMenu` (t3code, 12 lines, P 0.60), was labeled `fits` by both readers. The next is `transformDefinition` (reshaped, P 0.50), called `imprecise` by both.
- **Where the 16 functions a reader called imprecise or mismatched land.** Counting only units strictly above a P value, so ties are not split: 3 of the 9 units above P 0.29, 6 of the 22 above 0.11, 7 of the 48 above 0.04. A random draw would put about 0.4, 0.9 and 1.9 there (16 of 400 is 4%). The other 9 of the 16 have P between 0.00 and 0.03. Mean P is 0.119 for those 16 and 0.023 for the rest.
- **Not pre-registered, exploratory, n = 16:** counting a function as positive when either labeler called it mismatched or imprecise gives AUC 0.75 for Jev's P, 0.37 for lines and 0.59 for `nameMissing`. The grouping was chosen after seeing the data, the group is 16 functions, and the labels include 11 that only one labeler flagged. The pre-registered lenient view (first labeler only, 9 positives) gives Jev 0.79 (0.66 to 0.93), lines 0.41, `nameMissing` 0.59, Jev minus `nameMissing` 0.21 (-0.03 to 0.47). Both are consistent with P carrying some signal for what readers find imprecise and lines carrying none, and neither is enough to say so.
- **Per length band.** Mean P falls with length: 0.046 (5 to 9 lines), 0.029, 0.021, 0.011 (40 to 100). The short functions are where Jev is least sure and where the top units sit.

## Limits

- The alert-rate reading depends on the sample being well named. It says that on this code the cut 0.7 stays quiet; it does not say what the cut does when names are wrong. The constructed set C (`../../contrast/results/README.md`) is the only place mismatched names appear, and there 38% of renamed functions reached 0.7.
- Five GPT mismatches and nine more imprecise cases are too few to estimate recall. The real rate of misnamed functions is about 1% on this sample by either reader.
- Two model labelers, no human reading, one pass, one day.
