# Live scan

A user with a TypeSafe key scans a project and gets a queue from real Jev answers.

## Sub-features

- `scan --run --yes --cap-usd N` refuses a worst case above the cap, then sends each planned request once.
- The run folder holds `plan.json`, `run/journal.jsonl`, `report.json` and `queue.md`.
- Every answer comes from the model the plan names.

## How to get to it (user POV)

Set `TYPESAFE_API_KEY`, then run `jevs scan <project> --run --yes --cap-usd 0.01 --out <new directory>`.

## Driving it with the CLI

Preconditions: an approved budget, the key in the environment, and a published commit. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)" 0.01`. The bundled demo app plans 15 requests, about 20,000 input tokens. Read `live-summary.json`: `planned`, `finished` and `succeeded` must be equal, and `model` must be the model you meant to test. Read `live-scan/queue.md` for the items.

## Gotchas

The key reaches only the scan process, through the environment; `commands.log` shows the command without it. Any error stops the run, a 429 included, and there are no retries. P values move a little between calls, so compare the queue's items, not exact probabilities. One run of a synthetic app is a smoke test, not an accuracy measure.
