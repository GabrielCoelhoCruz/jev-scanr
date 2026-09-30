# Demo app

Ten small TypeScript files, written for this project. Some functions carry a problem that one of the signals asks about, and the rest are clean on purpose, so you can run the scanner and see what comes out without pointing it at your own code.

```sh
node src/cli.mjs scan examples/demo-app          # dry run: 15 requests, under US$0.001 with the default signals, sends nothing
```

A real run costs under a tenth of a cent. See [`expected/RECORDED-RUN.md`](expected/RECORDED-RUN.md) for one recorded on `jev-1.13.0` with the three default signals, with its receipt, journal, `report.md` and `queue.md`.

## What is seeded

| Function                       | File                              | Question it is meant to trigger                                                                                                       |                         Recorded P |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------: |
| `clampPercent` / `clampVolume` | `src/percent.ts`, `src/volume.ts` | `clone_same_policy`: the same clamp with different bounds                                                                             |                               0.98 |
| `importOrders`                 | `src/importer.ts`                 | `function_should_split`, `function_multiple_responsibilities`: parse, dedupe, save and format in one body                             |                         0.90, 0.88 |
| `registerUser`                 | `src/signup.ts`                   | `function_multiple_responsibilities`, `function_should_split`: validation, hashing, saving, message writing and analytics in one body | 0.78, 0.52 (below the cut: a miss) |
| `lateFee`                      | `src/billing.ts`                  | `magic_policy_literal` (experimental): 14, 0.035, 60 and 250 are bare policy numbers                                                  |                          not asked |
| `summarize`                    | `src/stats.ts`                    | `internal_duplication` (experimental): the orders block and the returns block are the same code                                       |                          not asked |

Clean on purpose: `formatCurrency`, `applyDiscount` (named constant), `average`, `activeWithTag`, `describeTotal`, `slugify`, `truncate` and `renderInvoiceText` (long, but it does one job). In the recorded run none of them reached the 0.7 cut. To see the two experimental seeds, run `node src/cli.mjs scan examples/demo-app --signals magic_policy_literal,internal_duplication` with your own key; they are not part of the recording.

The recorded numbers are the model's, from one call per request. Rerunning can move them a little, or across the cut: `registerUser` for `function_should_split` sat at 0.52 here and could land on either side of 0.7.
