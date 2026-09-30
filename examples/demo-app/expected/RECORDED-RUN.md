# Recorded run

This is **one real run** of `jev-scanr` (then named `semantic-refactor-scan`) 0.1.0-alpha on the synthetic demo app in `../src`, not a simulation.

| | |
|---|---|
| Model | `jev-1.13.0` |
| Date | 2026-09-30 (receipt frozen 2026-09-30T04:50:21.140Z) |
| Requests | 15 of 15 answered, 85 questions, 1 pass, no retries |
| Tokens | 27,240 input, 3,780 output |
| Calculated cost | US$0.0011 (tariff US$0.042/M input; not an invoice) |
| Cap | US$0.02 (worst case before the run: US$0.0061) |
| Signals | clone_same_policy, function_should_split, magic_policy_literal, internal_duplication, function_multiple_responsibilities, unused_local_or_parameter, deep_nesting |

Files: `RECEIPT.json` (written before the first request, read-only), `RESULT.json`, `report.json`, `report.md`, `queue.md`, and `journal.jsonl` (the sanitized run journal: answers and token counts, no source).

**Your run will not match this exactly.** Jev's probabilities are rounded to two decimals and are not reproducible from call to call. Expect the same seeded functions near the top, not the same numbers. `test/demo.test.mjs` checks that the recorded request hashes still match the current pipeline, so this recording is re-made (about US$0.001) whenever a default question or the unit logic changes.

**What this demonstrates, and what it does not.** The demo was written by us with problems put in on purpose, so finding them shows the output format and the plumbing. It says nothing about accuracy on real code. For that, see `EVIDENCE.md`.

Reproduce with your own key:

```sh
node scripts/record-demo.mjs --yes --cap-usd 0.02 --price-checked $(date +%F) --out ../demo-recording
```
