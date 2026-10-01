# Troubleshooting

Every command here is offline unless it says otherwise. `jevs --help` lists the flags.

## A run stops early (`STOPPED (…)`, exit code 2)

A live run stops at the first error and writes a partial report. When the stop is an error, the summary and `report.md` name the first error: its class, the HTTP status when there is one, and the next step. `report.json` carries the same detail in `failure`, without the error body (bodies can echo a credential, so they are never persisted). A stop can also be the budget cap, which is not an error and has no `failure` entry; its reason is in the summary line.

- **`HTTP 401` / `HTTP 403` (transport error).** The key was refused. Run `jevs auth` to save a working key, or set `TYPESAFE_API_KEY` in the environment. `jevs auth --remove` deletes a saved key. The key is never a command-line option and never appears in a report, a journal or an error line.
- **`HTTP 429` (rate limited).** The service asked you to slow down. The `retry-after` seconds are recorded in `report.json` `failure.retryAfterSeconds`; there are no automatic retries. Wait, then `jevs continue` to plan only what is missing and re-run.
- **`transport_error` with no status.** The request never produced an answer (network or server). Check connectivity and the service status, then re-run.
- **`invalid answer (…)` / `response_validation`.** The model's answer did not match the requested shape (for example `served_model_mismatch`, `unknown_usage`, `invalid_choice`). Nothing is wrong with your key. Re-run; if it repeats, note the code in `failure.validation` and open an issue.
- **`budget_reservation_exceeds_cap`.** The next request could pass your `--cap-usd`, so the run stopped before spending. Raise the cap or shrink the scope (`--exclude`, `--paths`, `--signals`) and continue.

After any stop, `jevs continue --plan PLAN --run-dir RUN --out NEWPLAN` plans only the requests without an accepted answer. The journal blocks a blind retry of a request that was reserved but never answered, on purpose: re-run the same plan to resume instead.

## No key

`No TypeSafe API key. Run jevs auth, or set TYPESAFE_API_KEY in the environment (never pass it as an option)`. The dry run (`jevs scan PATH` with no `--run`) and `jevs demo` need no key and send nothing. Only `scan --run` and `run` talk to the API.

## An invalid `--signals`

`Unknown signal in --signals: <name>. Valid ids: …` lists every id the catalog accepts. `Duplicate signal in --signals: <name>` means the same id was named twice; name each once. `jevs signals` prints the catalog with each signal's status and evidence.

## A stored run or plan that does not match

`jevs report`, `continue` and `rescore` bind stored answers to a request's content (unit and request hash). If the plan given was built from different code, the tool refuses with `The plan given has no request with the content this run answered…` instead of mixing unrelated answers. Pass the plan that the run wrote (`plan.json` beside the journal) or rebuild from the same source.

## An output folder that already exists

A scan refuses to overwrite: `already holds a finished report; choose a new --out to run again`. `rescore` writes `RUN/rescored-<settings>/` and never overwrites; `--out DIR` chooses another folder.

## Cost and the cap

`--cap-usd N` is required for a live run and is the worst case, not the invoice. The dry run prints the estimate and worst case before anything is sent. Costs are calculated from the published tariff and returned token counts, never an invoice. If the worst case exceeds the cap, the run refuses before sending and says so.

## Nothing here worked

`jevs --version` and `jevs demo` run offline and need no key, so they separate a broken install from a broken key or network. If `jevs demo` fails, the install is incomplete (reinstall from the tag); if it works but a live run fails, the cause is the key, the network or the service. Include the exact `report.json` `failure` block when opening an issue.
