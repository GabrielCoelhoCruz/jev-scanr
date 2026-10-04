# Recorded answers

A visitor can change the cut or regenerate a report from a recorded run without sending source.

## Sub-features

- `rescore` writes a new queue with different bands.
- `report` writes a new queue and report from the saved plan and journal.

## How to get to it (user POV)

Use `jevs rescore <installed package>/examples/demo-app/expected --cut 0.6 --out <new directory>` or `jevs report --plan <expected>/plan.json --run-dir <expected> --out <new directory>`.

## Driving it with the CLI

Preconditions: use the installed package and its recorded files. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. Inspect `rescore.stdout`, `report.stdout`, and the two resulting directories in the proof directory. Require `queue.md` and `report.json` in each output directory.

## Gotchas

Both output directories must be new. The helper hashes every recorded file before and after these commands to detect accidental mutation.
