# Recorded answers

A visitor can change the cut or regenerate a report from a recorded run without sending source.

## Sub-features

- `rescore` writes a new queue with different bands.
- `report` writes a new queue and report from the saved plan and journal.
- The regenerated report keeps the recording's requested model and served model apart: `requestedModel: "jev-1.13.0"`, `servedModels: {"jev-1.13.0": 15}`, and `servedModel` on each finding. The served value comes from the stored answers, not from the request.

## How to get to it (user POV)

Use `jevs rescore <installed package>/examples/demo-app/expected --cut 0.6 --out <new directory>` or `jevs report --plan <expected>/plan.json --run-dir <expected> --out <new directory>`.

## Driving it with the CLI

Preconditions: use the installed package and its recorded files. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. Inspect `rescore.stdout`, `report.stdout`, and the two resulting directories in the proof directory. Require `queue.md` and `report.json` in each output directory. The helper checks the model fields of `report-output/report.json` and the `Model:` line of `report-output/report.md`.

## Gotchas

Both output directories must be new. The helper hashes every recorded file before and after these commands to detect accidental mutation.
