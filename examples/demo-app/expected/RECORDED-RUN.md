# Recorded run

This is **one real run** of `jev-scanr` 0.3.1-alpha with its three default signals on the synthetic demo app in `../src`, not a simulation. It replaces an earlier recording that asked the seven original questions.

| | |
|---|---|
| Model | `jev-1.13.0` |
| Date | 2026-09-30 (receipt frozen 2026-09-30T16:02:44Z, before the first request) |
| Requests | 15 of 15 answered, 29 questions, 1 pass, no retries |
| Tokens | 19,754 input, 1,318 output |
| Calculated cost | US$0.0008 (tariff US$0.042 per million input tokens, confirmed against the public model page that day; not an invoice) |
| Cap | US$0.005 (worst case before the run: US$0.004986) |
| Signals | clone_same_policy, function_should_split, function_multiple_responsibilities |

Files: `RECEIPT.json` (written before the first request, read-only), `RESULT.json`, `report.json`, `report.md`, `queue.md`, and `journal.jsonl` (the run journal: answers and token counts, no source).

## What came out

Four candidates reached the 0.7 display cut:

| Item | Signal | P |
|---|---|---:|
| `clampPercent` and `clampVolume` | `clone_same_policy` | 0.98 |
| `importOrders` | `function_should_split` | 0.90 |
| `importOrders` | `function_multiple_responsibilities` | 0.88 |
| `registerUser` | `function_multiple_responsibilities` | 0.78 |

Five questions were seeded on purpose (the clone pair, `importOrders` twice, `registerUser` twice). Jev put four of the five over the cut. **It missed one:** `function_should_split` on `registerUser` came out at 0.52, below the cut. None of the clean functions reached the cut, including `renderInvoiceText`, which is long but does one job (0.14 for splitting, 0.06 for multiple responsibilities). Nothing was re-run or adjusted after seeing these numbers.

## What changed in the demo before recording

The demo has to show a useful queue for the signals that are on by default, and the approved cap (US$0.005) left room for no more requests. So two seeded functions that belonged to signals that are now experimental were replaced, before the receipt was written: `tally` (an unused parameter) and `findTagged` (deep nesting) gave way to `registerUser` (validation, hashing, saving, message writing and analytics in one body) and `renderInvoiceText` (a long function that is cohesive on purpose, a clean negative). The request count stays at 15. `lateFee` and `summarize` still carry problems for two experimental signals, but this recording did not ask those questions.

**Your run will not match this exactly.** Jev's probabilities are rounded to two decimals and are not reproducible from call to call. Expect the same seeded functions near the top, not the same numbers. `test/demo.test.mjs` checks that the recorded request hashes still match the current pipeline and demo source, so this recording is re-made (under US$0.001) whenever a default question or the unit logic changes.

**What this demonstrates, and what it does not.** The demo was written by us with problems put in on purpose, so finding them shows the output format and the plumbing. It says nothing about accuracy on real code. For that, see `EVIDENCE.md`.

Reproduce with your own key:

```sh
node scripts/record-demo.mjs --yes --cap-usd 0.005 --price-checked $(date +%F) --out ../demo-recording
```
