import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { COMPATIBLE_PLAN_VERSIONS, verifyPlan } from "../src/plan.mjs";
import { demoText } from "../src/demo.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { project, scratch, twoFiles } from "./helpers.mjs";

const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
const expected = new URL("../examples/demo-app/expected/", import.meta.url)
  .pathname;
const run = (args, cwd) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd },
    encoding: "utf8",
  });
const planText = readFileSync(join(expected, "plan.json"), "utf8");

test("the folder `jevs demo` points to re-cuts offline, with no key and nothing written next to the recording", (t) => {
  const cwd = scratch(t);
  const printed = demoText()
    .split("\n")
    .find((line) => line.includes(" rescore "));
  const folder = printed.match(/rescore '([^']+)'/)[1];
  const before = readdirSync(folder).sort();
  const out = join(cwd, "demo-rescored");
  const result = run(["rescore", folder, "--cut", "0.5", "--out", out], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `Rescored from stored answers (no API call, no key): 5 worth a look, 0 uncertain, 24 below the band. Read ${join(out, "queue.md")}\n`,
  );
  assert.deepEqual(readdirSync(out).sort(), [
    "queue.md",
    "report.json",
    "report.md",
  ]);
  assert.deepEqual(readdirSync(folder).sort(), before);
  assert.match(
    readFileSync(join(out, "queue.md"), "utf8"),
    /^## 3\. registerUser src\/signup\.ts:1–27 · function_should_split@1\.0\.0 · P=0\.52$/m,
  );
  const recorded = run(
    ["rescore", folder, "--cut", "0.7", "--out", join(cwd, "recorded")],
    cwd,
  );
  assert.match(
    recorded.stdout,
    /: 4 worth a look, 1 uncertain, 24 below the band\./,
  );
  const perSignal = run(
    [
      "rescore",
      folder,
      "--cut-signal",
      "function_should_split=0.6",
      "--out",
      join(cwd, "perSignal"),
    ],
    cwd,
  );
  assert.match(
    perSignal.stdout,
    /: 4 worth a look, 1 uncertain, 24 below the band\./,
  );
});

test("the shipped demo plan verifies, carries no machine path and holds the requests the recording answered", () => {
  const plan = verifyPlan(JSON.parse(planText));
  const receipt = JSON.parse(
    readFileSync(join(expected, "RECEIPT.json"), "utf8"),
  );
  assert.ok(
    COMPATIBLE_PLAN_VERSIONS.includes(plan.scannerVersion),
    "a version bump must keep the version that wrote the shipped plan in COMPATIBLE_PLAN_VERSIONS",
  );
  assert.equal(plan.root, "examples/demo-app");
  assert.ok(!planText.includes("/Users/"));
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(plan.requests.map((r) => r.requestHash)))
      .digest("hex"),
    receipt.requestHashesSHA256,
  );
});

test("a journal recorded for another plan is refused in words, and a plan with other requests is refused as not its own", (t) => {
  const cwd = scratch(t);
  const strict = run(
    [
      "report",
      "--plan",
      join(expected, "plan.json"),
      "--run-dir",
      expected,
      "--out",
      join(cwd, "r"),
    ],
    cwd,
  );
  assert.equal(strict.status, 1);
  assert.match(
    strict.stderr,
    /^Error: This journal was recorded for plan 65338442[0-9a-f]{4}…, but the plan given is [0-9a-f]{12}… \(scanner 0\.\d+\.\d+-alpha, root examples\/demo-app\)\. Use the plan\.json stored next to the run\n$/,
  );
  const foreign = join(cwd, "foreign.json");
  writeFileSync(foreign, JSON.stringify(buildPlan(project(t, twoFiles))));
  const rebound = run(
    [
      "rescore",
      expected,
      "--plan",
      foreign,
      "--cut",
      "0.5",
      "--out",
      join(cwd, "x"),
    ],
    cwd,
  );
  assert.equal(rebound.status, 1);
  assert.match(
    rebound.stderr,
    /^Error: The plan given has no request with the content this run answered \(unit [0-9a-f]{12}…\)\. It was not built from the same code, so the stored answers do not belong to it\n$/,
  );
});
