#!/usr/bin/env bash
set -euo pipefail

sha="${1:?pass the exact published commit SHA}"
proof="${2:?pass a new evidence directory}"
repo="$(git rev-parse --show-toplevel)"
test "$(git -C "$repo" rev-parse HEAD)" = "$sha"
test ! -e "$proof"
mkdir -p "$proof"
proof="$(cd "$proof" && pwd)"
printf '%s\n' "$sha" > "$proof/source-sha.txt"
temp="$(mktemp -d "${proof%/*}/verify-tmp.XXXXXX")"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/home" "$temp/config" "$temp/cache" "$temp/npm-cache" "$temp/install"
export HOME="$temp/home" XDG_CONFIG_HOME="$temp/config" XDG_CACHE_HOME="$temp/cache" npm_config_cache="$temp/npm-cache"
export npm_config_userconfig="$temp/home/.npmrc" npm_config_globalconfig="$temp/home/global.npmrc"
unset TYPESAFE_API_KEY NPM_TOKEN NODE_AUTH_TOKEN

run() {
  name="$1"
  shift
  printf '%q ' "$@" >> "$proof/commands.log"
  printf '\n' >> "$proof/commands.log"
  if "$@" > "$proof/$name.stdout" 2> "$proof/$name.stderr"; then
    echo "$name exit=0" >> "$proof/commands.log"
  else
    status=$?
    echo "$name exit=$status" >> "$proof/commands.log"
    cat "$proof/$name.stderr" >&2
    exit "$status"
  fi
}

command -v unshare >/dev/null
unshare -Urn true
run npx-demo npx --yes "github:GabrielCoelhoCruz/jev-scanr#$sha" demo
grep -q 'RECORDED RUN' "$proof/npx-demo.stdout"
grep -q '^## 1\.' "$proof/npx-demo.stdout"
run pack npm pack --ignore-scripts --json --pack-destination "$temp"
tarball="$(find "$temp" -maxdepth 1 -name 'jev-scanr-*.tgz' -print -quit)"
test -n "$tarball"
tar -tzf "$tarball" > "$proof/package-files.txt"
grep -qx 'package/cuts.json' "$proof/package-files.txt"
run install npm install --prefix "$temp/install" "$tarball" --ignore-scripts --no-audit --no-fund
bin="$temp/install/node_modules/.bin/jevs"
expected="$temp/install/node_modules/jev-scanr/examples/demo-app/expected"
test -x "$bin"
find "$expected" -type f -print0 | sort -z | xargs -0 sha256sum > "$proof/recording-before.sha256"
run installed-version "$bin" --version
cmp <(printf 'jev-scanr %s\n' "$(node -p "require('$repo/package.json').version")") "$proof/installed-version.stdout"
run installed-demo "$bin" demo
grep -q 'RECORDED RUN' "$proof/installed-demo.stdout"
run dry-scan unshare -Urn "$bin" scan "$repo/examples/demo-app" --out "$temp/dry-output"
grep -q 'Dry run: nothing was sent and nothing was written' "$proof/dry-scan.stdout"
test ! -e "$temp/dry-output"
echo 'dry-scan output directory absent; external networking disabled by unshare -Urn' >> "$proof/commands.log"
run rescore "$bin" rescore "$expected" --cut 0.6 --out "$proof/rescore-output"
run report "$bin" report --plan "$expected/plan.json" --run-dir "$expected" --out "$proof/report-output"
run baseline "$bin" baseline --report "$expected/report.json" --top 5 --out "$proof/baseline-output"
node -e 'const fs=require("fs");const [input,output]=process.argv.slice(1);const doc=JSON.parse(fs.readFileSync(input));doc.privateNote="SECRET_PROOF_MARKER";doc.blocks[0].source="SECRET_PROOF_MARKER";fs.writeFileSync(output,JSON.stringify(doc))' "$expected/report.json" "$proof/hostile-report.json"
run hostile-baseline "$bin" baseline --report "$proof/hostile-report.json" --top 5 --out "$proof/hostile-baseline-output"
if grep -l 'SECRET_PROOF_MARKER' "$proof/hostile-baseline-output/baseline.json" "$proof/hostile-baseline-output/baseline.md"; then
  echo 'private report fields leaked to baseline output' >&2
  exit 1
fi
echo 'hostile private fields excluded from installed CLI baseline outputs' >> "$proof/commands.log"
for path in "$proof/rescore-output/queue.md" "$proof/rescore-output/report.json" "$proof/report-output/queue.md" "$proof/report-output/report.json" "$proof/baseline-output/baseline.md" "$proof/baseline-output/baseline.json"; do
  test -s "$path"
done
node -e 'const fs=require("fs"),crypto=require("crypto");const [report,result]=process.argv.slice(1);const original=crypto.createHash("sha256").update(fs.readFileSync(report)).digest("hex");if(JSON.parse(fs.readFileSync(result)).inputs.reportSha256!==original)process.exit(1)' "$expected/report.json" "$proof/baseline-output/baseline.json"
grep -q 'It does not measure the quality' "$proof/baseline-output/baseline.md"
find "$expected" -type f -print0 | sort -z | xargs -0 sha256sum > "$proof/recording-after.sha256"
cmp "$proof/recording-before.sha256" "$proof/recording-after.sha256"
echo 'recorded files unchanged; proof retained' >> "$proof/commands.log"
