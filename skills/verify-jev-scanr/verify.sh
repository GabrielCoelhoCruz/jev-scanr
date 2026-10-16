#!/usr/bin/env bash
set -euo pipefail

sha="${1:?pass the exact published commit SHA}"
proof="${2:?pass a new evidence directory}"
live_cap="${3:-}"
live_key="${TYPESAFE_API_KEY:-}"
if [ -n "$live_cap" ] && [ -z "$live_key" ]; then
  echo 'a live scan needs TYPESAFE_API_KEY in the environment' >&2
  exit 1
fi
repo="$(git rev-parse --show-toplevel)"
if [ "$(git -C "$repo" rev-parse HEAD)" != "$sha" ]; then
  echo "HEAD is not $sha" >&2
  exit 1
fi
if [ -n "$(git -C "$repo" status --porcelain)$(git -C "$repo" status --porcelain --ignored -- examples/demo-app)" ]; then
  echo 'the checkout has local changes; the helper packs the working tree, so commit or remove them first' >&2
  git -C "$repo" status --short --ignored -- . ':!node_modules' >&2
  exit 1
fi
if ! GIT_TERMINAL_PROMPT=0 git ls-remote --heads --tags https://github.com/GabrielCoelhoCruz/jev-scanr.git | cut -f1 | grep -qx "$sha"; then
  echo "$sha is not a branch or tag tip on GitHub; push it first" >&2
  exit 1
fi
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
with_key() { TYPESAFE_API_KEY="$live_key" "$@"; }

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
run npx-demo npx --yes --allow-git=all "github:GabrielCoelhoCruz/jev-scanr#$sha" demo
grep -q 'RECORDED RUN' "$proof/npx-demo.stdout"
grep -q '^## 1\.' "$proof/npx-demo.stdout"
run pack npm pack --ignore-scripts --json --pack-destination "$temp"
tarball="$(find "$temp" -maxdepth 1 -name 'jev-scanr-*.tgz' -print -quit)"
test -n "$tarball"
tar --quoting-style=literal -tzf "$tarball" > "$proof/package-files.txt"
grep -qx 'package/cuts.json' "$proof/package-files.txt"
mkdir "$temp/unpacked"
tar -xzf "$tarball" -C "$temp/unpacked"
listed="$(wc -l < "$proof/package-files.txt")"
extracted="$(find "$temp/unpacked" -type f -printf . | wc -c)"
if [ "$listed" -ne "$extracted" ]; then
  echo "the package listing has $listed lines for $extracted regular files, so a packed name contains a newline or an entry is not a regular file" >&2
  exit 1
fi
while IFS= read -r entry; do
  want="$(git -C "$repo" rev-parse --verify --quiet "$sha:${entry#package/}")" || want=
  got="$(git hash-object --no-filters "$temp/unpacked/$entry")" || got=
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "packed ${entry#package/} has no identical blob at $sha" >&2
    exit 1
  fi
done < "$proof/package-files.txt"
echo "every packed file equals its blob at $sha" >> "$proof/commands.log"
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
grep -q '· requested model jev-preview at ' "$proof/dry-scan.stdout"
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
node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.requestedModel!=="jev-1.13.0"||JSON.stringify(r.servedModels)!==JSON.stringify({"jev-1.13.0":15})||r.finishedWithoutServedModel!==0||r.findings.some(f=>f.servedModel!=="jev-1.13.0"))process.exit(1)' "$proof/report-output/report.json"
grep -qF 'Model: requested `jev-1.13.0`; served jev-1.13.0 (15 responses).' "$proof/report-output/report.md"
echo 'offline report keeps the recording requested model jev-1.13.0 and its served model separately' >> "$proof/commands.log"
find "$expected" -type f -print0 | sort -z | xargs -0 sha256sum > "$proof/recording-after.sha256"
cmp "$proof/recording-before.sha256" "$proof/recording-after.sha256"
echo 'recorded files unchanged; proof retained' >> "$proof/commands.log"
if [ -n "$live_cap" ]; then
  run live-scan with_key "$bin" scan "$repo/examples/demo-app" --run --yes --cap-usd "$live_cap" --out "$proof/live-scan"
  test -s "$proof/live-scan/report.json"
  test -s "$proof/live-scan/queue.md"
  test ! -e "$temp/config/jev-scanr"
  node -e 'const fs=require("fs");const d=process.argv[1];const plan=JSON.parse(fs.readFileSync(d+"/plan.json"));const f=fs.readFileSync(d+"/run/journal.jsonl","utf8").trim().split("\n").map(JSON.parse).filter(e=>e.type==="finished");const requested=plan.policy.model,pinned=/^jev-\d+\.\d+\.\d+$/,served={};for(const e of f)if(e.servedModel)served[e.servedModel]=(served[e.servedModel]??0)+1;const ok=e=>e.status==="succeeded"&&e.requestedModel===requested&&pinned.test(e.servedModel)&&e.servedModel===e.response.model&&(!pinned.test(requested)||e.servedModel===requested);const s={requestedModel:requested,servedModels:served,planned:plan.requests.length,finished:f.length,succeeded:f.filter(ok).length,inputTokens:f.reduce((a,e)=>a+(e.usage?.input_tokens??0),0)};fs.writeFileSync(d+"/../live-summary.json",JSON.stringify(s,null,2)+"\n");if(s.finished!==s.planned||s.succeeded!==s.planned)process.exit(1)' "$proof/live-scan"
  echo 'live scan answered every planned request; each answer records the requested model and a concrete served version; key passed only through the environment' >> "$proof/commands.log"
fi
