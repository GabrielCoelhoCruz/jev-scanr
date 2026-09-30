# Constructed contrast: does Jev read code, or count it?

The [free baseline](../../docs/BASELINE.md) found that function length ranks the LLM-labeled cells about as well as Jev's P. Those cells were picked by Jev's own P and labeled by an LLM, so the test could not separate judgment from length. This evaluation removes both problems. The ground truth comes from a mechanical change to real code, not from a labeler, and the free heuristic's own feature is matched between the classes. A score that beats chance here has to come from something other than that feature.

Status: a hypothesis test, not a verdict on Jev. Every finding is a hypothesis about these 300 constructed units. The one live run (2026-09-30, 300 requests, calculated US$0.0171) is in [`results/live-1/`](results/live-1/) with its reading in [`results/README.md`](results/README.md).

## The three sets

Each set has 50 positives and 50 controls, built from functions in the four public repositories already used by the baseline, at the pinned commits in `units.json`. Every unit is an excerpt that parses alone: one function (or one pair), no imports, no callers, an opaque path. Controls and positives go through the same path, so context cannot differ.

| Set | Signal                                             | Positive (label 1)                                                                                             | Control (label 0)                                                                                                                       | Matched free heuristic              |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| A   | `function_should_split`                            | Two unrelated real functions concatenated into one function. The seam is known (`recipe.seamLine`).            | An untouched real function of the same repository, nearest in lines, then tokens and parameters.                                        | lines                               |
| B   | `clone_same_policy`                                | A function and a mechanical rewrite of itself, with scanner token overlap pushed under the 0.45 retrieval cut. | Two different functions of the same repository and extension, matched to a positive on overlap, size, vocabulary and raw-token overlap. | scanner shingle Jaccard             |
| C   | `name_vs_behavior` (candidate, not in the catalog) | A function renamed to the name of another function in the same repository.                                     | The same function untouched (a minimal pair).                                                                                           | lines; name words found in the body |

`signals/name_vs_behavior.json` holds the set C question. It is not in `signals/` or `catalog.json`, so the catalog hash and every recorded plan stay as they are.

How the units are built:

- **A.** Parts are functions of 6 to 35 lines with no `this`, no recursion and, for the first part, no return except the last statement (it becomes a local). The two parts come from different files, preferably different directories, with no shared name words and low vocabulary overlap. Parameters are concatenated; the chimera is async if either part is. It keeps the first part's name and drops return types. Declared locals of one part may not appear anywhere in the other.
- **B.** Passes run in this order: rename locals to generic words, swap independent adjacent pure declarations, reverse plain parameters, toggle quote style, then, in random order, toggle semicolons, braces, trailing commas, arrow parentheses and bodies, callback form, template literals to concatenation, `true`/`undefined` to `!0`/`void 0`, `const` to `let`, `i++` to `+= 1`, swap if/else branches under a negated test, and parenthesize returns, stopping at a random target between 0.15 and 0.35 overlap. The copy also gets the name of another function of the repository. Negatives come from all same-repository, same-extension pairs in the 0.10 to 0.45 overlap band and are chosen by nearest distance on overlap, vocabulary overlap, size and two raw-token overlaps. Both members of every pair, and every source function, are used once.
- **C.** The candidate set keeps only functions whose name words do not appear anywhere in their own body, and renames to a donor name whose words appear neither in that body nor in the original name, with the same capitalization and `use` prefix. The free lexical cue ("the name's words occur in the body") is therefore zero for both classes.

Paths inside a set are `u/<8 hex>.<ext>` or `u/<8 hex>/a|b.<ext>`. Nothing in a path or an id says which class a unit is in. In B the order of the two members is random.

## What matching buys, measured

`node evals/contrast/analyze.mjs --balance` prints each cheap feature's AUC against the label, with no Jev data involved (95% bootstrap intervals, 2000 resamples):

