import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.mjs";
import { buildReport, queueMarkdown, resolveFloors } from "../src/report.mjs";
import { readJournal } from "../src/runner.mjs";
import { verifyPlan } from "../src/plan.mjs";
import {
  clone,
  fake,
  positive,
  project,
  response,
  scratch,
} from "./helpers.mjs";

const byName = { alpha: 0.95, beta: 0.6, gamma: 0.3, delta: 0.45 };
const files = {
  "a.ts": clone("alpha") + clone("beta", "20") + clone("gamma", "30"),
  "b.ts": clone("delta", "40"),
};
const answerSplit = (request) =>
  response(request, (id, signal, negative) => {
    const name = request.state.members.map((m) => m.name ?? "").join(",");
    return id === "function_should_split" && name in byName
      ? positive(byName[name])(id, signal, negative)
      : null;
  });

const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.after(() => {
    process.exitCode = 0;
  });
};

async function scanned(t) {
  quiet(t);
  const out = join(scratch(t), "out");
  await main(
    [
      "scan",
      project(t, files),
      "--run",
      "--yes",
      "--cap-usd",
      "1",
      "--out",
      out,
    ],
    { client: fake(async (r) => answerSplit(r)) },
  );
  return out;
}

const split = (list) =>
  list
    .filter((f) => f.signalId === "function_should_split")
    .map((f) => [f.location[0].name, f.pPositive]);

test("a scan puts P at or above the signal's cut in worth a look, P from its floor up to the cut in uncertain, and the rest below", async (t) => {
  const out = await scanned(t);
  const report = JSON.parse(readFileSync(join(out, "report.json")));
  assert.deepEqual(split(report.findings), [
    ["alpha", 0.95],
    ["beta", 0.6],
  ]);
  assert.deepEqual(split(report.uncertain), [["delta", 0.45]]);
  assert.equal(report.bands.counts.below >= 2, true);
  assert.deepEqual(report.bands.edges, {
    clone_same_policy: { floor: 0.5, cut: 0.7 },
    function_should_split: { floor: 0.35, cut: 0.5 },
    function_multiple_responsibilities: { floor: 0.5, cut: 0.7 },
  });
  const cells = report.blocks
    .flatMap((b) => b.signals)
    .filter((c) => c.signalId === "function_should_split")
    .map((c) => c.band);
  assert.deepEqual(cells.sort(), [
    "below",
    "uncertain",
    "worth_a_look",
    "worth_a_look",
  ]);
  const queue = readFileSync(join(out, "queue.md"), "utf8");
  assert.ok(
    queue.indexOf("**Worth a look (2).**") < queue.indexOf("alpha a.ts"),
  );
  assert.ok(queue.indexOf("alpha a.ts") < queue.indexOf("beta a.ts"));
  assert.ok(
    queue.indexOf("beta a.ts") < queue.indexOf("**Uncertain, check (1).**"),
  );
  assert.ok(
    queue.indexOf("**Uncertain, check (1).**") < queue.indexOf("delta b.ts"),
  );
  assert.ok(queue.indexOf("delta b.ts") < queue.indexOf("**Below the band ("));
  assert.ok(!queue.includes("gamma a.ts"));
  assert.match(queue, /P=0\.45 · uncertain/);
});

test("rescore re-bands stored answers into a new folder, needs no key and leaves the old files untouched", async (t) => {
  const out = await scanned(t);
  const before = readFileSync(join(out, "queue.md"), "utf8");
  await main(["rescore", out, "--cut", "0.55"], { env: {} });
  const dir = join(out, "rescored-cut-0.55");
  assert.deepEqual(readdirSync(dir).sort(), [
    "queue.md",
    "report.json",
    "report.md",
  ]);
  assert.equal(readFileSync(join(out, "queue.md"), "utf8"), before);
  const report = JSON.parse(readFileSync(join(dir, "report.json")));
  assert.deepEqual(split(report.findings), [
    ["alpha", 0.95],
    ["beta", 0.6],
  ]);
  assert.deepEqual(split(report.uncertain), [["delta", 0.45]]);
  assert.deepEqual(
    Object.values(report.thresholds),
    Object.values(report.thresholds).map(() => 0.55),
  );
  await assert.rejects(
    main(["rescore", out, "--cut", "0.55"], { env: {} }),
    /exists.*Nothing was overwritten/,
  );
});

test("rescore takes per-signal overrides and a floor, and rejects a floor above the cut", async (t) => {
  const out = await scanned(t);
  await main(
    [
      "rescore",
      out,
      "--cut-signal",
      "function_should_split=0.9",
      "--floor-signal",
      "function_should_split=0.4",
    ],
    { env: {} },
  );
  const dir = join(
    out,
    "rescored-cut-function_should_split-0.9_floor-function_should_split-0.4",
  );
  const report = JSON.parse(readFileSync(join(dir, "report.json")));
  assert.deepEqual(split(report.findings), [["alpha", 0.95]]);
  assert.deepEqual(split(report.uncertain), [
    ["beta", 0.6],
    ["delta", 0.45],
  ]);
  assert.deepEqual(report.bands.edges.function_should_split, {
    floor: 0.4,
    cut: 0.9,
  });
  assert.deepEqual(report.bands.edges.clone_same_policy, {
    floor: 0.5,
    cut: 0.7,
  });
  await assert.rejects(
    main(["rescore", out, "--cut", "0.3", "--floor", "0.4"], { env: {} }),
    /above its cut/,
  );
  await assert.rejects(
    main(["rescore", out, "--cut-signal", "nope=0.5"], { env: {} }),
    /did not ask/,
  );
  await assert.rejects(main(["rescore", out], { env: {} }), /at least one of/);
  assert.ok(!existsSync(join(out, "rescored-cut-0.3")));
});

test("rescore refuses a folder without a plan", async (t) => {
  quiet(t);
  await assert.rejects(
    main(["rescore", scratch(t), "--cut", "0.5"], { env: {} }),
    /No plan at/,
  );
});

test("the floor defaults per signal or the cut when the cut is lower, and report.json keeps every earlier field", async (t) => {
  const out = await scanned(t);
  const report = JSON.parse(readFileSync(join(out, "report.json")));
  assert.deepEqual(resolveFloors({ a: 0.7, b: 0.3 }), { a: 0.5, b: 0.3 });
  assert.deepEqual(
    resolveFloors({ function_should_split: 0.6, name_vs_behavior: 0.25 }),
    { function_should_split: 0.35, name_vs_behavior: 0.25 },
  );
  assert.deepEqual(resolveFloors({ a: 0.7 }, { a: 0.6 }), { a: 0.6 });
  assert.throws(() => resolveFloors({ a: 0.7 }, { a: 0.8 }), /above its cut/);
  assert.throws(() => resolveFloors({ a: 0.7 }, { b: 0.1 }), /Unknown/);
  for (const key of [
    "schema",
    "planHash",
    "thresholds",
    "thresholdMeaning",
    "coverage",
    "cells",
    "statusCounts",
    "blocks",
    "views",
    "abstentions",
    "findings",
    "reportHash",
  ])
    assert.ok(key in report, key);
  assert.ok(
    report.findings.every(
      (f) => f.band === "worth_a_look" && f.pPositive >= f.threshold,
    ),
  );
  const plan = verifyPlan(JSON.parse(readFileSync(join(out, "plan.json"))));
  const again = buildReport(plan, readJournal(join(out, "run"), plan));
  assert.equal(again.reportHash, report.reportHash);
  assert.match(queueMarkdown(again), /2 worth a look, 1 uncertain \(check\)/);
});
