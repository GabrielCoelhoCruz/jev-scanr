import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const expected = new URL("../examples/demo-app/expected/", import.meta.url);
const report = JSON.parse(
  readFileSync(new URL("report.json", expected), "utf8"),
);
const queue = readFileSync(new URL("queue.md", expected), "utf8");

test("at the per-signal default cuts the recorded demo lists registerUser's split question (P=0.52, cut 0.5) and leaves the uncertain band empty", () => {
  assert.deepEqual(report.uncertain, []);
  assert.deepEqual(report.bands.counts, {
    worth_a_look: 5,
    uncertain: 0,
    below: 24,
  });
  assert.deepEqual(
    report.findings.map((f) => [f.location[0].name, f.signalId, f.pPositive]),
    [
      ["clampPercent", "clone_same_policy", 0.98],
      ["importOrders", "function_should_split", 0.9],
      ["registerUser", "function_should_split", 0.52],
      ["importOrders", "function_multiple_responsibilities", 0.88],
      ["registerUser", "function_multiple_responsibilities", 0.78],
    ],
  );
  assert.deepEqual(report.bands.edges.function_should_split, {
    floor: 0.35,
    cut: 0.5,
  });
});

test("the recorded queue.md lists five numbered items, then the empty uncertain band and the below count", () => {
  assert.deepEqual(queue.match(/^## .*$/gm), [
    "## 1. clampPercent src/percent.ts:1–14 ↔ clampVolume src/volume.ts:1–14 · clone_same_policy@3.0.0 · P=0.98",
    "## 2. importOrders src/importer.ts:7–42 · function_should_split@1.0.0 · P=0.90",
    "## 3. registerUser src/signup.ts:1–27 · function_should_split@1.0.0 · P=0.52",
    "## 4. importOrders src/importer.ts:7–42 · function_multiple_responsibilities@1.0.0 · P=0.88",
    "## 5. registerUser src/signup.ts:1–27 · function_multiple_responsibilities@1.0.0 · P=0.78",
  ]);
  assert.deepEqual(
    queue.match(
      /^\*\*(Worth a look|Uncertain, check|Below the band) \(\d+\)\./gm,
    ),
    [
      "**Worth a look (5).",
      "**Uncertain, check (0).",
      "**Below the band (24).",
    ],
  );
});
