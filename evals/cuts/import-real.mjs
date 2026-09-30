#!/usr/bin/env node
// Copies the numbers the cut derivation needs from the real-code name_vs_behavior evaluation (live run 3,
// a separate pull request) into evals/cuts/real-name-cells.json: per unit, Jev's P(name_mismatch), whether the
// name-word cue (src/name-cue.mjs) lets the unit through, and each labeler's label. No source text. Replace
// this file with a read of evals/real/ once that evaluation is merged.
//
//   node evals/cuts/import-real.mjs --real DIR [--commit SHA] [--out FILE]
//   DIR is a tree that holds evals/real/ (units.json, labels/, results/live-3/journal.jsonl).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    real: { type: "string" },
    commit: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.real)
  throw Error("Usage: import-real.mjs --real DIR [--commit SHA]");
const at = (path) => join(values.real, "evals/real", path);
const sha = (path) =>
  createHash("sha256")
    .update(readFileSync(at(path)))
    .digest("hex");
const lines = (path) =>
  readFileSync(at(path), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const labels = (path) =>
  Object.fromEntries(lines(path).map((x) => [x.id, x.label]));

const units = JSON.parse(readFileSync(at("units.json"))).units;
const claude = labels("labels/claude.jsonl"),
  gpt = labels("labels/gpt.jsonl"),
  p = {};
for (const e of lines("results/live-3/journal.jsonl"))
  if (e.type === "finished" && e.status === "succeeded")
    p[e.unitId] =
      e.response.answers.name_vs_behavior.probabilities.name_mismatch;
const inputs = {
  "units.json": sha("units.json"),
  "labels/claude.jsonl": sha("labels/claude.jsonl"),
  "labels/gpt.jsonl": sha("labels/gpt.jsonl"),
  "results/live-3/journal.jsonl": sha("results/live-3/journal.jsonl"),
};
const document = {
  schema: "real-name-cells/1",
  meaning:
    "Jev's P(name_mismatch) on 400 randomly sampled real functions, with two model labelers' labels. Copied from the real-code evaluation (live run 3); no person labeled anything.",
  source: {
    repositoryPath: "evals/real/",
    pullRequest: "https://github.com/GabrielCoelhoCruz/jev-scanr/pull/15",
    commit: values.commit ?? null,
    sha256: inputs,
  },
  cells: units.map((u) => ({
    id: u.id,
    p: p[u.id],
    nameCue: u.features.nameMissing === 1,
    claude: claude[u.id],
    gpt: gpt[u.id],
  })),
};
writeFileSync(
  values.out ?? new URL("real-name-cells.json", import.meta.url).pathname,
  JSON.stringify(document, null, 2) + "\n",
);
