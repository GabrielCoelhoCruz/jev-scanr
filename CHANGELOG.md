# Changelog

## 0.1.1

- `--paths dir1,dir2` scans only the given directories or files. Units and context come only from them. Files outside are counted, not read.
- The dry run prints coverage next to the cost (`read X of Y source files (Z%)`), and names which directories the 500-file cap skipped. `report.md` and `report.json` carry the same coverage, so a partial scan cannot look complete.
- Bounded concurrency: `--concurrency N` (default 8, at most 32) with a token-bucket limiter at 80% of Jev's documented 40 requests and 100K tokens per second. Each in-flight request reserves its worst-case cost before dispatch, the journal stays write-ahead and valid when requests overlap, and any error (a 429 included) stops new dispatch. There are still no automatic retries. A 429's `retry-after` is recorded, not obeyed.
- Requests are split only when Jev's provider budget requires it. The 24,000-byte trim target is unchanged, so requests at or under it are byte-identical to 0.1.0-alpha. A focus above the target but inside a new 64,000-byte hard cap is sent whole instead of being windowed. On the daily-tracker, t3code and oh-my-pi scans, no unit is split any more (0.29%, 0.13% and 0.66% were).
- **The function index no longer stops at 3,000 functions silently.** The cap (nested functions and test functions count) is now 12,000, and when a lower `limits` value or a very large slice still reaches it, the dry run and the report say `NOT INDEXED` and name the directories. A unit-limit overflow is reported as `NOT PACKED`. Scans of large projects under 0.1.0-alpha were affected: units came only from the files indexed before the cap. Re-scan them.
- Plans from 0.1.0-alpha still verify. No signal or question changed.

## 0.1.0-alpha

First public cut, from the Semantic Scanner prototype 0.4.1. Jev-only pipeline; 22 → 8 questions.

- Default catalog: 7 signals (`clone_same_policy`, `function_should_split`, `magic_policy_literal`, `internal_duplication`, `function_multiple_responsibilities`, `unused_local_or_parameter`, `deep_nesting`). `unreachable_code` is experimental and opt-in. The other 14 are retired, listed with their evidence in `signals/retired.md`.
- Unit kinds: functions, line windows of very long functions, and similar pairs. Catch-block, comment-block and sibling units are gone.
- One command: `scan PATH` is a dry run with a request and cost estimate; `--run --yes --cap-usd N` sends. Outputs: `report.json`, `report.md`, `queue.md`.
- Answer validation accepts a chosen option within 0.01 of the maximum (Jev rounds to two decimals) and flags it `near tie`.
- Continuations for stopped runs, with combined accounting.
- One file per question under `signals/`, with fixtures, a live sanity check (`scripts/check-signal.mjs`) and a written gate for going on by default.
- `evals/`: test a signal the way we did. Case sets with label sources, oracle / null / no-answer / induced-error / served-model checks, noise floor next to every rate, P-variance measurement, an LLM-judge protocol with known-negative controls and calibration against human labels, and a pre-registered gate. Results use the layout of Anthropic's eval report builder (vendored, Apache-2.0).
- `examples/demo-app/`: a small synthetic app with seeded problems, plus one real recorded run (`expected/`).
- Removed from the prototype: the 0.2 and 0.3 modes, deterministic ranking arms, the narrator control, the Claude handoff pack, the hard-coded exclusions of the author's private files.
