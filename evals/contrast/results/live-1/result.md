# Constructed-contrast result

AUC = chance that a random positive outscores a random control (0.5 = chance). Intervals: 95% percentile bootstrap, 2000 resamples, seed 20260930; set C resamples pairs. Display cut 0.7.

## Set A: function_should_split

Scored 100 of 100 units (50 positives, 50 controls).

| Scorer                       | AUC (95% interval)  | Note                    |
| ---------------------------- | ------------------- | ----------------------- |
| Jev P(function_should_split) | 0.81 (0.72 to 0.89) |                         |
| lines                        | 0.50 (0.38 to 0.61) | matched by construction |
| statements                   | 0.50 (0.38 to 0.62) | not matched             |
| cyclomatic                   | 0.51 (0.40 to 0.62) | not matched             |
| params                       | 0.56 (0.46 to 0.68) | not matched             |
| tokens                       | 0.50 (0.39 to 0.62) | not matched             |

Mean P: positives 0.39, controls 0.12. At the cut: 0.16 of positives, 0.02 of controls. Excluding answers with choice insufficient: AUC 0.81 on 100 units.

- Matched: lines AUC 0.50 (0.38 to 0.61) includes 0.5, as constructed.
- Jev separates the classes: AUC 0.81 (0.72 to 0.89), interval above 0.5.
- Jev ahead of lines: AUC difference 0.31 (0.21 to 0.41).

## Set B: clone_same_policy

Scored 100 of 100 units (50 positives, 50 controls).

| Scorer                   | AUC (95% interval)  | Note                    |
| ------------------------ | ------------------- | ----------------------- |
| Jev P(clone_same_policy) | 1.00 (0.99 to 1.00) |                         |
| shingleJaccard           | 0.50 (0.38 to 0.61) | matched by construction |
| tokenCoverage10          | 0.49 (0.38 to 0.60) | not matched             |
| rawJaccard5              | 0.39 (0.28 to 0.50) | not matched             |
| vocabJaccard             | 0.68 (0.57 to 0.78) | not matched             |
| minLines                 | 0.48 (0.38 to 0.59) | not matched             |
| sizeRatio                | 0.69 (0.58 to 0.79) | not matched             |
| minTokens                | 0.57 (0.46 to 0.68) | not matched             |

Mean P: positives 0.96, controls 0.17. At the cut: 0.98 of positives, 0.04 of controls. Excluding answers with choice insufficient: AUC 1.00 on 100 units.

- Matched: shingleJaccard AUC 0.50 (0.38 to 0.61) includes 0.5, as constructed.
- Jev separates the classes: AUC 1.00 (0.99 to 1.00), interval above 0.5.
- Jev ahead of shingleJaccard: AUC difference 0.50 (0.39 to 0.61).
- Against the pre-registered secondary comparison vocabJaccard: AUC difference 0.31 (0.21 to 0.43), Jev ahead.
- Unmatched features that separate the classes: vocabJaccard 0.68 (0.57 to 0.78); sizeRatio 0.69 (0.58 to 0.79). A score that tracks these is not evidence of judgment.

## Set C: name_vs_behavior

Scored 100 of 100 units (50 positives, 50 controls).

| Scorer                   | AUC (95% interval)  | Note                    |
| ------------------------ | ------------------- | ----------------------- |
| Jev P(name_vs_behavior)  | 0.97 (0.94 to 0.99) |                         |
| lines                    | 0.50 (0.50 to 0.50) | matched by construction |
| statements               | 0.50 (0.50 to 0.50) | not matched             |
| cyclomatic               | 0.50 (0.50 to 0.50) | not matched             |
| params                   | 0.50 (0.50 to 0.50) | not matched             |
| tokens                   | 0.50 (0.50 to 0.50) | not matched             |
| nameWordsMissingFromBody | 0.50 (0.50 to 0.50) | not matched             |

Mean P: positives 0.55, controls 0.04. At the cut: 0.38 of positives, 0.00 of controls. Excluding answers with choice insufficient: AUC 0.97 on 100 units.

Paired view (same body, renamed against original): 50 pairs, mean P difference 0.51 (0.42 to 0.60); renamed higher in 49, lower in 1, tied in 0; two-sided sign test p = 0.00.

- Matched: lines AUC 0.50 (0.50 to 0.50) includes 0.5, as constructed.
- Jev separates the classes: AUC 0.97 (0.94 to 0.99), interval above 0.5.
- Jev ahead of lines: AUC difference 0.47 (0.44 to 0.49).
