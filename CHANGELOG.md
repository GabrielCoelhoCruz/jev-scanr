# Changelog

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
