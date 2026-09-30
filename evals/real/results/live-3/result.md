# Real-code name_vs_behavior result

Scored 400 of 400 units. Labelers: claude (first), gpt (second). Intervals: 95% percentile bootstrap over units, 2000 resamples. Cut 0.7: Jev flagged 0 units.

## Conclusion

No conclusion: fewer than 15 positives or 15 negatives in every primary view. Point estimates are shown, not interpreted.

## Agreement between labelers

Raw agreement 0.96 on four labels, 0.99 on mismatch / ok / cannot_tell. Cohen kappa 0.32 and 0.00. Mismatch: 0 by claude, 5 by gpt, 0 by both. Cannot tell by either: 0.

## Descriptive readout (not part of the conclusion)

Units at or above the cut (0):

| id  | name | lines | P   | claude | gpt |
| --- | ---- | ----- | --- | ------ | --- |

Units either labeler called mismatch or imprecise (16):

| id       | name                             | lines | P    | claude    | gpt       |
| -------- | -------------------------------- | ----- | ---- | --------- | --------- |
| dcf0cd51 | transformDefinition              | 28    | 0.50 | imprecise | imprecise |
| 9a7fc0db | isPermissionDenied               | 9     | 0.33 | imprecise | imprecise |
| bf3ba91b | copy                             | 9     | 0.30 | imprecise | mismatch  |
| 991a84e2 | markSeen                         | 7     | 0.25 | imprecise | fits      |
| f8b3ae32 | FileUploadTrigger                | 5     | 0.20 | fits      | mismatch  |
| 90d84fcd | checkTransitions                 | 6     | 0.12 | fits      | imprecise |
| 6273ca5e | useIsDismissible                 | 25    | 0.11 | fits      | mismatch  |
| 777e7c9b | buildGenerated                   | 25    | 0.03 | imprecise | fits      |
| 7b2868a4 | optimalDimensions                | 13    | 0.01 | imprecise | mismatch  |
| a36e40f6 | filterEnabled                    | 19    | 0.01 | imprecise | fits      |
| 2fdaf623 | setMotionTargets                 | 37    | 0.01 | fits      | imprecise |
| bd0a70d6 | ComboboxListVirtualized          | 9     | 0.01 | imprecise | mismatch  |
| d98d12ef | setThreadTerminalOpen            | 8     | 0.01 | fits      | imprecise |
| 56ad13ed | getOrphanedWorktreePathForThread | 23    | 0.01 | fits      | imprecise |
| 6dca5233 | bucketRules                      | 42    | 0.01 | imprecise | fits      |
| 8f33af01 | labelFor                         | 8     | 0.00 | fits      | imprecise |

## View: agreement_only

395 units, 0 positives (0.00). UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions.

| Scorer               | AUC (95% interval) |
| -------------------- | ------------------ |
| Jev P(name_mismatch) | n/a (n/a to n/a)   |
| lines                | n/a (n/a to n/a)   |
| statements           | n/a (n/a to n/a)   |
| cyclomatic           | n/a (n/a to n/a)   |
| params               | n/a (n/a to n/a)   |
| tokens               | n/a (n/a to n/a)   |
| nameMissing          | n/a (n/a to n/a)   |

Jev minus lines: n/a (n/a to n/a). Jev minus nameMissing: n/a (n/a to n/a).

At the cut: Jev flagged 0 of these units, 0 true (precision n/a, n/a to n/a); prevalence 0.00. The same count taken from the top of lines: precision n/a; of nameMissing: n/a.

## View: first_labeler

400 units, 0 positives (0.00). UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions.

| Scorer               | AUC (95% interval) |
| -------------------- | ------------------ |
| Jev P(name_mismatch) | n/a (n/a to n/a)   |
| lines                | n/a (n/a to n/a)   |
| statements           | n/a (n/a to n/a)   |
| cyclomatic           | n/a (n/a to n/a)   |
| params               | n/a (n/a to n/a)   |
| tokens               | n/a (n/a to n/a)   |
| nameMissing          | n/a (n/a to n/a)   |

Jev minus lines: n/a (n/a to n/a). Jev minus nameMissing: n/a (n/a to n/a).

At the cut: Jev flagged 0 of these units, 0 true (precision n/a, n/a to n/a); prevalence 0.00. The same count taken from the top of lines: precision n/a; of nameMissing: n/a.

## View: second_labeler

400 units, 5 positives (0.01). UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions.

| Scorer               | AUC (95% interval)  |
| -------------------- | ------------------- |
| Jev P(name_mismatch) | 0.81 (0.60 to 0.98) |
| lines                | 0.29 (0.10 to 0.49) |
| statements           | 0.29 (0.06 to 0.64) |
| cyclomatic           | 0.26 (0.07 to 0.63) |
| params               | 0.50 (0.36 to 0.78) |
| tokens               | 0.24 (0.06 to 0.50) |
| nameMissing          | 0.85 (0.69 to 0.95) |

Jev minus lines: 0.53 (0.26 to 0.83). Jev minus nameMissing: -0.04 (-0.23 to 0.08).

At the cut: Jev flagged 0 of these units, 0 true (precision n/a, n/a to n/a); prevalence 0.01. The same count taken from the top of lines: precision n/a; of nameMissing: n/a.

## View: first_labeler_lenient (exploratory)

400 units, 9 positives (0.02). UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions.

| Scorer               | AUC (95% interval)  |
| -------------------- | ------------------- |
| Jev P(name_mismatch) | 0.79 (0.66 to 0.93) |
| lines                | 0.41 (0.26 to 0.55) |
| statements           | 0.44 (0.22 to 0.67) |
| cyclomatic           | 0.42 (0.19 to 0.66) |
| params               | 0.67 (0.48 to 0.85) |
| tokens               | 0.36 (0.15 to 0.57) |
| nameMissing          | 0.59 (0.39 to 0.77) |

Jev minus lines: 0.39 (0.17 to 0.62). Jev minus nameMissing: 0.21 (-0.03 to 0.47).

At the cut: Jev flagged 0 of these units, 0 true (precision n/a, n/a to n/a); prevalence 0.02. The same count taken from the top of lines: precision n/a; of nameMissing: n/a.

## View: second_labeler_lenient (exploratory)

400 units, 12 positives (0.03). UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions.

| Scorer               | AUC (95% interval)  |
| -------------------- | ------------------- |
| Jev P(name_mismatch) | 0.75 (0.61 to 0.90) |
| lines                | 0.33 (0.20 to 0.47) |
| statements           | 0.40 (0.22 to 0.59) |
| cyclomatic           | 0.40 (0.24 to 0.57) |
| params               | 0.55 (0.39 to 0.72) |
| tokens               | 0.31 (0.15 to 0.49) |
| nameMissing          | 0.59 (0.41 to 0.76) |

Jev minus lines: 0.42 (0.24 to 0.64). Jev minus nameMissing: 0.17 (-0.01 to 0.37).

At the cut: Jev flagged 0 of these units, 0 true (precision n/a, n/a to n/a); prevalence 0.03. The same count taken from the top of lines: precision n/a; of nameMissing: n/a.
