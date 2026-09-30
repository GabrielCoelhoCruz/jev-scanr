# Releasing

**The package has not been published to npm, and npm publishing is not approved.** Until the maintainer says otherwise, a release is a git tag and nothing else. Install from GitHub at a tag: `npm install -g github:GabrielCoelhoCruz/jev-scanr#vX.Y.Z`.

## Tagging a version

1. Update `version` in `package.json` and `package-lock.json`, `SCANNER_VERSION` in `src/plan.mjs` (and add the old one to `COMPATIBLE_PLAN_VERSIONS`), and `CHANGELOG.md`.
2. `npm ci && npm run ci && python3 -m unittest discover -s test -p test_pinned_config.py`.
3. Commit, then `git tag -a vX.Y.Z -m "..."`. Do not move a tag after it is pushed.

## The publish workflow

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) publishes to npm when a `v*` tag is pushed, **but its job only runs when the repository variable `NPM_PUBLISH_ENABLED` is set to `true`**. The variable is not set, and there is no `NPM_TOKEN` secret, so a tag push today runs the workflow's guard and skips the job. To enable npm publishing, the maintainer must decide to, then:

1. Reserve the package name and create an npm automation token with publish rights.
2. Add it as the repository secret `NPM_TOKEN`.
3. Set the repository variable `NPM_PUBLISH_ENABLED` to `true`.
4. Push a version tag.

The job runs the full checks, packs the tarball, checks that the tag matches `package.json`, does a dry-run publish, and only then publishes with provenance. After the first publish, update the README install command to `npm install -g jev-scanr`.
