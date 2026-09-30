# Changelog

## 0.3.1-alpha

- **The recorded demo matches the defaults.** `examples/demo-app/expected/` is one new real run (`jev-1.13.0`, 15 of 15 requests, US$0.0008 calculated) that asks only the three default signals. It flagged four of the five questions seeded on purpose and missed one (`registerUser` for `function_should_split`, 0.52); no clean function reached the cut. Before recording, two demo functions that belonged to now-experimental signals (`tally`, `findTagged`) were replaced by `registerUser` and a long but cohesive `renderInvoiceText`, keeping the request count at 15. The drift test and the README snippets follow the recording.
- Dependencies: `ajv` 8.20.0, `prettier` 3.9.9 and `@babel/parser` 7.29.9 (the retained license notices are refreshed; the license texts did not change), and the `actions/checkout` and `actions/setup-node` v7 updates. `@babel/traverse` stays on 7.28.5: version 8 changed which functions get indexed on real code when paired with the parser 7 we use, and changed a few similar-pair units even with parser 8.
- No change to questions, scoring or scan behavior. Plans from 0.1.0-alpha to 0.3.0-alpha still verify.

## 0.3.0-alpha

**Breaking: renamed from `jev-refactor` to `jev-scanr`.** The commands are now `jev-scanr` and the short alias `jevs` (the `jr` alias is gone; `jr` is also an unrelated npm package). The GitHub repository moved to `GabrielCoelhoCruz/jev-scanr` and the old URL redirects. The agent skill is now `skills/jev-scanr/` (`npx skills add GabrielCoelhoCruz/jev-scanr --skill jev-scanr`; reinstall it to replace the old one).

