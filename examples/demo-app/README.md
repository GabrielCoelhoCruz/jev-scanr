# Demo app

Eight small TypeScript files, written for this project. Some functions carry a problem that one of the signals asks about, and the rest are clean on purpose, so you can run the scanner and see what comes out without pointing it at your own code.

```sh
node src/cli.mjs scan examples/demo-app          # dry run: 15 requests, under US$0.001 with the default signals, sends nothing
```

A real run costs under a tenth of a cent. The recording below asked the seven original questions (US$0.0011); four of them are now experimental and need `--experimental`. See [`expected/RECORDED-RUN.md`](expected/RECORDED-RUN.md) for one recorded on `jev-1.13.0`, with its receipt, journal, `report.md` and `queue.md`.

## What is seeded

| Function | File | Signal it is meant to trigger | Recorded P |
|---|---|---|---:|
| `lateFee` | `src/billing.ts` | `magic_policy_literal`: 14, 0.035, 60 and 250 are bare policy numbers | 1.00 |
| `importOrders` | `src/importer.ts` | `function_should_split`, `function_multiple_responsibilities`: parse, dedupe, save and format in one body | 0.92, 0.87 |
| `summarize` | `src/stats.ts` | `internal_duplication`: the orders block and the returns block are the same code | 1.00 |
| `clampPercent` / `clampVolume` | `src/percent.ts`, `src/volume.ts` | `clone_same_policy`: the same clamp with different bounds | 0.98 |
| `findTagged` | `src/search.ts` | `deep_nesting`: five levels deep | 0.87 |
| `tally` | `src/tally.ts` | `unused_local_or_parameter`: `label`, `verbose` and `started` are never read | 0.99 |

Clean on purpose: `formatCurrency`, `applyDiscount` (named constant), `average`, `activeWithTag`, `describeTotal`, `slugify` and `truncate`. In the recorded run none of them reached the 0.7 cut. Two borderline cells did show up below it (`magic_policy_literal` on the two clamp functions, at 0.43 and 0.59), which is what a probability, rather than a verdict, looks like.

The recorded numbers are the model's, from one call per request. Rerunning can move them a little, or across the cut.
