# Notices and provenance

`jev-refactor` is released under the MIT license in [`LICENSE`](LICENSE), copyright the jev-refactor contributors. It was called `semantic-refactor-scan` before 0.2.0-alpha.

## Origin

This code is derived from an experimental scanner (the "Semantic Scanner" prototype, versions 0.2 to 0.4.1, also MIT, copyright "Semantic Scanner contributors"). That prototype in turn adapted the read-only AST inventory and the reservation / write-ahead-journal approach of the earlier MIT `jev-readonly-pilot` harness. The original notices are retained unchanged:

- [`licenses/jev-readonly-pilot-MIT.txt`](licenses/jev-readonly-pilot-MIT.txt)
- The prototype's own MIT notice is the copyright line above, carried forward with its history.

This repository keeps only the jev-only pipeline (units → Jev → per-signal probability → queue). The prototype's other evaluation modes, datasets, model predictions, labels and private review artifacts are not included.

## Third-party software

Runtime dependencies are installed, not vendored, and pinned exactly in `package-lock.json`: `@babel/parser`, `@babel/traverse` (Babel, MIT), `@typesafe-ai/sdk` (MIT) and `jsonc-parser` (MIT). Development tools: `prettier` and `ajv` (MIT). Their full upstream license texts, including transitive dependencies, are in [`licenses/`](licenses/) with an index (`licenses/index.json`). A test checks that every package in the lockfile has a notice there.

## Examples and evidence

`examples/demo-app/` is synthetic code written for this project. Its `expected/` directory is one real recorded run on it. `evals/results/` shows a few paths, one 5-line snippet and measured results from a scan of the author's own application (https://github.com/GabrielCoelhoCruz/daily-tracker), which is public, and line ranges (no copied source) for candidates in two other public MIT repositories, linked at pinned commits: https://github.com/pingdotgg/t3code and https://github.com/can1357/oh-my-pi. `signals/` records numbers from that run. No third-party application corpus is bundled. This project's structure (README, agent skill, results write-ups) follows https://github.com/dzhng/jevgrep as a model; no code was copied from it.

## Apache-2.0 material

`evals/vendor/anthropic-skills/build-report-lite.mjs` is copied unchanged from https://github.com/anthropics/skills (`skills/claude-api/shared/evals/report/`, commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`), under the Apache License 2.0. Its license and provenance are in `evals/vendor/anthropic-skills/LICENSE.txt` and `NOTICE.md`. It is the only Apache-2.0 code here. The eval design in `evals/README.md` borrows ideas from that project's `build-eval.md` and `eval-audit.md`, in our own words.

## Names

"Jev" and "TypeSafe" are names of a third-party model and company. This project is unofficial and is not affiliated with, sponsored by or endorsed by them. The model name is used only to say which model the tool asks. Prices and model limits are taken from the public documentation at https://docs.typesafe.ai on the date of each run and can change.
