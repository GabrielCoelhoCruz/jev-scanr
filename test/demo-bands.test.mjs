import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const expected = new URL("../examples/demo-app/expected/", import.meta.url);
const report = JSON.parse(
  readFileSync(new URL("report.json", expected), "utf8"),
);
const queue = readFileSync(new URL("queue.md", expected), "utf8");

test("the recorded demo puts registerUser's split question (P=0.52) in the uncertain band", () => {
  assert.deepEqual(
    report.uncertain.map((f) => [f.location[0].name, f.signalId, f.pPositive]),
    [["registerUser", "function_should_split", 0.52]],
  );
  assert.deepEqual(report.bands.counts, {
    worth_a_look: 4,
    uncertain: 1,
    below: 24,
  });
  assert.equal(report.findings.length, 4);
});

test("the recorded queue.md keeps its four numbered items and adds the uncertain and below bands after them", () => {
  assert.deepEqual(queue.match(/^## .*$/gm), [
    "## 1. clampPercent src/percent.ts:1–14 ↔ clampVolume src/volume.ts:1–14 · clone_same_policy@3.0.0 · P=0.98",
    "## 2. importOrders src/importer.ts:7–42 · function_should_split@1.0.0 · P=0.90",
    "## 3. importOrders src/importer.ts:7–42 · function_multiple_responsibilities@1.0.0 · P=0.88",
    "## 4. registerUser src/signup.ts:1–27 · function_multiple_responsibilities@1.0.0 · P=0.78",
  ]);
  assert.deepEqual(
    queue.match(
      /^\*\*(Worth a look|Uncertain, check|Below the band) \(\d+\)\./gm,
    ),
    [
      "**Worth a look (4).",
      "**Uncertain, check (1).",
      "**Below the band (24).",
    ],
  );
  assert.match(
    queue,
    /### 5\. registerUser src\/signup\.ts:1–27 · function_should_split@1\.0\.0 · P=0\.52 · uncertain/,
  );
});
