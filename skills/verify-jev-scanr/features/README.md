# CLI verification map

This map names the visitor paths covered by `../verify.sh`. Use the exact commit, isolated profile, and proof directory from the main skill. Each feature has an observable result, not just a command that returns zero.

- [Pinned GitHub demo](demo.md) checks the documented npx entry point with a fresh cache.
- [Dry scan](dry-scan.md) checks a local project with external networking disabled.
- [Recorded answers](recorded-answers.md) checks offline report and rescore output.
- [Length baseline](baseline.md) checks the stored-report comparison without new inference.
- [Live scan](live-scan.md) sends the demo app to Jev with a cap. Paid and opt-in, through the helper's third argument.

Not tested by the helper: a live scan with `--model`, and which version `jev-latest` resolves to on a given day (only a live scan shows `servedModels`). Also not tested: `jevs run` and `jevs continue` on a live plan, `jevs auth`, `jevs skill`, `jevs signals`, `scan --list-files`, `--paths`, `--experimental` and `--signals`. Report each as NOT TESTED unless you drove it yourself.
