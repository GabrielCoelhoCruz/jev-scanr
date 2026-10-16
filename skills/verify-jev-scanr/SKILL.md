---
name: verify-jev-scanr
description: Verify the jev-scanr CLI as an installed GitHub package, including the pinned npx demo, offline replay, dry scan, baseline, and an opt-in paid live scan. Use after changing its CLI, packaging, model, or recorded output.
---

# Verify jev-scanr as a visitor

## Launch

Use Node 24 or newer and npm. From a checkout whose commit exists on GitHub, run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. The helper packs the checkout, installs it in a disposable directory, then launches each CLI command separately. There is no server. Keep other jobs off the machine during npm installation.

## Doctor

Run `node --version && npm --version && git rev-parse HEAD && git status --short && git ls-remote origin | grep "$(git rev-parse HEAD)" && command -v unshare`. Confirm Node is at least 24, the intended commit is on GitHub, the checkout is the version you meant to test, and Linux network namespaces work with `unshare -Urn true`. On another operating system, arrange equivalent outbound network isolation before claiming that a dry run makes no requests. The helper fails rather than asserting network isolation without it.

## Drive

Read [the feature map](features/README.md) before choosing a path. The helper runs the published entry point `npx --yes github:GabrielCoelhoCruz/jev-scanr#<exact SHA> demo` with a new npm cache, plus the locally packed CLI. It exercises `--version`, `demo`, `scan` without `--run`, `rescore`, `report`, and `baseline`. The recorded demo has its own source files and answers, and these paths send no Jev request. A third argument, a cap in US dollars such as `0.01`, adds the paid [live scan](features/live-scan.md) of the demo app; it needs `TYPESAFE_API_KEY` in the environment. Run it only with an approved budget, and count its requests against that budget. The offline proof and the live scan are separate results; neither stands in for the other.

## Evidence

Pass a new directory as the second argument. The helper retains `commands.log`, command output and exit status, a tarball file listing, the exact SHA, and the hashes of the recorded inputs before and after. It asserts the installed version, the replay banner, the dry-run summary with no output folder, the offline report files, and the baseline's original report hash. The dry scan runs inside a network namespace, so an attempted external connection cannot succeed. This verifies the command's observed result and lack of successful external traffic, not an absence of attempted connections. The npm download and pinned npx entry point necessarily use the network before that scan. Inspect both stdout and files, not just an exit code. Do not describe this synthetic recording as measured accuracy.

## Cleanup

The helper removes only its own temporary installation, npm cache, and isolated HOME on exit, including failed runs. It never removes the evidence directory or changes the checkout. Do not delete the proof when cleaning up. Each invocation needs a new evidence directory; the helper refuses to overwrite old evidence.

## Helpers

`verify.sh` is the executable entry point above. On a shared machine, acquire its heavy-job lock around the whole command. It also checks that an installed CLI's baseline excludes synthetic private fields from both outputs. Without the third argument it does not call `scan --run`. It never calls `run`, `continue`, `auth`, `skill`, or the recording script; the feature map lists them as not tested. On an unsupported network-isolation host, document the missing check and use a host-level network block before testing the dry-run claim.
