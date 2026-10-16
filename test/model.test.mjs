import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash, modelProvenance } from "../src/core.mjs";
import { verifyPlan } from "../src/plan.mjs";
import { readJournal, summarize } from "../src/runner.mjs";
import { buildReport, reportMarkdown } from "../src/report.mjs";
import {
  plan,
  project,
  scratch,
  fake,
  response,
  run,
  twoFiles,
  reseal,
} from "./helpers.mjs";

const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
const expected = new URL("../examples/demo-app/expected/", import.meta.url)
  .pathname;
const finished = (dir, p) =>
  readJournal(dir, p).filter((e) => e.type === "finished");

test("the default plan requests jev-latest and --model pins one version in every request", (t) => {
  const latest = plan(t);
  assert.equal(latest.policy.model, "jev-latest");
  assert.deepEqual(
    [...new Set(latest.requests.map((r) => r.request.model))],
    ["jev-latest"],
  );
  const pinned = plan(t, twoFiles, { model: "jev-1.13.0" });
  assert.equal(pinned.policy.model, "jev-1.13.0");
  assert.deepEqual(
    [...new Set(pinned.requests.map((r) => r.request.model))],
    ["jev-1.13.0"],
  );
  assert.notEqual(pinned.planHash, latest.planHash);
  assert.throws(
    () => plan(t, twoFiles, { model: "jev-1.14" }),
    /pinned Jev version such as jev-1\.14\.0 or an alias such as jev-latest/,
  );
  const forged = reseal({
    ...structuredClone(latest),
    policy: { ...latest.policy, model: "jev-1.13.0" },
  });
  assert.throws(
    () => verifyPlan(forged),
    /Request matrix mismatch|Budget mismatch/,
  );
});

test("an alias run keeps the requested alias and the concrete served version apart", async (t) => {
  const p = plan(t);
  const dir = join(scratch(t), "run");
  const result = await run(
    p,
    dir,
    fake(async (r) => response(r)),
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    [
      result.requestedModel,
      result.servedModels,
      result.responsesWithoutServedModel,
    ],
    ["jev-latest", { "jev-1.14.0": p.requests.length }, 0],
  );
  const events = finished(dir, p);
  assert.deepEqual(
    [
      ...new Set(
        events.map(
          (e) => `${e.requestedModel}|${e.servedModel}|${e.response.model}`,
        ),
      ),
    ],
    ["jev-latest|jev-1.14.0|jev-1.14.0"],
  );
  assert.equal(readJournal(dir, p)[0].policy.model, "jev-latest");
  const report = buildReport(p, readJournal(dir, p), {
    thresholds: { clone_same_policy: 0 },
  });
  assert.deepEqual(
    [report.requestedModel, report.servedModels],
    ["jev-latest", { "jev-1.14.0": p.requests.length }],
  );
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((f) => f.servedModel === "jev-1.14.0"));
  assert.match(
    reportMarkdown(report),
    new RegExp(
      `^Model: requested \`jev-latest\`; served jev-1\\.14\\.0 \\(${p.requests.length} responses\\)\\.$`,
      "m",
    ),
  );
});

test("a pinned run stops on another served version and records which one answered", async (t) => {
  const p = plan(t, twoFiles, { model: "jev-1.13.0" });
  const dir = join(scratch(t), "run");
  let calls = 0;
  const result = await run(
    p,
    dir,
    fake(async (r) => {
      calls++;
      return { ...response(r), model: "jev-1.14.0" };
    }),
  );
  assert.deepEqual(
    [calls, result.complete, result.stoppedReason, result.servedModels],
    [1, false, "first_error", { "jev-1.14.0": 1 }],
  );
  const [event] = finished(dir, p);
  assert.deepEqual(
    [
      event.status,
      event.failure.validation,
      event.requestedModel,
      event.servedModel,
      event.response,
    ],
    ["failed", "unexpected_model", "jev-1.13.0", "jev-1.14.0", null],
  );
});

