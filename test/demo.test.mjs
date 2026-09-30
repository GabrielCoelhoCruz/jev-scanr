import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildPlan } from "../src/build-plan.mjs";

const demo = new URL("../examples/demo-app/", import.meta.url).pathname;
const read = (p) => readFileSync(demo + p, "utf8");
const json = (p) => JSON.parse(read(p));
const receipt = json("expected/RECEIPT.json");
const result = json("expected/RESULT.json");
const report = json("expected/report.json");

test("the recording still matches the current pipeline and demo source", () => {
  const plan = buildPlan(demo);
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(plan.requests.map((r) => r.requestHash)))
      .digest("hex"),
    receipt.requestHashesSHA256,
    "the demo requests changed: re-record with scripts/record-demo.mjs",
  );
  assert.equal(plan.estimates.requests, receipt.requests);
  assert.deepEqual(plan.enabledSignals, receipt.signals);
});

test("the receipt was frozen before the run and the journal agrees with the result", () => {
  assert.ok(receipt.frozenAtUTC < result.finishedAtUTC);
  assert.equal(receipt.passes, 1);
  assert.equal(receipt.sdkRetries, 0);
  assert.ok(result.calculatedUSD <= receipt.capUSD);
  const events = read("expected/journal.jsonl")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const finished = events.filter((e) => e.type === "finished");
  assert.equal(finished.length, result.requests);
  assert.ok(finished.every((e) => e.status === "succeeded"));
  assert.ok(finished.every((e) => e.response.model === receipt.model));
  const input = finished.reduce((n, e) => n + e.usage.input_tokens, 0);
  assert.equal(input, result.inputTokens);
  assert.ok(
    Math.abs(
      (input * receipt.tariffUSDPerMillionInput) / 1e6 - result.calculatedUSD,
    ) < 1e-9,
  );
  assert.ok(!events.some((e) => JSON.stringify(e).includes("/home/")));
});

test("the recorded findings are the seeded functions the default signals ask about, and no clean one", () => {
  const found = report.findings.map(
    (f) => `${f.location[0].name}:${f.signalId}`,
  );
  assert.deepEqual(found.sort(), [
    "clampPercent:clone_same_policy",
    "importOrders:function_multiple_responsibilities",
    "importOrders:function_should_split",
    "registerUser:function_multiple_responsibilities",
  ]);
  const clean = [
    "formatCurrency",
    "applyDiscount",
    "average",
    "activeWithTag",
    "describeTotal",
    "slugify",
    "truncate",
    "renderInvoiceText",
    "lateFee",
    "summarize",
  ];
  assert.deepEqual(
    report.findings.filter((f) => clean.includes(f.location[0].name)),
    [],
  );
  assert.equal(report.provenance, "live");
});
