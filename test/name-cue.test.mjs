import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlan } from "../src/build-plan.mjs";
import { buildIndex } from "../src/index.mjs";
import { readSnapshot } from "../src/snapshot.mjs";
import { nameCue, nameWords } from "../src/name-cue.mjs";
import {
  applyQuestionEligibility,
  packBudget,
  requestFor,
  verifyPlan,
} from "../src/plan.mjs";
import { catalogHashFor, defaultSignalIds } from "../src/catalog.mjs";
import { nameWords as contrastNameWords } from "../evals/contrast/lib/code.mjs";
import { hash } from "../src/core.mjs";
import { project, reseal } from "./helpers.mjs";

const SOURCE = `export function invoiceTotal(rows: number[]) {
  let sum = 0;
  for (const row of rows) sum += row;
  return sum;
}
export function sumRows(rows: number[]) {
  let sum = 0;
  for (const row of rows) sum += row;
  return sum;
}
export const parseDuration = (rows: number[]) => {
  let sum = 0;
  for (const row of rows) sum += row;
  return sum;
};
`;

const cues = (t) => {
  const index = buildIndex(readSnapshot(project(t, { "a.ts": SOURCE })));
  return Object.fromEntries(
    index.functions.map((f) => [f.name, nameCue(index, f)]),
  );
};

test("name words are split, stemmed and filtered the way the contrast set was built", () => {
  for (const name of [
    "parseDuration",
    "useFloorConfig",
    "HTMLParserStatuses",
    "HTMLParserRules",
    "get_user_by_id",
    "fn",
    "normalizedImageUrl",
  ])
    assert.deepEqual(nameWords(name), contrastNameWords(name), name);
  assert.deepEqual(
    [...nameWords("HTMLParserRules")],
    ["html", "parser", "rule"],
  );
});

test("the cue is true only when no word of the name appears in the body", (t) => {
  assert.deepEqual(cues(t), {
    invoiceTotal: { words: ["invoice", "total"], absent: true },
    sumRows: { words: ["row", "sum"], absent: false },
    parseDuration: { words: ["duration", "parse"], absent: true },
  });
});

test("without --name-cue name_vs_behavior asks every function", (t) => {
  const plan = buildPlan(project(t, { "a.ts": SOURCE }), {
    signals: ["name_vs_behavior"],
  });
  assert.equal(plan.requests.length, 3);
  assert.equal(Object.hasOwn(plan.coverage, "unitsSkippedByNameCue"), false);
  assert.equal(Object.hasOwn(plan.retrieval, "nameCue"), false);
  assert.equal(
    plan.unitManifest.every((u) => !("nameCueAbsent" in u)),
    true,
  );
});

test("new plans never ask name_vs_behavior about an unnamed function", (t) => {
  const root = project(t, {
    "a.ts": "[1, 2].forEach((row) => { console.log(row); });\n",
  });
  const namingOnly = buildPlan(root, { signals: ["name_vs_behavior"] });
  assert.equal(namingOnly.requests.length, 0);

  const mixed = buildPlan(root, {
    signals: ["function_should_split", "name_vs_behavior"],
  });
  assert.deepEqual(Object.keys(mixed.requests[0].request.questions), [
    "function_should_split",
  ]);
  assert.deepEqual(
    mixed.unitManifest.map((unit) => [unit.signals, unit.nameCueAbsent]),
    [[["function_should_split"], false]],
  );
  assert.equal(verifyPlan(mixed), mixed);
});

test("a plan sealed before the unnamed-function rule keeps its naming question", (t) => {
  const plan = buildPlan(
    project(t, {
      "a.ts": "[1, 2].forEach((row) => { console.log(row); });\n",
    }),
    { signals: ["function_should_split", "name_vs_behavior"] },
  );
  const old = structuredClone(plan);
  delete old.units[0].facts.nameCue;
  delete old.unitManifest[0].nameCueAbsent;
  old.unitManifest[0].signals = ["function_should_split", "name_vs_behavior"];
  applyQuestionEligibility(old.units[0]);
  old.units[0].budget = packBudget(old.units[0], old.limits);
  const request = requestFor(old.units[0]);
  old.requests = [
    {
      unitId: old.units[0].id,
      requestHash: hash(request),
      serializedBytes: Buffer.byteLength(JSON.stringify(request)),
      request,
    },
  ];
  reseal(old);

  assert.equal(verifyPlan(old), old);
  assert.deepEqual(Object.keys(old.requests[0].request.questions), [
    "function_should_split",
    "name_vs_behavior",
  ]);
});

