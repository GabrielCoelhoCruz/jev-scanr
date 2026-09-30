#!/usr/bin/env node
// Offline check of the name-word cue (src/name-cue.mjs) that decides which functions name_vs_behavior asks
// about. Makes no request and needs no key.
//   constructed   the contrast set C units carry the cue by construction; this counts them from units.json.
//   selectivity   the share of each pinned repository's functions the cue lets through.
//   recall        a function renamed to a random unrelated name from the same repository: how often the cue
//                 still lets it through. The donor is any other function whose name shares no word with the
//                 original, unlike set C, where the donor's words also had to be absent from the body.
//
//   node evals/retrieval/names.mjs --repos DIR [--out FILE] [--markdown] [--check]
import { deepStrictEqual } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { buildIndex } from "../../src/index.mjs";
import { nameCue, nameWords } from "../../src/name-cue.mjs";
import { readSnapshot } from "../../src/snapshot.mjs";
import { mulberry32, wilson } from "../lib/stats.mjs";

export const SEED = 20260930;
export const SAMPLE = 300;
const REPOS = {
  "paulrobello/claude-office": "claude-office",
  "reshaped-ui/reshaped": "reshaped",
  "pingdotgg/t3code": "t3code",
  "can1357/oh-my-pi": "oh-my-pi",
};
const NESTED = /Function|Method/;
const round = (x) => Math.round(x * 1e4) / 1e4;
const rate = (k, n) => ({
  k,
  n,
  rate: n ? round(k / n) : null,
  ...(n ? { wilson95: Object.values(wilson(k, n)).map(round) } : {}),
});

export function measure(index, seed = SEED, sample = SAMPLE) {
  const named = index.functions.filter(
    (f) =>
      !f.test &&
      f.name &&
      !f.ancestors.some((a) => NESTED.test(a.type)) &&
      nameWords(f.name).size,
  );
  const own = named.map((f) => nameCue(index, f).absent);
  const random = mulberry32(seed);
  const picked = [...named.keys()]
    .map((i) => [random(), i])
    .sort((a, b) => a[0] - b[0])
    .slice(0, sample)
    .map(([, i]) => i);
  let renamedPass = 0,
    originalPass = 0;
  for (const i of picked) {
    const words = nameWords(named[i].name);
    const donors = named.filter(
      (d) => ![...nameWords(d.name)].some((w) => words.has(w)),
    );
    const donor = donors[Math.floor(random() * donors.length)];
    if (nameCue(index, named[i], donor.name).absent) renamedPass++;
    if (own[i]) originalPass++;
  }
  return {
    named: named.length,
    selectivity: rate(own.filter(Boolean).length, named.length),
    sampled: picked.length,
    originalsPassingInSample: rate(originalPass, picked.length),
    renamedPassing: rate(renamedPass, picked.length),
  };
}

export function validate(repos) {
  const units = JSON.parse(
    readFileSync(new URL("../contrast/units.json", import.meta.url)),
  ).units.filter((u) => u.set === "C");
  const result = {
    schema: "name-cue-validation/1",
    seed: SEED,
    sample: SAMPLE,
    constructed: {
      positives: rate(
        units.filter(
          (u) => u.label === 1 && u.features.nameWordsMissingFromBody === 1,
        ).length,
        units.filter((u) => u.label === 1).length,
      ),
      controls: rate(
        units.filter(
          (u) => u.label === 0 && u.features.nameWordsMissingFromBody === 1,
        ).length,
        units.filter((u) => u.label === 0).length,
      ),
    },
    repos: {},
  };
  for (const [repo, dir] of Object.entries(REPOS))
    result.repos[repo] = measure(buildIndex(readSnapshot(`${repos}/${dir}`)));
  const all = Object.values(result.repos);
  const sum = (pick) => all.reduce((n, r) => n + pick(r), 0);
  result.pooled = {
    selectivity: rate(
      sum((r) => r.selectivity.k),
      sum((r) => r.named),
    ),
    renamedPassing: rate(
      sum((r) => r.renamedPassing.k),
      sum((r) => r.sampled),
    ),
    originalsPassingInSample: rate(
      sum((r) => r.originalsPassingInSample.k),
      sum((r) => r.sampled),
    ),
  };
  return result;
}

export function markdown(result) {
  const pct = (r) => `${(r.rate * 100).toFixed(1)}% (${r.k}/${r.n})`;
  return (
    [
      "# Name-word cue: offline validation",
      "",
      `Constructed set C: cue true for ${pct(result.constructed.positives)} of renamed functions and ${pct(result.constructed.controls)} of originals, by construction. No Jev call was made.`,
      "",
      "| Repository | Named functions | Let through by the cue | Renamed to an unrelated name, let through |",
      "| --- | --- | --- | --- |",
      ...Object.entries(result.repos).map(
        ([repo, r]) =>
          `| ${repo} | ${r.named} | ${pct(r.selectivity)} | ${pct(r.renamedPassing)} |`,
      ),
      `| all | ${Object.values(result.repos).reduce((n, r) => n + r.named, 0)} | ${pct(result.pooled.selectivity)} | ${pct(result.pooled.renamedPassing)} |`,
    ].join("\n") + "\n"
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      repos: { type: "string" },
      out: { type: "string" },
      markdown: { type: "boolean" },
      check: { type: "boolean" },
    },
  });
  if (!values.repos)
    throw Error(
      "Usage: names.mjs --repos DIR [--out FILE] [--markdown] [--check]",
    );
  const result = validate(values.repos);
  const out =
    values.out ?? new URL("names-result.json", import.meta.url).pathname;
  if (values.check) {
    if (!existsSync(out)) throw Error(`${out} does not exist`);
    deepStrictEqual(JSON.parse(readFileSync(out, "utf8")), result);
    console.log("names-result.json is what a fresh validation gives");
    return;
  }
  if (values.markdown) process.stdout.write(markdown(result));
  else writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
