# Vendored from anthropics/skills

`build-report-lite.mjs` is copied **unchanged** from
https://github.com/anthropics/skills/blob/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/claude-api/shared/evals/report/build-report-lite.mjs
(repository commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, file SHA-256 `af79ca5fa5f06747dbcaa1d40017c8c8e81e0aa11cb8e32b848043893cdb03c7`).

It is licensed under the Apache License 2.0, in [`LICENSE.txt`](LICENSE.txt) (the license file of the `claude-api` skill it comes from). This directory is the only Apache-2.0 code in this repository. The rest is MIT. No changes were made to the file. If you change it, note the change here, as the license requires.

It turns an eval run directory (`baseline/results.jsonl`, `errors.jsonl`, `traces/`) into a single static `report.html`. Our eval runner writes that layout. Field names follow that project's `report/SCHEMA.md` ("hillclimb/v2"). The eval design in [`../../README.md`](../../README.md) borrows ideas from that project's `build-eval.md` and `eval-audit.md` (oracle and null checks, "no answer is not a negative", served-model assertion, noise floor, judge calibration), written here in our own words for this task.
