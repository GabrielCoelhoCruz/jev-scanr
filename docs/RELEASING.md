# Releasing

**The package has not been published to npm, and npm publishing is not approved.** Until the maintainer says otherwise, a release is a git tag and nothing else. Install from GitHub at a tag: `npm install -g github:GabrielCoelhoCruz/jev-scanr#vX.Y.Z`.

## Tagging a version

1. Update `version` in `package.json` and `package-lock.json`, `SCANNER_VERSION` in `src/plan.mjs` (and add the old one to `COMPATIBLE_PLAN_VERSIONS`), and `CHANGELOG.md`.
2. `npm ci && npm run ci && python3 -m unittest discover -s test -p test_pinned_config.py`.
3. Update every place that names the version, then check none still names the old one: `grep -rn "<old version>" . --exclude-dir=node_modules --exclude-dir=.git --exclude=package-lock.json`. The ones that matter: the install command and the skill URL (`#vX.Y.Z`, `tree/vX.Y.Z/`) in `README.md`, the install command in `skills/jev-scanr/SKILL.md`, and `jevs skill`, which takes its source from `package.json` (`skillSource` in `src/cli.mjs`). `test/release-pins.test.mjs` fails when any of them lags. Leave `examples/demo-app/expected/` alone: it records the scanner version that made the recording, and `jevs demo` says so. Its `plan.json` names the scanner that wrote it, so keep that version in `COMPATIBLE_PLAN_VERSIONS`; `test/demo-rescore.test.mjs` fails if it is missing.
4. Commit, then `git tag -a vX.Y.Z -m "..."`. Do not move a tag after it is pushed.

## The publish workflow

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) publishes to npm when a `v*` tag is pushed, **but its job only runs when the repository variable `NPM_PUBLISH_ENABLED` is set to `true`**. The variable is not set, and there is no `NPM_TOKEN` secret, so a tag push today runs the workflow's guard and skips the job. To enable npm publishing, the maintainer must decide to, then:

1. Reserve the package name and create an npm automation token with publish rights.
2. Add it as the repository secret `NPM_TOKEN`.
3. Set the repository variable `NPM_PUBLISH_ENABLED` to `true`.
4. Push a version tag.

The job runs the full checks, packs the tarball, checks that the tag matches `package.json`, does a dry-run publish, and only then publishes with provenance. After the first publish, update the README install command to `npm install -g jev-scanr`.

## The README image

`docs/images/demo-queue.png` shows the recorded demo queue. `node scripts/render-demo-image.mjs` redraws `docs/images/demo-queue.svg` from `examples/demo-app/expected/`, and a test fails if the committed SVG differs from that output, so re-record the demo and redraw the image together. The PNG is the SVG rasterized at 2x, 840 by 552 CSS pixels, with headless Chromium, then reduced to 64 colors to keep it near 65 KB:

```sh
chromium --headless=new --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 --window-size=840,552 --screenshot=raw.png file:///path/to/page-containing-the-svg.html
```

The test also checks the PNG's size (1680 by 1104 pixels). Change both numbers if the item count changes.
