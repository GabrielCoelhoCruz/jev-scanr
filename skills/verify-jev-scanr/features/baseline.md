# Length baseline

A visitor compares the order by function length with the stored Jev order on one report.

## Sub-features

- `baseline` writes a Markdown comparison and a structured comparison.
- The comparison retains the input report's SHA-256 and labels its limits.

## How to get to it (user POV)

Run `jevs baseline --report <installed package>/examples/demo-app/expected/report.json --top 5 --out <new directory>`.

## Driving it with the CLI

Preconditions: install the package and use its saved report. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. Inspect `baseline.stdout`, `baseline.md`, and `baseline.json`. Require the JSON input hash to equal the SHA-256 of the original saved report and the Markdown to name the output limitation.

## Gotchas

Overlap is descriptive and has no accuracy label. An unscored function is a gap, not a zero probability.
