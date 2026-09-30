# Low-overlap retrieval: offline validation

Options: {"minLines":8,"minJaccard":0.45,"minSizeRatio":0.5,"cap":50,"minScore":0.6,"minSurface":3,"maxDocumentFrequency":250}. No Jev call was made.

## Pair level (no cap)

| Set | Positives proposed | Negatives proposed | Hard negatives (surface overlap at least 0.8) proposed |
| --- | --- | --- | --- |
| B | 50/50 (100%) | 17/50 (34%) | 0/0 |
| B2 | 0/0 (n/a) | 29/50 (58%) | 18/28 |

## Repo level (copies planted into a slice of the pinned repository, default cap)

| Repository | Planted | Proposed | Worst rank | Low-overlap pairs proposed | Natural pairs passing the filter / all pairs |
| --- | --- | --- | --- | --- | --- |
| paulrobello/claude-office | 8 | 8 | 12 of 50 | 50 | 65 / 208335 (0.03%) |
| reshaped-ui/reshaped | 8 | 8 | 38 of 50 | 50 | 54 / 123256 (0.04%) |
| pingdotgg/t3code | 17 | 17 | 24 of 50 | 28 | 5 / 55278 (0.01%) |
| can1357/oh-my-pi | 17 | 17 | 25 of 50 | 50 | 184 / 5788503 (0.00%) |

Total: 50 of 50 planted copies proposed, worst rank 38.
