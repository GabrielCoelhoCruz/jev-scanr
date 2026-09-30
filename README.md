# jev-scanr

[![CI](https://img.shields.io/github/actions/workflow/status/GabrielCoelhoCruz/jev-scanr/ci.yml?style=flat-square&label=ci)](https://github.com/GabrielCoelhoCruz/jev-scanr/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square)](package.json)
![alpha](https://img.shields.io/badge/status-alpha-orange?style=flat-square)

**A refactoring queue for TypeScript and JavaScript projects, judged by the Jev model.** Built on TypeSafe's Jev. Unofficial, not affiliated with TypeSafe.

**Measured, not promised.** We started with 22 candidate questions and kept the 7 that survived a written review rule. In a pre-registered test on two repositories we had never scanned, 3 of those 7 reached a usefulness band by an LLM reviewer's labels (one above 50% actionable, two between 30% and 50%), and **no person has confirmed them yet**, so this is an alpha. [What we measured](#what-we-measured) has the numbers and the limits.

One candidate from the showcase (two similar finalization paths in `oh-my-pi`) led to a bug reproduced with a regression test and an open pull request, [can1357/oh-my-pi#13847](https://github.com/can1357/oh-my-pi/pull/13847). It is **open and not merged**, and the maintainer has not confirmed it. The other candidates remain hypotheses.

It cuts your project into functions and similar pairs of functions, asks [Jev](https://docs.typesafe.ai) a few narrow questions about each one ("does this function do two or more separable jobs?", "does it embed unexplained policy numbers?"), and gives you a list ordered by Jev's probability. You, or a coding agent, verify each item and act on the ones that hold. It is **not** a bug finder, a security scanner or an auto-fixer, and it changes no files.

```sh
npm install -g github:GabrielCoelhoCruz/jev-scanr    # not on npm yet; Node.js 24+
jevs auth                                                 # saves your TypeSafe key; or: export TYPESAFE_API_KEY=...
jevs scan .                                               # dry run: units, requests, cost estimate; sends nothing
```

**Until the package is published to npm, do not run `npx jev-scanr` or `npx jevs`:** npx would fetch whatever package owns that name on npm, which is not this project. Run without installing with `npx github:GabrielCoelhoCruz/jev-scanr scan .`, or install as above and use the `jevs` and `jev-scanr` commands. (`jr` was this project's short alias before 0.3.0-alpha; it is an unrelated package on npm, so never run `npx jr`.)

_Renamed from `jev-refactor` in 0.3.0-alpha: the old GitHub URL redirects, the commands are now `jev-scanr` and `jevs`, and `jevs auth` moves an existing `jev-refactor` key to the new config directory._

The dry run needs no key, so you can try the first and third command before you have one. `jevs` is short for `jev-scanr`. A live run needs your own [TypeSafe](https://docs.typesafe.ai) API key and runs only when you add `--run --yes --cap-usd N`.

## Install the agent skill

Installing the CLI alone does not teach your coding agent to use it. Install the skill too, from the project where your agent works:

```sh
jevs skill
```

It detects your coding agents (Claude Code, Codex, OpenCode and others) and asks where to install; add `--global` for a user-wide install or `--yes` for unattended installation. The [skill](skills/jev-scanr/SKILL.md) tells the agent when to run a scan, how to keep it inside a cost cap, and how to **verify each queue item before editing**: items are hypotheses, not orders. `jevs skill` delegates to the [skills CLI](https://github.com/vercel-labs/skills) and needs npm/npx and network access. You can run the installer directly, without `jevs`:

```sh
npx skills add GabrielCoelhoCruz/jev-scanr --skill jev-scanr
```

The skill never asks for your key in chat; `jevs auth` is for you to run in your own terminal.

## Start with a scan, leave with a queue

```sh
jevs scan .                                      # dry run: units, requests, coverage, estimated and worst-case cost
jevs scan . --list-files                         # every file whose source would be sent
jevs scan . --exclude private,legacy/keys --run --yes --cap-usd 0.5 --out ../scan-out
```

A live run writes `queue.md` (start here), `report.md` (counts, cost, per-signal table), `report.json`, plus `plan.json` and the run journal. The output directory must be outside the project. `plan.json` contains source excerpts, so keep it private. If a run stops early (an API error, the cost cap), the report covers what was answered, and `jevs continue` plans only what is missing (`jevs --help`).

**A scan reads at most 500 files, in path order, and indexes at most 12,000 functions and packs at most 2,000 units.** The dry run says so next to the cost (`Coverage: read 485 of 3,953 source files (12%)`), lists the directories it did not read, and warns with `NOT INDEXED` or `NOT PACKED` if a cap cut a slice short. For a larger project, scan it in slices: `jevs scan . --paths apps/web/src/components,apps/server`. Units and their context come only from the paths you give, so keep related code in one slice. Each slice is a separate run with its own cost. If your `tsconfig.json` extends a config that lives in a package (Expo, Next, and so on), read [`docs/EXTERNAL-CONFIGS.md`](docs/EXTERNAL-CONFIGS.md) first.

Try it on the bundled demo app first; it has problems put in on purpose ([`examples/demo-app/`](examples/demo-app/)):

```sh
jevs scan examples/demo-app
```

```
Units: 14 functions, 1 similar pairs
Requests: 15 (85 questions, 0.08 MB of request text)
Estimated cost: US$0.0011 (bytes ÷ 3 per token); worst case US$0.0061 (one token per byte, plus one reservation)
```

Here is an item from a **real run recorded on `jev-1.13.0`** that cost US$0.0011 ([`expected/`](examples/demo-app/expected/) has the receipt, journal and reports). `queue.md` lists paths, line ranges and Jev's answer, and no source:

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

Seven of the demo's functions have a problem seeded in, and the recorded run put exactly those seven at the top and none of the clean ones. That shows the output format and the plumbing, **not accuracy**: we wrote the problems, so they are easy. Your run will not match the recording exactly, because Jev's probabilities are not reproducible from call to call.

## Signals

Seven signals are on by default and one is experimental (`--experimental`). The other fourteen tried in the prototype are retired: [`signals/retired.md`](signals/retired.md) says why, with the numbers.

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

`jevs signals` lists them with their evidence. Each question lives in one file under [`signals/`](signals/); adding one is described in [`CONTRIBUTING.md`](CONTRIBUTING.md).

P is Jev's probability for the positive option of one narrow question, rounded to two decimals. It is **not** the chance of a bug, and not the chance that a refactor pays off. It is not reproducible from call to call, and the 0.7 display cut is a display setting, not a calibration (`--threshold` moves it offline). When the chosen option is within 0.01 of another, the item is flagged `near tie`.

## What we measured

Every number has its limits next to it. All labels come from an LLM reviewer; no person has labeled anything yet. [`EVIDENCE.md`](EVIDENCE.md) is the index, and each write-up in [`evals/results/`](evals/results/) gives the method, the sample and what it does not show:

- **[Signal curation on one app](evals/results/signal-curation-daily-tracker.md).** 22 questions in, 7 kept by a rule written before the labels: on the top cells of the kept signals 21 of 29 were actionable (72%, an upper bound), against 1 of 41 for the rest, and 0 of 64 random cells below the cut. One project, the author's own.
- **[Validation gate on two new repositories](evals/results/validation-gate-2026-09-30.md).** Pre-registered, random above-cut sample. 3 of 7 signals reached a default band (only `clone_same_policy` above 50%), the repositories disagree on two of the three, and the rule's outcome for exactly 3 was not registered. The project stays an alpha. The release code was not the code that ran (the prototype it derives from was).
- **[Showcase on t3code and oh-my-pi](evals/results/showcase-t3code-oh-my-pi-2026-09-30.md).** Five candidates as hypotheses on 2.8% to 6.8% of two repositories, with pinned commits. One of them led to an open, unmerged pull request ([can1357/oh-my-pi#13847](https://github.com/can1357/oh-my-pi/pull/13847)); we have opened nothing else and have not contacted the maintainers about the others.
- **[One candidate, in detail](evals/results/daily-tracker-case-study.md).** What a useful item looks like, and what it takes to confirm one.

## Source, credentials, and local state

- **Sent:** each analyzed function or pair, with bounded context (callers, imported declarations, one hop), to `https://api.typesafe.ai` under your own key. Nothing else is sent. A dry run sends nothing.
- **Never read:** `node_modules`, dot-directories, build output, generated files, symlinks, and anything you pass to `--exclude`. Files whose path contains `secret` or `credential`, or whose content looks like a key or token, are skipped. That guard is a heuristic: check `--list-files` and choose a root you are willing to send.
- **Your key:** `TYPESAFE_API_KEY` in the environment wins; otherwise `jevs auth` stores it in an owner-only file (`$XDG_CONFIG_HOME/jev-scanr/credentials.json`, default `~/.config/jev-scanr/`, mode 0600; a file readable by other users is refused). The key is never accepted as a command-line option, printed, or written into a report. `jevs auth --remove` deletes it.
- **Cost:** `jev-1.13.0` at US$0.042 per million input tokens. The dry run prints a central estimate and a worst case. `--cap-usd` refuses to start if the worst case exceeds the cap, and a run stops before a request that could pass it. Up to 8 requests run at once (`--concurrency`), paced under Jev's documented rate limits; there are no automatic retries, and the first error stops the run, a 429 included. Costs are calculated from the tariff and the returned token counts, not an invoice.
- **Local state:** only what you ask for, in the output directory you choose. Nothing runs your project's code.

See [`SECURITY.md`](SECURITY.md) for the full list and how to report a problem.

## Development

```sh
git clone https://github.com/GabrielCoelhoCruz/jev-scanr && cd jev-scanr
npm ci                                                   # Node.js 24+
npm run ci                                               # syntax and formatting checks, then all tests (offline)
python3 -m unittest discover -s test -p test_pinned_config.py
node src/cli.mjs scan examples/demo-app                  # the same CLI without installing it
```

Tests never call Jev and never need a key. How the pipeline works (units, context, requests, journal, report) is in [`docs/architecture.md`](docs/architecture.md); the evaluation tools are in [`evals/README.md`](evals/README.md). Contributions are welcome, especially new questions with evidence and labels from your own project: read [`CONTRIBUTING.md`](CONTRIBUTING.md), including the gate a signal must pass to be on by default. Releases are described in [`docs/RELEASING.md`](docs/RELEASING.md); the package is not published to npm.

[MIT](LICENSE). Provenance and third-party notices: [`NOTICE.md`](NOTICE.md).
