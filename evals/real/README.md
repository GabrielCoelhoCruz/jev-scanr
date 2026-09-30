# Real code: does Jev's name check hold up off the constructed sets?

[`../contrast/`](../contrast/README.md) showed that Jev separates constructed contrasts. This folder asks the harder question: on ordinary code, sampled at random, with labels from people-like readers and not from a mechanical change, does Jev's P for a mismatched name rank better than free heuristics? Status: pre-registered. Every rule below was committed before any label or request existed; the commit history of this folder is the proof. Findings will be hypotheses about this sample.

## Sample

400 named top-level functions, **100 from each** of reshaped-ui/reshaped, paulrobello/claude-office, pingdotgg/t3code and can1357/oh-my-pi at the pinned commits of `../contrast/README.md` (all MIT), **25 from each of four length bands** (5 to 9, 10 to 19, 20 to 39, 40 to 100 lines) per repository. Within a cell the choice is seeded-random; Jev's P, length, complexity and every other score play no part in it. The bands are equal-sized on purpose, so long and short functions are both well represented; the sample is therefore not the natural length mix. No more than 3 functions per file, no exact duplicates, no pair with scanner token overlap of 0.8 or more inside a cell. Population: top-level function declarations and const-bound function or arrow expressions, without `this`, `yield` or self-recursion, name of 3 or more characters, in non-test, non-generated source that passes the frozen secret filter. Class methods and anonymous functions are outside it. `units.json` holds paths, ranges, hashes and numbers, no source; `build.mjs --check` rebuilds it byte for byte.

Each excerpt is the function alone (no imports, callers or file), the same shape Jev saw in the constructed sets and the same text the labelers see.

## Question and labels

Jev's question is `name_vs_behavior` (`../contrast/signals/name_vs_behavior.json`, a candidate, not in the catalog). Two labelers read the same 400 excerpts blind to Jev's P (none existed when they labeled), to each other, and to every feature, following [`LABELING.md`](LABELING.md) word for word:

- **claude**: a Claude model, in a fresh task.
- **gpt**: a GPT model, in a fresh task, a different model family.

Labels: `mismatch`, `imprecise`, `fits`, `cannot_tell`. The raw files are committed in `labels/`.

## What is computed, and how it will be read

Positive = `mismatch` (strict, primary). `imprecise` counts as not positive, because Jev's own question says a generic or imprecise name that fits is not a mismatch. `cannot_tell` items leave that labeler's view; they are not negatives.

Primary views:

1. **agreement_only**: the items where both labelers give the same class (`mismatch`, `ok` for imprecise or fits) and neither says `cannot_tell`; positive when both say `mismatch`. This view drops the contested items, so it leans toward clear cases.
2. **first_labeler** (claude) and 3. **second_labeler** (gpt): each labeler's own labels.

Exploratory views (`*_lenient`): `imprecise` also counts as positive. They never enter the conclusion.

For each view: AUC of Jev's P(`name_mismatch`) and of each free heuristic (`lines`, `statements`, `cyclomatic`, `params`, `tokens`, and `nameMissing`, the share of the name's words that appear nowhere in the body, which is the natural lexical cue for this question), with 95% percentile bootstrap intervals over units (2000 resamples, seed 20260930). The two heuristics Jev is compared with are **lines** and **nameMissing**; the difference AUC(Jev) minus AUC(heuristic) is computed on the same resamples. Also: how many units Jev puts at or above the default cut 0.7, how many of those are true, precision with a Wilson interval, the prevalence, and the precision of the same number of units taken from the top of `lines` and of `nameMissing`. Agreement between labelers: raw agreement, Cohen's kappa, the confusion table.

Reading rules:

- A view is **underpowered** if it has fewer than 15 positives or fewer than 15 negatives. Its numbers are shown, never interpreted.
- **Jev separates** in a view if the lower end of its AUC interval is above 0.5. **Ahead of H** if the interval of the difference is above 0, **behind** if below 0, otherwise no detectable difference.
- **Supported on this sample** only if, under agreement_only, Jev separates and is ahead of both `lines` and `nameMissing`, and no single-labeler view that is not underpowered has Jev behind either.
- Jev separates but is not ahead of a heuristic: reported as "no evidence that Jev adds value over that free cue".
- Jev does not separate under agreement_only or either labeler: reported as "Jev does not separate on real code in this sample".
- Fewer than 15 positives everywhere: "No conclusion". That is an acceptable outcome.
- No heuristic is added, removed or re-chosen after the answers exist.

Power, stated before the data: real code is mostly well named, so positives will be few. With about 20 positives, an AUC interval is roughly 0.15 wide on each side. A difference under about 0.2 will not be detectable.

## Receipt for the live pass

Built by `../contrast/requests.mjs` from the scanner's own code: 400 requests, one question each, one pass, no retries, concurrency 1, stop on the first error, key from `TYPESAFE_API_KEY` or the `jevs auth` file and never from arguments. Serialized 1,300,715 bytes, estimated 433,572 input tokens (bytes divided by 3), **US$0.0182**; earlier runs came in 15 to 18% above that estimate, so expect about 512,000 tokens and **US$0.0215**. Worst case (one token per byte plus one reservation) US$0.0574. Hard cap **US$0.15**.

```sh
node evals/real/build.mjs --repos DIR --project PROJECT        # the excerpts to send
node evals/contrast/requests.mjs --units evals/real/units.json --project PROJECT
node evals/contrast/run.mjs --units evals/real/units.json --project PROJECT --run --yes --cap-usd 0.15 --out RUNDIR
node evals/real/analyze.mjs --journal RUNDIR/journal.jsonl --markdown
```

## Limits

- One sample, one day, one pass, one prompt. Jev's P moves a little between calls (`../contrast/results/README.md`, test-retest).
- Labelers are models. Two families reduce shared bias but do not make the labels human truth. Agreement between two models can still be a shared error.
- The excerpt hides the file and the repository. A name that fits the codebase's conventions but not the excerpt can look like a mismatch to every reader, human or model.
- Top-level functions of four TypeScript and JavaScript repositories only.
