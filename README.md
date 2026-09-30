# semantic-refactor-scan

**A refactoring queue for TypeScript and JavaScript projects, judged by the Jev model.** _v0.1.0-alpha_

It cuts your project into functions and similar pairs of functions, asks [Jev](https://docs.typesafe.ai) a few narrow yes/no-style questions about each one ("does this function do two or more separable jobs?", "does it embed unexplained policy numbers?"), and gives you a list ordered by Jev's probability. You, or a coding agent, verify each item and act on the ones that hold.

It is **not** a bug finder, a security scanner or an auto-fixer. It changes no files. Every finding and its order come only from Jev's probabilities; the code only forms units and gathers context. Built on TypeSafe's Jev model. Unofficial, not affiliated with TypeSafe.

> **Alpha.** The seven default signals passed a small check on one project, reviewed by one LLM. Read [`EVIDENCE.md`](EVIDENCE.md) before you trust a number.

## Try it

```sh
git clone <this repo> && cd semantic-refactor-scan && npm ci     # Node 24+
node src/cli.mjs scan ~/code/my-project                      # dry run: shows units and cost, sends nothing
```

`npm link` gives you a `semantic-refactor-scan` command instead of `node src/cli.mjs`. Once the package is on npm, `npx semantic-refactor-scan scan .` works the same way. It already runs from a packed tarball with `npx ./semantic-refactor-scan-0.1.0-alpha.tgz`.

**A scan reads at most 500 files, in path order, and indexes at most 12,000 functions and packs at most 2,000 units.** The dry run says so right next to the cost (`Coverage: read 485 of 3,953 source files (12%)`) and lists which directories were not read, and it warns with `NOT INDEXED` or `NOT PACKED` if a function or unit cap cut a slice short. For a larger project, scan it in slices with `--paths apps/web/src/components,apps/server`. Units and their context come only from the paths you give, so keep related code in one slice. Each slice is a separate run with its own cost.

If your `tsconfig.json` extends a config that lives in a package (Expo, Next, …), read [`docs/EXTERNAL-CONFIGS.md`](docs/EXTERNAL-CONFIGS.md) first: without it, imports through path aliases get less context.

Try it on the bundled demo app first. The dry run sends nothing:

```sh
node src/cli.mjs scan examples/demo-app
```

```
Units: 14 functions, 1 similar pairs
Requests: 15 (85 questions, 0.08 MB of request text)
Estimated cost: US$0.0011 (bytes ÷ 3 per token); worst case US$0.0061 (one token per byte, plus one reservation)
```

When you are happy with the scope and the cost, run it on your own key:

```sh
export TYPESAFE_API_KEY=...                                  # your key; never a command-line option
node src/cli.mjs scan examples/demo-app --run --yes --cap-usd 0.02 --out ../demo-scan   # about a tenth of a cent
node src/cli.mjs scan ~/code/my-project --list-files         # every file whose source would be sent
node src/cli.mjs scan ~/code/my-project --exclude private,legacy/keys --run --yes --cap-usd 0.5 --out ./scan-out
```

It writes `queue.md` (start here), `report.md` (counts, cost, per-signal table), `report.json`, plus `plan.json` and the run journal. `plan.json` contains source excerpts, so keep it private. If a run stops early (an API error, the cost cap), the report covers what was answered and `continue` plans only what is missing (`node src/cli.mjs --help`).

## What gets sent, and what it costs

- **Sent:** each analyzed function or pair, with bounded context (callers, imported declarations, one hop), to `https://api.typesafe.ai` under your own key. Nothing else is sent, and nothing is stored by this tool outside your output directory.
- **Never read:** `node_modules`, dot-directories, build output, generated files, symlinks, and anything you pass to `--exclude`. Files whose path contains `secret` or `credential`, or whose content looks like a key or token, are skipped. That guard is a heuristic. Check `--list-files` before a live run.
- **Cost:** `jev-1.13.0` at US$0.042 per million input tokens. The dry run prints a central estimate and a worst case. `--cap-usd` refuses to start if the worst case exceeds the cap, and a run stops before a request that could pass it. Up to 8 requests run at once (`--concurrency`), paced by a token-bucket limiter that stays under Jev's documented rate limits, so a 30,000-line project takes about a minute or two. Each request reserves its worst-case cost before it is sent. There are no automatic retries, and the first error stops the run, a 429 included. Costs are calculated from the tariff and the token counts the API returns. They are not an invoice.

## What comes out

The demo app has problems put in on purpose (see [`examples/demo-app/`](examples/demo-app/)). Here is an item from a **real run recorded on `jev-1.13.0`**, which cost US$0.0011 ([`expected/`](examples/demo-app/expected/) has the receipt, journal and reports). `queue.md` lists paths, line ranges and Jev's answer, and no source:

```
## 2. lateFee src/billing.ts:1–7 · magic_policy_literal@1.0.0 · P=1.00
- Question: Does the visible focus code embed unexplained numeric or string literals that encode business policy…
- Jev answer: unexplained_policy_literal.
- Read first: src/billing.ts:1–7.
```

```ts
const fee = amount * 0.035 * Math.min(daysLate - 14, 60);
return fee > 250 ? 250 : Math.round(fee * 100) / 100;
```

Seven of the demo's functions have a problem seeded in, and the recorded run put exactly those seven at the top and none of the clean ones. That shows the output format and the plumbing, **not accuracy**: we wrote the problems, so they are easy. For measured results on a real project, including where it did not work, read [`EVIDENCE.md`](EVIDENCE.md). Your run will not match the recording exactly, because Jev's probabilities are not reproducible from call to call.

## Signals

Seven signals are on by default, one is experimental (`--experimental`). The other fourteen tried in the prototype are retired: [`signals/retired.md`](signals/retired.md) says why, with the numbers.

| Signal                               | Asks about                                                       | Status       |
| ------------------------------------ | ---------------------------------------------------------------- | ------------ |
| `clone_same_policy`                  | a similar pair: do both implement the same rule?                 | default      |
| `function_should_split`              | is one function long and dense, with cohesive blocks to extract? | default      |
| `magic_policy_literal`               | unexplained numbers or strings that encode policy                | default      |
| `internal_duplication`               | near-identical blocks inside one function                        | default      |
| `function_multiple_responsibilities` | two or more separable jobs in one function                       | default      |
| `unused_local_or_parameter`          | a local or parameter that is never read                          | default      |
| `deep_nesting`                       | control flow nested three or more levels                         | default      |
| `unreachable_code`                   | statements that can never run                                    | experimental |

`node src/cli.mjs signals` lists them with their evidence. Each question lives in one file under [`signals/`](signals/); adding one is described in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Reading a probability

P is Jev's probability for the positive option of one narrow question, rounded to two decimals. It is **not** the chance of a bug, and not the chance that a refactor pays off. It is not reproducible: the one request we had to send twice came back with a different distribution the second time. The 0.7 display cut is a display setting, not a calibration; `--threshold` moves it offline. When the chosen option is within 0.01 of another, the item is flagged `near tie`.

`evals/` has what you need to test a signal the way we did (case sets, oracle and null checks, noise floor, P variance, a calibrated LLM judge, a pre-registered gate); see [`evals/README.md`](evals/README.md).

## Layout, tests, license

`src/` (units → context → requests → journal → report), `signals/` (one file per question), `evals/`, `examples/demo-app/`, `docs/` (design and offline config data), `test/` (`npm test`, no network, no Jev calls). `npm run ci` also checks formatting. MIT, see [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md). Security and privacy notes are in [`SECURITY.md`](SECURITY.md).
