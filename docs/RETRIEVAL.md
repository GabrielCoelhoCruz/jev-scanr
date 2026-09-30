# Retrieval: which units get asked

Code decides which units Jev is asked about. It never scores them. Two rules pick pairs for `clone_same_policy`, and one rule picks functions for `name_vs_behavior`. All three are cheap, deterministic and biased in ways listed here. Every candidate they propose is still a hypothesis that Jev's answer and a person must check.

## Clone pairs: two sources

| Source              | Proposes                                                                                                                                            | Limits                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Token overlap (old) | two functions of at least 8 lines, within a 2:1 size ratio, sharing at least 45% of their normalized 5-token shingles                               | 2,000 units per plan, 500,000 comparisons                     |
| Low overlap (new)   | two functions of at least 8 lines, within a 2:1 size ratio, sharing **under** 45% of their shingles, with a surface and shape score of at least 0.6 | at most 50 pairs per scan (`--low-overlap N`, 0 turns it off) |

Why a second source. The token-overlap source normalizes identifiers, strings and numbers, so a function and a mechanical rewrite of it (different braces, arrow forms, callback style, local names) can drop under 45% and never be proposed. The constructed-contrast evaluation scored exactly those rewrites at AUC 1.00, but the scanner could not have found them in a real project.

The low-overlap score is the mean of two numbers, both computed without Jev:

- **Surface overlap.** Jaccard overlap of the names a function uses without declaring them (callees, properties, imports, types) plus its string and template literals. Its own parameters, locals and name are left out, so renaming them does not hide a copy.
- **Shape similarity.** The overlap of the two functions' AST node-type counts (sum of minima over sum of maxima).

A function needs at least 3 surface items to take part. A name that appears in more than 250 functions is not used to find partners, which keeps the work near linear on large projects. Its pair search has its own 500,000-comparison budget, records `low_overlap_comparison_cap_remaining_unknown` when that runs out, and records `low_overlap_cap` with a count when more than the cap passed. The best-scoring pairs are kept. A proposed pair carries `retrievalSource: "low_overlap_surface"` in its unit facts, in `plan.json` (`coverage.lowOverlap`) and on its finding in `report.json`; `queue.md` is unchanged. Pairs go through `clone_same_policy` with the same question and the same band rules as any other pair.

### Validated offline, no Jev call

`node evals/retrieval/validate.mjs` (results in [`evals/retrieval/result.json`](../evals/retrieval/result.json)) plants the 50 rewritten copies of contrast set B into slices of up to 440 files of their four pinned repositories and runs the scanner's own retrieval with the default cap.

- **Recall.** All 50 were proposed. The worst rank among the proposals was 38 of 50 (`reshaped`), so the cap of 50 leaves little room. A second build of the same set with another seed (not committed) also proposed 50 of 50, worst rank 32.
- **Precision is low by design.** Of the pairs proposed in a slice, 16% (claude-office, reshaped), 34% (oh-my-pi) and 61% (t3code) were the planted copies. The rest are natural pairs that share names and shape, and the cap is what bounds them. Among the contrast negatives, 17 of 50 (B) and 29 of 50 (B2, chosen to share literals and property names) would be proposed, 18 of the 28 hard negatives among them. The filter is a recall step, not a judge.
- **Selectivity.** Across all pairs of functions in a slice, 0.00% to 0.04% pass the filter (5 to 184 pairs).

What this does not show. The copies are the same function twice, rewritten by a script. Real copies drift: a developer edits one and leaves the other, so real near-duplicates share less than these do, and recall on them is unknown. The 0.6 floor was picked after looking at the scores of these same 50 pairs in early experiments (the lowest final score is 0.61), so the recall above is not an independent test.

## Functions for `name_vs_behavior`: name words absent from the body

`name_vs_behavior` is an opt-in signal (`--signals name_vs_behavior`, or `--signals` with the defaults plus it). Most names fit their functions, so asking about every function spends requests on the easy case. The catalog entry sets `unitFilter: "name_words_absent_from_body"`, and the planner asks only functions for which none of the words of the name appears in the body.

- **The cue.** The name is split into words at case changes and separators, words under 3 letters and a short stop list are dropped, plural endings are trimmed. The body is the function's source without its own name. The cue is true when no word of the name appears among the body's words, in either form. Functions with no usable name words are skipped. The same code built the contrast set C.
- **Scope.** The filter applies to this signal only. The default signals still ask about every function, in the same request. `plan.json` records `nameCueAbsent` per unit and `coverage.unitsSkippedByNameCue`.

### Bias

- **A correct name can be absent from the body.** `invoiceTotal` for a function that sums `rows` passes the cue and fits. Jev, not the cue, says so.
- **A wrong name can be present in the body.** A function called `validateUser` that only logs is hidden if its body contains `user` or `validate`, because one shared word is enough to stop the cue. These are missed.
- **A rename to an unrelated name still passes almost always.** This is the case the cue exists for, and in the pinned repositories it let through 92% of functions renamed to an unrelated name (1,101 of 1,200).
- **Selectivity.** It lets through 15% of named functions (931 of 6,132; 12% to 22% per repository).
- **Real mismatches are rare.** In a fair sample of ordinary functions, two blind labelers judged a mismatch in about 1% of them (a later fair-sample check by the project's maintainers, not reproduced in this repository), so most of what passes the cue will be answered `name_fits`.

### Validated offline, no Jev call

`node evals/retrieval/names.mjs` (results in [`evals/retrieval/names-result.json`](../evals/retrieval/names-result.json)) measures selectivity on the four pinned repositories and, for a seeded random sample of 300 named functions per repository, renames each to the name of an unrelated function and counts how many the cue still lets through. The 50 renamed and 50 original functions of set C all pass the cue, because they were built to: that set cannot test the cue, only confirm the code agrees with how it was built.

## Reproduce

```sh
node evals/retrieval/validate.mjs --repos DIR --project PROJECT --controls-project CONTROLS --markdown
node evals/retrieval/names.mjs --repos DIR --markdown
```

`DIR` holds the four repositories at the commits in `evals/contrast/units.json`; `PROJECT` and `CONTROLS` are the excerpt folders `evals/contrast/build.mjs --project` and `build-controls.mjs --project` write. Add `--check` to compare with the committed results.
