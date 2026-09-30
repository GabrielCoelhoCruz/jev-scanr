#!/usr/bin/env node
// Builds the real-code sample for the name_vs_behavior validation (see evals/real/README.md).
// Random, not chosen by Jev: 400 named top-level functions, 100 from each of the four pinned repositories,
// 25 from each of four length bands. Deterministic. No network, no API, no key.
//
//   node evals/real/build.mjs --repos DIR [--out evals/real/units.json] [--project DIR] [--labeling DIR] [--check]
//
// --project: writes the excerpts a live run would send (DIR/R/u/<id>.<ext>).
// --labeling: writes items.jsonl (id, name, code) in a shuffled order, for blind labelers. No scores, no features.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { hash } from "../../src/core.mjs";
import {
  extractPool,
  functionFeatures,
  jaccard,
  nameWords,
} from "../contrast/lib/code.mjs";
import { rngFor, shuffle } from "../contrast/lib/match.mjs";
import { PINNED } from "../contrast/build.mjs";

export const SEED = 20260930;
export const PER_STRATUM = 25;
export const STRATA = [
  { name: "5-9", min: 5, max: 9 },
  { name: "10-19", min: 10, max: 19 },
  { name: "20-39", min: 20, max: 39 },
  { name: "40-100", min: 40, max: 100 },
];
const MAX_PER_FILE = 3;
const MAX_NEAR_DUPLICATE = 0.8;

export const SET = {
  name: "name_vs_behavior_real",
  signal: "name_vs_behavior",
  presence: "name_mismatch",
  kind: "function",
  mainHeuristic: "lines",
};

export const nameMissing = (p) => {
  const words = nameWords(p.info.name);
  return words.size
    ? [...words].filter((w) => !p.info.words.has(w)).length / words.size
    : 0;
};

export function sample(pools) {
  const picked = [];
  for (const repo of Object.keys(PINNED)) {
    const eligible = pools[repo].filter(
      (p) => p.info.name.length >= 3 && !p.info.recursion,
    );
    const perFile = new Map();
    const seen = new Set();
    for (const stratum of STRATA) {
      const rng = rngFor(SEED, `real:${repo}:${stratum.name}`);
      const candidates = shuffle(
        eligible.filter(
          (p) => p.info.lines >= stratum.min && p.info.lines <= stratum.max,
        ),
        rng,
      );
      const chosen = [];
      for (const c of candidates) {
        if (chosen.length >= PER_STRATUM) break;
        if (seen.has(c.sha256) || (perFile.get(c.path) ?? 0) >= MAX_PER_FILE)
          continue;
        if (
          chosen.some(
            (o) =>
              jaccard(o.info.shingles, c.info.shingles) >= MAX_NEAR_DUPLICATE,
          )
        )
          continue;
        chosen.push(c);
        seen.add(c.sha256);
        perFile.set(c.path, (perFile.get(c.path) ?? 0) + 1);
      }
      if (chosen.length < PER_STRATUM)
        throw Error(`${repo} ${stratum.name}: only ${chosen.length}`);
      picked.push(...chosen.map((p) => ({ p, stratum: stratum.name })));
    }
  }
  return picked;
}

export function build(reposDir) {
  const pools = {};
  for (const [repo, { dir, commit }] of Object.entries(PINNED)) {
    const cwd = join(reposDir, dir);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd })
      .toString()
      .trim();
    if (head !== commit)
      throw Error(`${repo} is at ${head}, expected ${commit}`);
    pools[repo] = extractPool(cwd, repo);
  }
  const picked = sample(pools);
  const units = picked.map(({ p, stratum }, index) => {
    const id = hash([SEED, "R", index]).slice(0, 8);
    return {
      set: "R",
      id,
      kind: "function",
      stratum,
      source: [
        {
          role: "focus",
          repo: p.repo,
          path: p.path,
          startLine: p.startLine,
          endLine: p.endLine,
          name: p.info.name,
          sha256: p.sha256,
        },
      ],
      features: { ...functionFeatures(p.info), nameMissing: nameMissing(p) },
      files: [{ path: `u/${id}.${p.ext}`, sha256: hash(p.text) }],
      text: p.text,
    };
  });
  const document = {
    schema: "real-units/1",
    meaning:
      "A random sample of named top-level functions from the four pinned repositories, equal numbers per repository and per length band. Not chosen by Jev's probability and not by any heuristic. Labels are kept apart in evals/real/labels/. Paths, ranges, hashes and numbers only; the excerpts are regenerated from the pinned repositories.",
    generatedBy: "evals/real/build.mjs",
    seed: SEED,
    pinned: Object.fromEntries(
      Object.entries(PINNED).map(([repo, { commit }]) => [repo, commit]),
    ),
    population:
      "Top-level function declarations and const-bound function or arrow expressions, 5 to 100 lines, in non-test, non-generated source, without this, yield or self-recursion, with a name of 3 or more characters. Class methods and anonymous functions are not in the population.",
    sampling: {
      perRepository: PER_STRATUM * STRATA.length,
      perStratum: PER_STRATUM,
      strata: STRATA,
      maxPerFile: MAX_PER_FILE,
      nearDuplicateShingleJaccard: MAX_NEAR_DUPLICATE,
    },
    sets: { R: { ...SET, units: units.length } },
    units: units.map(({ text: _t, ...u }) => u),
  };
  return { document, units };
}

function main() {
  const { values } = parseArgs({
    options: {
      repos: { type: "string" },
      out: {
        type: "string",
        default: new URL("./units.json", import.meta.url).pathname,
      },
      project: { type: "string" },
      labeling: { type: "string" },
      check: { type: "boolean" },
    },
  });
  if (!values.repos)
    throw Error(
      "Usage: build.mjs --repos DIR [--out FILE] [--project DIR] [--labeling DIR] [--check]",
    );
  const { document, units } = build(values.repos);
  const json = JSON.stringify(document, null, 2) + "\n";
  if (values.check) {
    if (readFileSync(values.out, "utf8") !== json)
      throw Error(`${values.out} differs from a fresh build`);
    console.log("units.json matches a fresh build");
  } else {
    writeFileSync(values.out, json);
    console.log(`wrote ${values.out}: ${units.length} units`);
  }
  if (values.project)
    for (const u of units) {
      const path = join(values.project, "R", u.files[0].path);
      mkdirSync(dirname(path), { recursive: true });
      if (existsSync(path)) throw Error(`${path} exists`);
      writeFileSync(path, u.text);
    }
  if (values.labeling) {
    mkdirSync(values.labeling, { recursive: true });
    const order = shuffle(units, rngFor(SEED, "real:labeling-order"));
    writeFileSync(
      join(values.labeling, "items.jsonl"),
      order
        .map((u) =>
          JSON.stringify({ id: u.id, name: u.source[0].name, code: u.text }),
        )
        .join("\n") + "\n",
      { flag: "wx" },
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
