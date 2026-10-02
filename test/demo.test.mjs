import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildPlan } from "../src/build-plan.mjs";
import { recordedRun, demoText, demoFooter } from "../src/demo.mjs";
import { renderDemoSvg, parseQueue } from "../scripts/render-demo-image.mjs";
import { regenerateDemoReports } from "../scripts/regenerate-demo-reports.mjs";

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

test("the stored artifacts are exactly what the current pipeline regenerates from the recording", () => {
  const regenerated = regenerateDemoReports();
  assert.deepEqual(
    regenerated.plan,
    json("expected/plan.json"),
    "expected/plan.json is stale: run node scripts/regenerate-demo-reports.mjs",
  );
  assert.deepEqual(
    regenerated.report,
    json("expected/report.json"),
    "expected/report.json is stale (its reportHash no longer covers its own content): run node scripts/regenerate-demo-reports.mjs",
  );
  assert.equal(
    read("expected/report.md"),
    regenerated.reportMarkdown,
    "expected/report.md is stale: run node scripts/regenerate-demo-reports.mjs",
  );
  assert.equal(
    read("expected/queue.md"),
    regenerated.queueMarkdown,
    "expected/queue.md is stale: run node scripts/regenerate-demo-reports.mjs",
  );
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
    "registerUser:function_should_split",
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

test("the replay text is the recorded queue between a banner and a footer", () => {
  const text = demoText();
  assert.ok(text.includes(read("expected/queue.md").trimEnd()));
  assert.ok(text.startsWith("RECORDED RUN."));
  assert.ok(text.endsWith(demoFooter()));
  assert.ok(
    demoFooter().includes("free dry run that sends nothing: jevs scan ."),
  );
  assert.ok(
    demoFooter({ viaNpx: true }).includes(
      "free dry run that sends nothing: npx github:GabrielCoelhoCruz/jev-scanr scan .",
    ),
  );
});

test("the README image is drawn from the recording and is a PNG of the expected size", () => {
  const items = parseQueue(recordedRun().queue);
  assert.deepEqual(
    items.map((i) => [i.rank, i.signal, i.p, i.answer]),
    [
      ["1", "clone_same_policy@3.0.0", "0.98", "same_policy"],
      ["2", "function_should_split@1.0.0", "0.90", "split_candidate"],
      ["3", "function_multiple_responsibilities@1.0.0", "0.88", "multiple"],
      ["4", "function_multiple_responsibilities@1.0.0", "0.78", "multiple"],
      ["5", "function_should_split@1.0.0", "0.52", "split_candidate"],
    ],
  );
  const root = new URL("../", import.meta.url);
  assert.equal(
    readFileSync(new URL("docs/images/demo-queue.svg", root), "utf8"),
    renderDemoSvg(recordedRun()),
    "the recording changed: run node scripts/render-demo-image.mjs and rasterize the PNG (docs/RELEASING.md)",
  );
  const png = readFileSync(new URL("docs/images/demo-queue.png", root));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1680);
  assert.equal(png.readUInt32BE(20), 1300);
  assert.ok(png.length < 100_000);
  assert.match(
    readFileSync(new URL("README.md", root), "utf8"),
    /!\[The five-item queue from a recorded run[^\]]*\]\(docs\/images\/demo-queue\.png\)/,
  );
});
