#!/usr/bin/env node
// Offline check of the low-overlap candidate source (src/low-overlap.mjs) against the constructed contrast
// units. Makes no request and needs no key. Two views:
//   pair level   each contrast pair on its own: would the source propose it, with no cap.
//   repo level   the contrast copies planted into a 500-file slice of their pinned repository, then the
//                scanner's own retrieval run over the slice with the default cap.
//
//   node evals/retrieval/validate.mjs --repos DIR --project DIR --controls-project DIR
//        [--out result.json] [--markdown] [--check]
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { buildIndex } from "../../src/index.mjs";
import { generateCandidates } from "../../src/candidates.mjs";
import {
  LOW_OVERLAP_DEFAULTS,
  decidePair,
  profile,
} from "../../src/low-overlap.mjs";
import { readSnapshot, sourcePath, testPath } from "../../src/snapshot.mjs";
import { wilson } from "../lib/stats.mjs";

const here = new URL("./", import.meta.url);
const contrast = new URL("../contrast/", import.meta.url);
export const RETRIEVAL = {
  minLines: 8,
  minJaccard: 0.45,
  minSizeRatio: 0.5,
  ...LOW_OVERLAP_DEFAULTS,
};
export const SLICE_FILES = 440;
const REPO_DIRS = {
  "paulrobello/claude-office": "claude-office",
  "reshaped-ui/reshaped": "reshaped",
  "pingdotgg/t3code": "t3code",
  "can1357/oh-my-pi": "oh-my-pi",
};
const NESTED = /Function|Method/;

const round = (x) => (x === null ? null : Math.round(x * 1e4) / 1e4);
const rate = (k, n) => ({
  k,
  n,
  rate: n ? round(k / n) : null,
  ...(n ? { wilson95: Object.values(wilson(k, n)).map(round) } : {}),
});

function outermostByPath(index) {
  const byPath = new Map();
  for (const f of index.functions)
    if (!f.ancestors.some((a) => NESTED.test(a.type))) byPath.set(f.path, f);
  return byPath;
}

export function pairLevel(setDir, units) {
  const index = buildIndex(readSnapshot(setDir)),
    byPath = outermostByPath(index),
    rows = [];
  for (const u of units) {
    const [a, b] = u.files.map((f) => byPath.get(f.path));
    if (!a || !b) throw Error(`unit ${u.id}: function not found`);
    const d =
      Math.min(a.lines, b.lines) < RETRIEVAL.minLines
        ? { pass: false, reason: "short" }
        : decidePair([a, profile(a)], [b, profile(b)], RETRIEVAL);
    rows.push({ unit: u, ...d });
  }
  const summarize = (list) => {
    const why = {};
    for (const r of list) why[r.reason] = (why[r.reason] ?? 0) + 1;
    return {
      ...rate(list.filter((r) => r.pass).length, list.length),
      reasons: Object.fromEntries(Object.entries(why).sort()),
    };
  };
  return {
    positives: summarize(rows.filter((r) => r.unit.label === 1)),
    negatives: summarize(rows.filter((r) => r.unit.label === 0)),
    hardNegatives: summarize(
      rows.filter(
        (r) => r.unit.label === 0 && r.unit.features.surfaceJaccard >= 0.8,
      ),
    ),
    scores: {
      positives: rows
        .filter((r) => r.unit.label === 1 && r.score !== undefined)
        .map((r) => round(r.score))
        .sort((x, y) => x - y),
      negatives: rows
        .filter((r) => r.unit.label === 0 && r.score !== undefined)
        .map((r) => round(r.score))
        .sort((x, y) => x - y),
    },
  };
}