| Set | Feature                                                                     | AUC of the feature alone                 | Matched              |
| --- | --------------------------------------------------------------------------- | ---------------------------------------- | -------------------- |
| A   | lines                                                                       | 0.50 (0.38 to 0.61)                      | yes, by construction |
| A   | statements                                                                  | 0.50 (0.38 to 0.62)                      | no                   |
| A   | cyclomatic                                                                  | 0.51 (0.40 to 0.62)                      | no                   |
| A   | params                                                                      | 0.56 (0.46 to 0.68)                      | no                   |
| A   | tokens                                                                      | 0.50 (0.39 to 0.62)                      | no                   |
| B   | shingleJaccard                                                              | 0.50 (0.38 to 0.61)                      | yes, by construction |
| B   | tokenCoverage10 (the baseline's main clone heuristic)                       | 0.49 (0.38 to 0.60)                      | no                   |
| B   | rawJaccard5                                                                 | 0.39 (0.28 to 0.50)                      | no                   |
| B   | vocabJaccard                                                                | 0.68 (0.57 to 0.78)                      | no                   |
| B   | sizeRatio                                                                   | 0.69 (0.58 to 0.79)                      | no                   |
| B   | minLines, minTokens                                                         | 0.48 (0.38 to 0.59), 0.57 (0.46 to 0.68) | no                   |
| C   | lines, statements, cyclomatic, params, tokens, name words missing from body | 0.50 (all tied)                          | yes                  |

Two features in B are not matched and separate the classes: vocabulary overlap (names of callees, properties and imports, locals excluded) and size ratio. A copy of a function keeps every name it does not declare itself, and the supply of different-function pairs with high vocabulary overlap and low token-shape overlap is small. Read Jev's B result against `vocabJaccard` too; the analyzer reports that comparison (`diffSecondary`).

## Analysis, fixed before the live run

Committed before any request was sent (see the commit history of this folder).

- **Score.** P of the signal's positive option from the stored answer, whatever option won. Answers that chose `insufficient` still have a P and are kept; a sensitivity view drops them. The baseline dropped them, so the two studies differ on this point.
- **AUC** of P against the label, per set, with 95% percentile bootstrap intervals (2000 resamples, seed 20260930). Set C resamples the 50 pairs, not the 100 units.
- **A set counts as matched** if the interval of the matched heuristic's AUC contains 0.5. If it does not, the set is reported as UNMATCHED and Jev is read only against that number.
- **Jev separates the classes** if the lower end of its interval is above 0.5.
- **Jev ahead of the matched heuristic** if the interval of AUC(Jev) minus AUC(heuristic), on the same resamples, is above 0. Behind if it is below 0. Otherwise "no detectable difference".
- **Secondary comparison, B only:** the same difference against `vocabJaccard`.
- **Set C also reports** the paired view: mean P(renamed) minus P(original) over the 50 pairs, and a two-sided sign test.
- No heuristic is chosen after seeing the answers. Every feature in `units.json` is reported.

With 50 and 50 units an AUC difference under roughly 0.15 cannot be detected. A null result is "no detectable difference", not "equal".

## Follow-up controls (prepared, not run)

Two objections to live-1 (see `results/README.md`) get their own sets in `controls.json`, built by `build-controls.mjs` from the same pinned repositories and the same seed. They were prepared offline and need a separate go-ahead for a paid run.

- **A2, consumed result.** The 46 chimeras of A whose first half yields a value, with the second half changed to use it: `return [xResult, <expr>]`, or `return xResult;` when the second half returns nothing. No dangling local remains. Chimeras whose second half has returns before its last statement are dropped, because appending a return would leave unreachable code (4 of 50 dropped, 46 remain, with their 46 controls). Controls are the same untouched functions as in A and are asked again, which also gives a test-retest read of Jev on identical inputs (`reuses` points at the `units.json` unit with the same text).
- **B2, surface-matched negatives.** The 50 rewritten copies of B, asked again, against 50 new pairs of different functions chosen to share string literals, property names and type names as a copy does (`surfaceJaccard`), together with scanner overlap, vocabulary, size and raw-token overlap.

Measured before any request (`node evals/contrast/analyze.mjs --units evals/contrast/controls.json --balance`): in A2 length is matched (AUC 0.50, 0.38 to 0.62) and params still leaks (0.56). In B2 scanner overlap reads 0.56 (0.44 to 0.67), but **surface overlap is not matched: 0.79 (0.71 to 0.86)**, and vocabulary 0.71, size ratio 0.67. Natural pairs of different functions rarely share as much surface as a copy does, so B2 narrows the gap (vocabulary 0.68 in B) without closing it. Some high-surface negatives are near-duplicates that could truly share a policy (for example two URL normalizers), so a high P on them is not automatically an error; the analyzer reports them as "hard negatives" (surface overlap at least 0.8) separately.

Rules for reading them, fixed before the run:

- A2: if Jev's AUC stays within the live-1 interval of A (0.72 to 0.89), the dangling local was not what Jev read. If it drops to the interval of a chance-level score, it was.
- B2: if Jev's AUC stays above the lower end of the B interval (0.99) the surface cue is unlikely to explain B. A fall toward the surface-overlap AUC (0.79) means Jev tracks surface overlap at least in part. Any value between is reported as partial. The secondary comparison is `surfaceJaccard`.
- The retest pairs report the mean absolute change in P between identical inputs in live-1 and the follow-up.
- Run with `run.mjs --units controls.json --project PROJECT_CONTROLS`, same caps as live-1. Receipt: 192 requests, 240,116 estimated input tokens (bytes/3; live-1 ran 18% above that, so expect about 285,000), calculated US$0.010 to 0.012, worst case US$0.033, cap US$0.50.

## Attribution

The units are derived from functions in four public repositories, each under the MIT license. `units.json` stores paths, line ranges, hashes and numbers, not their source; the excerpts are regenerated from the pinned commits by `build.mjs`. Generated units combine, rewrite or rename those functions, and the code a live run sends is that regenerated text.

| Repository                                                                | License (copyright line)       | Pinned commit                              |
| ------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| [reshaped-ui/reshaped](https://github.com/reshaped-ui/reshaped)           | MIT (Reshaped)                 | `cf7ac31a5aa91ea50ae2c5fd3bb3b420329adaf1` |
| [paulrobello/claude-office](https://github.com/paulrobello/claude-office) | MIT (Paul Robello)             | `3522c16399660ac787cd1f4ad4f3255352ec8e6c` |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code)                   | MIT (T3 Tools Inc.)            | `0fcd5f90611451cca842689faea53b5450c022da` |
| [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)                   | MIT (Mario Zechner; Can Bölük) | `2b023d1b80133c523d66412602d99b5427408395` |

## Files

| File                            | What it is                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `units.json`                    | The 300 units: ids, hashes, source ranges, recipes, numeric features. No source text.                                                                                                               |
| `build.mjs`                     | Deterministic generator (seed 20260930). Needs the four repositories at the pinned commits. `--check` rebuilds and compares.                                                                        |
| `lib/`                          | Parsing and features, the mechanical passes, matching, fake P sources.                                                                                                                              |
| `requests.mjs`                  | Builds the exact requests with the scanner's own snapshot, index, evidence pack and request code; prints the receipt.                                                                               |
| `run.mjs`                       | Live client. One pass, no retries, stop on the first error, hard cap US$0.50, key from `TYPESAFE_API_KEY` or the `jevs auth` file, never from arguments. Prints the receipt when `--run` is absent. |
| `analyze.mjs`                   | Offline analyzer for a journal or a fake P source.                                                                                                                                                  |
| `signals/name_vs_behavior.json` | The set C question.                                                                                                                                                                                 |
| `results/`                      | Receipt, raw journal and analysis of the live run, when one has been made.                                                                                                                          |

## Reproduce

```sh
node evals/contrast/build.mjs --repos DIR --project PROJECT   # DIR holds claude-office, reshaped, t3code, oh-my-pi
node evals/contrast/build.mjs --repos DIR --check             # units.json is exactly what a fresh build gives
node evals/contrast/requests.mjs --project PROJECT            # the receipt, no request sent
node evals/contrast/run.mjs --project PROJECT --run --yes --cap-usd 0.5 --out RUNDIR
node evals/contrast/analyze.mjs --journal RUNDIR/journal.jsonl --markdown
node evals/contrast/analyze.mjs --fake feature:lines --markdown   # validation with a fake P
```

`run.mjs` checks the sha256 of every excerpt against `units.json` before building a request, so a changed scanner or repository cannot silently change what is asked.

## Validation without Jev

`test/contrast.test.mjs` runs the analyzer on fake P sources. P equal to function length gives Jev AUC equal to the length AUC (0.50 on A and C) and is flagged UNMATCHED on a set where length differs between the classes. A label oracle gives 1.0 and its inverse 0.0 on every set. Seeded noise gives intervals that contain 0.5. P equal to shingle overlap reads 0.5 on B, and P equal to vocabulary overlap separates B and is named as an unmatched separator. The live runner is tested with a fake client for the one-pass, stop-on-first-error and cap rules.

## Limits

- **Constructed, not natural.** Chimeras are cleaner seams than real split candidates, and rewrites are more uniform than real near-duplicates. A result here says what Jev does with these mechanical contrasts.
- **Control noise.** Controls are untouched real functions, not verified cohesive ones. A long real function may deserve a split, and a pair of different functions may share a policy. Both errors push AUC toward 0.5 for any scorer.
- **Mismatched names are not verified to be wrong.** C donors share no words with the body, so a synonym ("remove" for "delete") could still fit. A read of the 50 original and donor name pairs (names only, not bodies) found none that looked related, which is a spot check and not a proof.
- **Selection.** C keeps about 9% of eligible functions (the ones whose name words never occur in the body). A is limited to parts without early returns in the first part. B positives are functions that reach low overlap with the passes above. Findings apply to those subsets.
- **Cues that remain.** A: the chimera's first-part result is an unused local, and parameters are concatenated (A `params` AUC 0.56). B: the copy has a donor name and generic local names, and shares vocabulary (above). C: the renamed function is otherwise identical to its control, which Jev sees in separate requests.
- **One model, one prompt, one pass, one day.** Jev's P moves between calls (see the variance eval). One pass cannot measure that.
- **Not a human judgment.** No person looked at these units except the spot check above.