test("with the name cue on, name_vs_behavior asks only the functions whose name words are absent from the body", (t) => {
  const plan = buildPlan(project(t, { "a.ts": SOURCE }), {
    signals: ["name_vs_behavior"],
    retrieval: { nameCue: true },
  });
  assert.equal(plan.retrieval.nameCue, true);
  assert.deepEqual(
    plan.requests.map((r) => r.request.state.members[0].name).sort(),
    ["invoiceTotal", "parseDuration"],
  );
  assert.equal(plan.coverage.unitsSkippedByNameCue, 1);
  assert.deepEqual(
    plan.unitManifest.map((u) => [u.signals, u.nameCueAbsent]),
    [
      [["name_vs_behavior"], true],
      [["name_vs_behavior"], true],
    ],
  );
  assert.equal(verifyPlan(plan), plan);
});

test("the cue filters only its own signal: the default signals still ask every function", (t) => {
  const root = project(t, { "a.ts": SOURCE });
  const plan = buildPlan(root, {
    signals: [...defaultSignalIds, "name_vs_behavior"],
    retrieval: { nameCue: true },
  });
  assert.equal(plan.requests.length, 3);
  assert.deepEqual(
    plan.requests.map((r) =>
      Object.keys(r.request.questions).includes("name_vs_behavior"),
    ),
    [true, false, true],
  );
  assert.equal(
    buildPlan(root, {
      signals: defaultSignalIds,
      retrieval: { nameCue: true },
    }).requests.length,
    3,
  );
});

test("plans recorded before the opt-in signal existed still verify", () => {
  const receipt = JSON.parse(
    readFileSync(
      new URL("../examples/demo-app/expected/RECEIPT.json", import.meta.url),
    ),
  );
  assert.equal(
    catalogHashFor(defaultSignalIds),
    "da964b591ccd131e9d0b483a459ac08e81ebc63df6d147ccdd009e97e4f58daf",
  );
  assert.equal(catalogHashFor(defaultSignalIds), receipt.scanner.catalogHash);
  assert.equal(
    catalogHashFor(["magic_policy_literal", "deep_nesting"]),
    receipt.scanner.catalogHash,
  );
  assert.notEqual(
    catalogHashFor(["name_vs_behavior"]),
    receipt.scanner.catalogHash,
  );
});

test("a plan cannot claim the opt-in signal under the old catalog hash", (t) => {
  const plan = buildPlan(project(t, { "a.ts": SOURCE }), {
    signals: ["name_vs_behavior"],
  });
  assert.equal(plan.catalogHash, catalogHashFor(["name_vs_behavior"]));
  assert.throws(
    () =>
      verifyPlan(
        reseal({ ...plan, catalogHash: catalogHashFor(defaultSignalIds) }),
      ),
    /Plan\/version integrity mismatch/,
  );
});

test("a plan written before retrieval recorded its sources still verifies and rescores by content", (t) => {
  const plan = buildPlan(project(t, { "a.ts": SOURCE }), {
    signals: defaultSignalIds,
  });
  const { planHash, ...body } = structuredClone(plan);
  delete body.retrieval.lowOverlap;
  delete body.coverage.lowOverlap;
  const old = { ...body, scannerVersion: "0.4.0-alpha" };
  assert.equal(verifyPlan({ ...old, planHash: hash(old) }).planHash, hash(old));
});

test("--name-cue is a scan option and narrows the dry run", (t) => {
  const root = project(t, { "a.ts": SOURCE }),
    cwd = project(t);
  const requests = (...args) =>
    spawnSync(
      process.execPath,
      [
        new URL("../src/cli.mjs", import.meta.url).pathname,
        "scan",
        root,
        "--signals",
        "name_vs_behavior",
        ...args,
      ],
      { cwd, env: { PATH: process.env.PATH }, encoding: "utf8" },
    ).stdout.match(/^Requests: (\d+)/m)[1];
  assert.equal(requests(), "3");
  assert.equal(requests("--name-cue"), "2");
});
