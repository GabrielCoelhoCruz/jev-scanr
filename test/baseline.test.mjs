import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze, analyzeSignal } from "../evals/baseline/analyze.mjs";
import { auc, bootstrap, precisionAtK } from "../evals/lib/stats.mjs";

const dir = new URL("../evals/baseline/", import.meta.url);
const data = JSON.parse(readFileSync(new URL("cells.json", dir), "utf8"));
const committed = JSON.parse(readFileSync(new URL("result.json", dir), "utf8"));

test("auc counts ties as one half and precisionAtK shares tied slots equally", () => {
  assert.equal(auc([0.9, 0.8, 0.3, 0.2], [1, 0, 1, 0]), 0.75);
  assert.equal(auc([1, 1, 1, 1], [1, 0, 1, 0]), 0.5);
  assert.equal(auc([1, 2], [1, 1]), null);
  assert.equal(precisionAtK([5, 4, 4, 1], [1, 1, 0, 0], 2), 0.75);
  assert.equal(precisionAtK([5, 4, 3, 1], [1, 1, 0, 0], 2), 1);
  assert.equal(precisionAtK([5, 4], [1, 1], 0), null);
});

test("the bootstrap is seeded: same seed, same resamples", () => {
  const draw = (seed) => {
    const out = [];
    bootstrap([1, 2, 3, 4, 5], 3, seed, (s) => out.push(s.join("")));
    return out;
  };
  assert.deepEqual(draw(7), draw(7));
  assert.notDeepEqual(draw(7), draw(8));
});

test("cells.json holds the labeled default-signal cells and no source text", () => {
  assert.equal(data.cells.length, 95);
  const count = (signalId, sample) =>
    data.cells.filter((c) => c.signalId === signalId && c.sample === sample)
      .length;
  assert.deepEqual(
    [
      count("clone_same_policy", "gate"),
      count("clone_same_policy", "showcase"),
      count("function_should_split", "gate"),
      count("function_should_split", "showcase"),
      count("function_multiple_responsibilities", "gate"),
      count("function_multiple_responsibilities", "showcase"),
    ],
    [24, 12, 24, 12, 16, 7],
  );
  assert.deepEqual(
    Object.keys(data.cells[0]).sort(),
    [
      "commit",
      "features",
      "id",
      "kind",
      "labels",
      "members",
      "p",
      "repository",
      "sample",
      "signalId",
    ].sort(),
  );
  assert.ok(data.cells.every((c) => !JSON.stringify(c).includes("source")));
  assert.equal(data.droppedNonDefaultSignalCells.magic_policy_literal, 36);
});

test("the published numbers follow from cells.json: Jev does not beat function length on the two function signals", () => {
  const result = analyze(data);
  assert.deepEqual(result, committed);
  const split = result.views.pass1.function_should_split;
  assert.deepEqual(
    [split.n, split.actionable, split.aboveCut, split.aboveCutActionable],
    [36, 12, 28, 10],
  );
  assert.deepEqual(split.jev, {
    auc: 0.707,
    precisionAtCut: 0.357,
    aucCI: [0.482, 0.895],
    precisionAtCutCI: [0.185, 0.538],
  });
  assert.equal(split.heuristics.lines.auc, 0.875);
  assert.equal(split.heuristics.lines.precisionAtK, 0.429);
  assert.equal(split.heuristics.lines.aucVerdict, "no_detectable_difference");
  const gateOnly = result.views["pass1-gate-only"].function_should_split;
  assert.equal(gateOnly.heuristics.lines.auc, 0.977);
  assert.equal(gateOnly.heuristics.lines.aucVerdict, "baseline_ahead");
  const clone = result.views.pass1.clone_same_policy;
  assert.equal(clone.jev.auc, 0.703);
  assert.equal(clone.heuristics.jscpdCoverage10.auc, 0.734);
  const multiple = result.views.pass1.function_multiple_responsibilities;
  assert.deepEqual(
    [multiple.aboveCut, multiple.aboveCutActionable, multiple.jev.auc],
    [15, 9, 0.697],
  );
  assert.equal(multiple.heuristics.params.aucVerdict, "jev_ahead");
});

test("a view with one label class reports that AUC is undefined instead of a number", () => {
  const noPositives = analyzeSignal(data.cells, "function_should_split", {
    label: "second",
    sample: "all",
  });
  assert.equal(noPositives.actionable, 0);
  assert.equal(noPositives.note, "one class only: AUC is undefined");
});