test("an alias reply without a concrete version fails and is never filled with the alias", async (t) => {
  for (const reported of ["jev-latest", "jev-1.14", undefined]) {
    const p = plan(t);
    const dir = join(scratch(t), "run");
    const result = await run(
      p,
      dir,
      fake(async (r) => {
        const { model, ...rest } = response(r);
        return reported === undefined ? rest : { ...rest, model: reported };
      }),
    );
    const [event] = finished(dir, p);
    assert.deepEqual(
      [
        result.stoppedReason,
        event.failure.validation,
        event.requestedModel,
        event.servedModel,
      ],
      [
        "first_error",
        reported === undefined ? "model_required" : "unresolved_model",
        "jev-latest",
        null,
      ],
    );
    assert.deepEqual(
      [result.servedModels, result.responsesWithoutServedModel],
      [{}, 1],
    );
  }
});

test("a dry run reports the requested model and no served model", (t) => {
  const p = plan(t);
  const report = buildReport(p, []);
  assert.deepEqual(
    [
      report.provenance,
      report.requestedModel,
      report.servedModels,
      report.responsesWithoutServedModel,
    ],
    ["not_run", "jev-latest", {}, 0],
  );
  assert.match(
    reportMarkdown(report),
    /^Model: requested `jev-latest`; served none \(no answer was recorded\)\.$/m,
  );
  const dir = project(t, twoFiles);
  const dry = spawnSync(
    process.execPath,
    [cli, "scan", dir, "--model", "jev-1.13.0"],
    {
      env: { PATH: process.env.PATH, HOME: scratch(t) },
      encoding: "utf8",
    },
  );
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(
    dry.stdout,
    /· requested model jev-1\.13\.0 at US\$0\.042\/M input tokens/,
  );
  const bad = spawnSync(
    process.execPath,
    [cli, "scan", dir, "--model", "jev latest"],
    {
      env: { PATH: process.env.PATH, HOME: scratch(t) },
      encoding: "utf8",
    },
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--model must be a pinned Jev version/);
});

test("the jev-1.13.0 recording still reads; its served model comes from the answers it stored", () => {
  const recorded = JSON.parse(
    readFileSync(join(expected, "plan.json"), "utf8"),
  );
  const p = verifyPlan(recorded);
  const events = readJournal(expected, p, undefined, { rebind: true });
  assert.ok(
    events.every((e) => !("requestedModel" in e) && !("servedModel" in e)),
  );
  assert.deepEqual(modelProvenance(events, p), {
    requestedModel: "jev-1.13.0",
    servedModels: { "jev-1.13.0": 15 },
    responsesWithoutServedModel: 0,
  });
  assert.equal(summarize(events, p).requestedModel, "jev-1.13.0");
});

test("a journal whose served model disagrees with its stored answer is refused", async (t) => {
  const p = plan(t);
  const dir = join(scratch(t), "run");
  await run(
    p,
    dir,
    fake(async (r) => response(r)),
  );
  const path = join(dir, "journal.jsonl");
  let previousHash = null;
  const lines = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const { eventHash, ...body } = JSON.parse(line);
      if (body.type === "finished" && body.seq === 2)
        body.servedModel = "jev-1.13.0";
      body.previousHash = previousHash;
      previousHash = hash(body);
      return JSON.stringify({ ...body, eventHash: previousHash });
    });
  writeFileSync(path, lines.join("\n") + "\n");
  assert.throws(() => readJournal(dir, p), /WAL model provenance mismatch/);
});

test("a failed pinned event whose served model disagrees with the observed version is refused", async (t) => {
  const p = plan(t, twoFiles, { model: "jev-1.13.0" });
  const dir = join(scratch(t), "run");
  await run(
    p,
    dir,
    fake(async (r) => ({ ...response(r), model: "jev-1.14.0" })),
  );
  const path = join(dir, "journal.jsonl");
  const original = readFileSync(path, "utf8");
  const forge = (served) => {
    let previousHash = null;
    const lines = original
      .trim()
      .split("\n")
      .map((line) => {
        const { eventHash, ...body } = JSON.parse(line);
        if (body.type === "finished") body.servedModel = served;
        body.previousHash = previousHash;
        previousHash = hash(body);
        return JSON.stringify({ ...body, eventHash: previousHash });
      });
    writeFileSync(path, lines.join("\n") + "\n");
  };
  assert.deepEqual(
    finished(dir, p).map((e) => [
      e.failure.validation,
      e.failure.diagnostic.observed,
      e.servedModel,
    ]),
    [["unexpected_model", { type: "enum", value: "jev-1.14.0" }, "jev-1.14.0"]],
  );
  for (const served of ["jev-9.9.9", null]) {
    forge(served);
    assert.throws(() => readJournal(dir, p), /WAL model provenance mismatch/);
  }
});
