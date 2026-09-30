import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derive } from "../evals/cuts/derive.mjs";
import { defaultCut, defaultFloor } from "../src/cuts.mjs";

const read = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));

test("cuts.json and the committed derivation are what the rule gives from the committed data", () => {
  const result = derive();
  assert.deepEqual(read("evals/cuts/result.json"), result);
  assert.deepEqual(read("cuts.json").cuts, result.cuts);
});

test("the derived defaults are literal per signal", () => {
  assert.deepEqual(
    Object.fromEntries(
      [
        "clone_same_policy",
        "function_should_split",
        "function_multiple_responsibilities",
        "name_vs_behavior",
        "deep_nesting",
      ].map((id) => [id, [defaultCut(id), defaultFloor(id)]]),
    ),
    {
      clone_same_policy: [0.7, 0.5],
      function_should_split: [0.5, 0.35],
      function_multiple_responsibilities: [0.7, 0.5],
      name_vs_behavior: [0.5, 0.2],
      deep_nesting: [0.7, 0.5],
    },
  );
});

test("the name_vs_behavior real-sample summary keeps the cue's cost visible", () => {
  const { realSample, labeledCells } = derive().signals.name_vs_behavior;
  assert.equal(labeledCells, 400);
  assert.deepEqual(realSample.cells, { all: 400, nameCue: 45 });
  assert.deepEqual(
    [
      realSample.allFlagged,
      realSample.flaggedThroughCue,
      realSample.allStrict,
      realSample.strictThroughCue,
    ],
    [16, 3, 5, 3],
  );
  assert.deepEqual(realSample.atFloor, {
    all: { n: 15, flagged: 5, strict: 2 },
    nameCue: { n: 6, flagged: 1, strict: 1 },
  });
  assert.deepEqual(realSample.atCut.all, { n: 2, flagged: 1, strict: 0 });
});