- **Defaults changed to match the independent test.** Only `clone_same_policy`, `function_should_split` and `function_multiple_responsibilities` are on by default. `magic_policy_literal`, `internal_duplication`, `unused_local_or_parameter` and `deep_nesting` are experimental (`--experimental` or `--signals`). Each signal file records its independent-test result in `independentTest`; `jevs signals` and the README show it first and the development run second. A default-band check is now a test.
- **Output goes outside the project by default.** `--out` defaults to a folder under `~/.cache/jev-scanr` named after the project and plan, and the dry run prints it; rerunning the same plan resumes that folder. Before, the default was inside the project and was refused.
- The help now says `--run-dir RUN` for `report` and `continue` (what the parser accepts), lists `--run`, `--yes` and `--cap-usd`, and `--help` works after any command.
- `scan` refuses a file or a missing directory as PATH in plain words, and prints file statuses in words (for example "skipped as possible secrets (content not read)"); `--list-files` also lists the files skipped and why.
- `jevs skill` pins the skills CLI (1.7.0) and installs the skill from this release's tag instead of the main branch.
- The gate rule's explanatory text in `evals/gate.json` was reworded (no behavior change); its pinned hash in `CONTRIBUTING.md` changed.
- Documentation: the README leads with the benefit and moves the measurements to their own section; a "When to use something else" section; a "Related" section crediting jevgrep; a glossary in `EVIDENCE.md`; internal wording removed from the public documents.
- CI also runs on macOS; the npm package no longer ships the evaluation tools, fixtures or development scripts; Dependabot is configured.
- `jevs auth` and the key file moved to `$XDG_CONFIG_HOME/jev-scanr/credentials.json` (default `~/.config/jev-scanr/`). An existing `jev-refactor` key is moved there the first time a key is needed, keeping mode 0600 (an old file readable by others is refused); `jevs auth --remove` deletes both.
- `jevs --version`, `-V` and `jevs version` print the version.
- Documentation: until the package is published to npm, never run `npx jev-scanr` or `npx jevs` (npx would fetch whatever package owns that name), and never run `npx jr`; use the installed commands or `npx github:GabrielCoelhoCruz/jev-scanr`. A test fails if a tracked text file says otherwise.
- The README and the showcase write-up record that one showcase candidate led to a bug reproduced with a regression test and an open, unmerged pull request (can1357/oh-my-pi#13847).
- The schema identifiers `semantic-refactor-scan-plan/1` and `semantic-refactor-scan-report/1` keep their names, because plans and the recorded demo are bound to them by hash. Plans from 0.1.0-alpha, 0.1.1 and 0.2.0-alpha still verify. No signal, question or scan behavior changed.

## 0.2.0-alpha

- **Renamed to `jev-refactor`** (was `semantic-refactor-scan`). The command is `jev-refactor`, with the short alias `jr`. Schema identifiers (`semantic-refactor-scan-plan/1`, `semantic-refactor-scan-report/1`) keep their names, because plans and the recorded demo are bound to them by hash. Plans from 0.1.0-alpha and 0.1.1 still verify.
- `jr auth` saves your TypeSafe API key in an owner-only file (`~/.config/jev-refactor/credentials.json`, mode 0600; a file readable by others is refused); `jr auth --remove` deletes it. `TYPESAFE_API_KEY` in the environment still wins. The key is never a command-line option.
- `jr skill` installs the agent skill `skills/jev-refactor/SKILL.md` through `npx skills`. The skill tells an agent when to scan, to ask for a cost cap first, and to verify each queue item before editing.
- Evals: a `human-labels/1` file must say `"labelerKind": "human"` and cannot name a model as labeler, so LLM labels cannot be counted as human. The gate rule in `evals/gate.json` gains a release outcome (4 or more default signals: stable; exactly 3: stay alpha; labels not from a person or calibrated judge: not decidable). Its pinned hash changed; see `CONTRIBUTING.md`.
- Documentation: `README.md` restructured; `EVIDENCE.md` is now an index over `evals/results/`; `docs/DESIGN.md` became `docs/architecture.md`; issue and pull request templates; a publish workflow that is disabled until an npm release is approved.
- Scan behavior, questions and signals are unchanged from 0.1.1.

## 0.1.1

- `--paths dir1,dir2` scans only the given directories or files. Units and context come only from them. Files outside are counted, not read.
- The dry run prints coverage next to the cost (`read X of Y source files (Z%)`), and names which directories the 500-file cap skipped. `report.md` and `report.json` carry the same coverage, so a partial scan cannot look complete.
- Bounded concurrency: `--concurrency N` (default 8, at most 32) with a token-bucket limiter at 80% of Jev's documented 40 requests and 100K tokens per second. Each in-flight request reserves its worst-case cost before dispatch, the journal stays write-ahead and valid when requests overlap, and any error (a 429 included) stops new dispatch. There are still no automatic retries. A 429's `retry-after` is recorded, not obeyed.
- Requests are split only when Jev's provider budget requires it. The 24,000-byte trim target is unchanged, so requests at or under it are byte-identical to 0.1.0-alpha. A focus above the target but inside a new 64,000-byte hard cap is sent whole instead of being windowed. On the daily-tracker, t3code and oh-my-pi scans, no unit is split any more (0.29%, 0.13% and 0.66% were).
- **The function index no longer stops at 3,000 functions silently.** The cap (nested functions and test functions count) is now 12,000, and when a lower `limits` value or a very large slice still reaches it, the dry run and the report say `NOT INDEXED` and name the directories. A unit-limit overflow is reported as `NOT PACKED`. Scans of large projects under 0.1.0-alpha were affected: units came only from the files indexed before the cap. Re-scan them.
- Plans from 0.1.0-alpha still verify. No signal or question changed.

## 0.1.0-alpha

First public cut, from the author's earlier prototype. Jev-only pipeline; 22 → 8 questions.

- Default catalog: 7 signals (`clone_same_policy`, `function_should_split`, `magic_policy_literal`, `internal_duplication`, `function_multiple_responsibilities`, `unused_local_or_parameter`, `deep_nesting`). `unreachable_code` is experimental and opt-in. The other 14 are retired, listed with their evidence in `signals/retired.md`.
- Unit kinds: functions, line windows of very long functions, and similar pairs. Catch-block, comment-block and sibling units are gone.
- One command: `scan PATH` is a dry run with a request and cost estimate; `--run --yes --cap-usd N` sends. Outputs: `report.json`, `report.md`, `queue.md`.
- Answer validation accepts a chosen option within 0.01 of the maximum (Jev rounds to two decimals) and flags it `near tie`.
- Continuations for stopped runs, with combined accounting.
- One file per question under `signals/`, with fixtures, a live sanity check (`scripts/check-signal.mjs`) and a written gate for going on by default.
- `evals/`: test a signal the way we did. Case sets with label sources, oracle / null / no-answer / induced-error / served-model checks, noise floor next to every rate, P-variance measurement, an LLM-judge protocol with known-negative controls and calibration against human labels, and a pre-registered gate. Results use the layout of Anthropic's eval report builder (vendored, Apache-2.0).
- `examples/demo-app/`: a small synthetic app with seeded problems, plus one real recorded run (`expected/`).
- Removed experimental modes from the prototype that are not part of this tool.
