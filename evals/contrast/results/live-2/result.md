# Constructed-contrast result

AUC = chance that a random positive outscores a random control (0.5 = chance). Intervals: 95% percentile bootstrap, 2000 resamples, seed 20260930. Display cut 0.7.

## Set A2: function_should_split

Scored 92 of 92 units (46 positives, 46 controls).

| Scorer                       | AUC (95% interval)  | Note                    |
| ---------------------------- | ------------------- | ----------------------- |
| Jev P(function_should_split) | 0.76 (0.66 to 0.85) |                         |
| lines                        | 0.50 (0.38 to 0.62) | matched by construction |
| statements                   | 0.49 (0.37 to 0.61) | not matched             |
| cyclomatic                   | 0.49 (0.37 to 0.60) | not matched             |
| params                       | 0.56 (0.45 to 0.68) | not matched             |
| tokens                       | 0.51 (0.39 to 0.63) | not matched             |

Mean P: positives 0.34, controls 0.13. At the cut: 0.13 of positives, 0.02 of controls. Excluding answers with choice insufficient: AUC 0.76 on 92 units.

- Matched: lines AUC 0.50 (0.38 to 0.62) includes 0.5, as constructed.
- Jev separates the classes: AUC 0.76 (0.66 to 0.85), interval above 0.5.
- Jev ahead of lines: AUC difference 0.26 (0.16 to 0.37).

## Set B2: clone_same_policy

Scored 100 of 100 units (50 positives, 50 controls).

| Scorer                   | AUC (95% interval)  | Note                    |
| ------------------------ | ------------------- | ----------------------- |
| Jev P(clone_same_policy) | 0.98 (0.95 to 1.00) |                         |
| shingleJaccard           | 0.56 (0.44 to 0.67) | matched by construction |
| tokenCoverage10          | 0.38 (0.27 to 0.48) | not matched             |
| rawJaccard5              | 0.34 (0.24 to 0.46) | not matched             |
| vocabJaccard             | 0.71 (0.59 to 0.81) | not matched             |
| minLines                 | 0.55 (0.44 to 0.65) | not matched             |
| sizeRatio                | 0.67 (0.56 to 0.77) | not matched             |
| minTokens                | 0.56 (0.45 to 0.67) | not matched             |
| surfaceJaccard           | 0.79 (0.71 to 0.86) | not matched             |

Mean P: positives 0.95, controls 0.28. At the cut: 0.98 of positives, 0.10 of controls. Excluding answers with choice insufficient: AUC 0.98 on 100 units.

Hard negatives (surface overlap at least 0.8): 28 units, mean P 0.26, 0.14 at the cut. Different functions that share most literals, property names and type names. Some may truly share a policy, so a high P here is not automatically an error.

- Matched: shingleJaccard AUC 0.56 (0.44 to 0.67) includes 0.5, as constructed.
- Jev separates the classes: AUC 0.98 (0.95 to 1.00), interval above 0.5.
- Jev ahead of shingleJaccard: AUC difference 0.42 (0.31 to 0.53).
- Against the pre-registered secondary comparison surfaceJaccard: AUC difference 0.19 (0.12 to 0.27), Jev ahead.
- Unmatched features that separate the classes: tokenCoverage10 0.38 (0.27 to 0.48); rawJaccard5 0.34 (0.24 to 0.46); vocabJaccard 0.71 (0.59 to 0.81); sizeRatio 0.67 (0.56 to 0.77); surfaceJaccard 0.79 (0.71 to 0.86). A score that tracks these is not evidence of judgment.
