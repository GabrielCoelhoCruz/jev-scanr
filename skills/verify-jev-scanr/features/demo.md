# Pinned GitHub demo

The first-time visitor downloads an exact GitHub commit and sees the recorded queue without configuring an API key.

## Sub-features

- A pinned npx launch shows `RECORDED RUN` and the bundled queue.
- A local package install supplies `jevs --version` and the same replay.

## How to get to it (user POV)

Run `npx --yes github:GabrielCoelhoCruz/jev-scanr#<exact SHA> demo`. For the local tarball, run `jevs demo` after installing it.

## Driving it with the CLI

Preconditions: publish the exact commit to GitHub. Run `bash skills/verify-jev-scanr/verify.sh "$(git rev-parse HEAD)" "$HOME/.capy/work/scanr-proof-$(date +%s)"`. Read `npx-demo.stdout`, `installed-version.stdout`, and `installed-demo.stdout` from the proof directory. Require `RECORDED RUN`, the queue, and the version from `package.json`.

## Gotchas

An old npm cache can make a GitHub installation look successful. The helper uses a fresh cache and an isolated HOME. The printed probabilities are from a saved synthetic run, not new accuracy evidence.