export function sliceOf(repoDir, originals, planted, into) {
  const all = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\0")
    .filter((p) => p && sourcePath(p) && !testPath(p))
    .sort();
  const need = [...new Set(originals)],
    chosen = [...need];
  for (const p of all) {
    if (chosen.length >= SLICE_FILES) break;
    if (!need.includes(p)) chosen.push(p);
  }
  for (const p of chosen) {
    mkdirSync(dirname(join(into, p)), { recursive: true });
    cpSync(join(repoDir, p), join(into, p));
  }
  planted.forEach((file, i) => {
    const target = join(into, "__planted__", `p${i}.${file.ext}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file.path));
  });
  return chosen.length;
}

export function repoLevel(root, planted, originals) {
  const index = buildIndex(readSnapshot(root)),
    result = generateCandidates(index, {});
  const low = result.candidates.filter((c) => c.facts.retrievalSource);
  const isPlanted = (f) => f.path.startsWith("__planted__/");
  const ranks = planted.map((_, i) => {
    const k = low.findIndex((c) =>
      c.members.some((m) => m.path.startsWith(`__planted__/p${i}.`)),
    );
    const partner = k < 0 ? null : low[k].members.find((m) => !isPlanted(m));
    return k >= 0 &&
      partner.path === originals[i].path &&
      partner.range.startLine === originals[i].startLine
      ? k + 1
      : null;
  });
  const natural = index.functions.filter(
    (f) => !f.test && f.lines >= RETRIEVAL.minLines && !isPlanted(f),
  );
  const profiles = new Map(natural.map((f) => [f, profile(f)]));
  let pairs = 0,
    passing = 0;
  for (let i = 0; i < natural.length; i++)
    for (let j = i + 1; j < natural.length; j++) {
      pairs++;
      const a = natural[i],
        b = natural[j];
      if (
        decidePair([a, profiles.get(a)], [b, profiles.get(b)], RETRIEVAL).pass
      )
        passing++;
    }
  const naturalLow = low.filter((c) => !c.members.some(isPlanted)).length,
    uncapped = generateCandidates(index, { lowOverlap: { cap: 2000 } });
  const indexed = uncapped.candidates.filter(
    (c) => c.facts.retrievalSource && !c.members.some(isPlanted),
  ).length;
  const found = ranks.filter((r) => r !== null).sort((x, y) => x - y);
  return {
    pool: natural.length,
    planted: planted.length,
    found: found.length,
    ranks: found,
    maxRank: found.at(-1) ?? null,
    cap: RETRIEVAL.cap,
    proposedLowOverlap: low.length,
    proposedPlantedOnly: low.filter((c) => c.members.some(isPlanted)).length,
    proposedNatural: naturalLow,
    precisionLowerBound: low.length ? round(found.length / low.length) : null,
    sameRepoPairs: {
      ...rate(passing, pairs),
      note: "every pair of functions of the slice with at least 8 lines, planted copies excluded, tested exhaustively",
      foundByIndex: indexed,
    },
    stats: result.stats.lowOverlap,
    omitted: result.omitted
      .filter((o) => o.reason.startsWith("low_overlap"))
      .map((o) => o.reason),
  };
}

export function validate({ repos, project, controlsProject }) {
  const units = JSON.parse(readFileSync(new URL("units.json", contrast)));
  const controls = JSON.parse(readFileSync(new URL("controls.json", contrast)));
  const bUnits = units.units.filter((u) => u.set === "B");
  const b2Negatives = controls.units.filter(
    (u) => u.set === "B2" && u.label === 0,
  );
  const result = {
    schema: "retrieval-validation/1",
    retrieval: RETRIEVAL,
    sliceFiles: SLICE_FILES,
    pinned: units.pinned,
    pairLevel: {
      B: pairLevel(join(project, "B"), bUnits),
      B2: pairLevel(join(controlsProject, "B2"), b2Negatives),
    },
    repos: {},
  };
  const planted = bUnits.filter((u) => u.label === 1);
  for (const [repo, dir] of Object.entries(REPO_DIRS)) {
    const mine = planted.filter((u) => u.source[0].repo === repo);
    const work = mkdtempSync(join(tmpdir(), "retrieval-slice-"));
    try {
      sliceOf(
        join(repos, dir),
        mine.map((u) => u.source[0].path),
        mine.map((u) => ({
          ext: u.files[0].path.split(".").pop(),
          path: join(
            project,
            "B",
            u.files[u.recipe.transformedIsPair === "a" ? 0 : 1].path,
          ),
        })),
        work,
      );
      result.repos[repo] = repoLevel(
        work,
        mine,
        mine.map((u) => u.source[0]),
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const all = Object.values(result.repos);
  result.totals = {
    planted: all.reduce((n, r) => n + r.planted, 0),
    found: all.reduce((n, r) => n + r.found, 0),
    maxRank: Math.max(...all.map((r) => r.maxRank)),
  };
  return result;
}

export function markdown(result) {
  const pct = (r) =>
    r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(0)}%`;
  const lines = [
    "# Low-overlap retrieval: offline validation",
    "",
    `Options: ${JSON.stringify(result.retrieval)}. No Jev call was made.`,
    "",
    "## Pair level (no cap)",
    "",
    "| Set | Positives proposed | Negatives proposed | Hard negatives (surface overlap at least 0.8) proposed |",
    "| --- | --- | --- | --- |",
    ...Object.entries(result.pairLevel).map(
      ([set, p]) =>
        `| ${set} | ${p.positives.k}/${p.positives.n} (${pct(p.positives)}) | ${p.negatives.k}/${p.negatives.n} (${pct(p.negatives)}) | ${p.hardNegatives.k}/${p.hardNegatives.n} |`,
    ),
    "",
    "## Repo level (copies planted into a slice of the pinned repository, default cap)",
    "",
    "| Repository | Planted | Proposed | Worst rank | Low-overlap pairs proposed | Natural pairs passing the filter / all pairs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...Object.entries(result.repos).map(
      ([repo, r]) =>
        `| ${repo} | ${r.planted} | ${r.found} | ${r.maxRank} of ${r.cap} | ${r.proposedLowOverlap} | ${r.sameRepoPairs.k} / ${r.sameRepoPairs.n} (${(r.sameRepoPairs.rate * 100).toFixed(2)}%) |`,
    ),
    "",
    `Total: ${result.totals.found} of ${result.totals.planted} planted copies proposed, worst rank ${result.totals.maxRank}.`,
  ];
  return lines.join("\n") + "\n";
}

function main() {
  const { values } = parseArgs({
    options: {
      repos: { type: "string" },
      project: { type: "string" },
      "controls-project": { type: "string" },
      out: { type: "string" },
      markdown: { type: "boolean" },
      check: { type: "boolean" },
    },
  });
  if (!values.repos || !values.project || !values["controls-project"])
    throw Error(
      "Usage: validate.mjs --repos DIR --project DIR --controls-project DIR [--out FILE] [--markdown] [--check]",
    );
  const result = validate({
    repos: values.repos,
    project: values.project,
    controlsProject: values["controls-project"],
  });
  const out = values.out ?? new URL("result.json", here).pathname;
  const text = JSON.stringify(result, null, 2) + "\n";
  if (values.check) {
    if (!existsSync(out)) throw Error(`${out} does not exist`);
    deepStrictEqual(JSON.parse(readFileSync(out, "utf8")), JSON.parse(text));
    console.log("result.json is what a fresh validation gives");
    return;
  }
  if (values.markdown) process.stdout.write(markdown(result));
  else writeFileSync(out, text);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
