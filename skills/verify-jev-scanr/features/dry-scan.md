# Dry scan

A visitor estimates the requests and cost of scanning the bundled project before sending source.

## Sub-features

- `scan` prints counts and an estimated cost without creating the proposed output folder.
- External networking is unavailable to this process during the scan.

## How to get to it (user POV)

After installing the tarball, run `jevs scan examples/demo-app --out <new directory>` without `--run`.

## Driving it with the CLI

Preconditions: run the doctor and start from a clean evidence directory. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. Read `dry-scan.stdout` for the request count and `Dry run: nothing was sent and nothing was written.` Require the proposed output directory to be absent in `commands.log`.

## Gotchas

The pinned npx install contacts GitHub and npm. Isolate only the installed CLI scan after dependencies exist. An unavailable network namespace means the no-egress claim remains unproved on this host.
