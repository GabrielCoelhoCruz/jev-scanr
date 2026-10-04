# CLI verification map

This map names the visitor paths covered by `../verify.sh`. Use the exact commit, isolated profile, and proof directory from the main skill. Each feature has an observable result, not just a command that returns zero.

- [Pinned GitHub demo](demo.md) checks the documented npx entry point with a fresh cache.
- [Dry scan](dry-scan.md) checks a local project with external networking disabled.
- [Recorded answers](recorded-answers.md) checks offline report and rescore output.
- [Length baseline](baseline.md) checks the stored-report comparison without new inference.
