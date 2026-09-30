import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/build-plan.mjs";
import { packSignals, verifyPlan } from "../src/plan.mjs";
import { buildReport } from "../src/report.mjs";
import { project, clone } from "./helpers.mjs";

const big = (t) =>
  project(t, {
    "big.ts": `export function big(input: number) {\n${Array.from(
      { length: 120 },
      (_, i) => `  const value${i} = input * ${i} + ${"1".repeat(20)};`,
    ).join("\n")}\n  return value1;\n}\n`,
    "user.ts":
      "import {big} from './big';\nexport function useBig(){ return big(2) }\n",
  });

test("oversized units split their questions, then their lines; focus source is never omitted", (t) => {
  const root = big(t);
  const whole = buildPlan(root).units.find(
    (p) => p.kind === "function" && p.members[0].name === "big",
  ).budget.serializedRequestBytes;
  const grouped = buildPlan(root, {
    limits: { maxRequestBytes: Math.floor(whole * 0.8) },
  });
  const groups = grouped.units.filter(
    (p) => p.members[0]?.name === "big" && p.kind === "function",
  );
  assert.ok(groups.length >= 2, "question groups share the same unit");
  assert.equal(new Set(groups.map((g) => g.unitId)).size, 1);
  assert.deepEqual(
    groups.flatMap((g) => g.signalSubset).sort(),
    packSignals({ kind: "function" })
      .map((s) => s.id)
      .sort(),
  );
  const tiny = buildPlan(root, { limits: { maxRequestBytes: 7000 } });
  const parent = tiny.units.find(
    (p) => p.kind === "function" && p.members[0].name === "big",
  );
  assert.equal(parent.status, "insufficient_context");
  assert.ok(
    parent.omitted.some(
      (o) =>
        o.reason === "members_exceed_request_cap_whole_unit_signals_abstain",
    ),
  );
  const chunks = tiny.units.filter((p) => p.kind === "function_chunk");
  assert.ok(chunks.length >= 2);
  assert.ok(
    chunks.every((c) => packSignals(c).every((s) => s.scope === "chunkable")),
  );
  assert.ok(
    tiny.units.every((p) =>
      p.sections.every((s) => typeof s.source === "string"),
    ),
    "no section source is ever omitted",
  );
  assert.ok(tiny.requests.every((r) => r.serializedBytes <= 7000));
  const covered = chunks
    .map((c) => [c.split.startLine, c.split.endLine])
    .sort((a, b) => a[0] - b[0]);
  assert.equal(covered[0][0], parent.members[0].range.startLine);
  assert.equal(covered.at(-1)[1], parent.members[0].range.endLine);
  for (let i = 1; i < covered.length; i++)
    assert.ok(covered[i][0] <= covered[i - 1][1] + 1, "windows are contiguous");
  const report = buildReport(tiny, []);
  assert.ok(
    report.abstentions.some(
      (a) => a.unitId === parent.unitId && a.status === "insufficient_context",
    ),
    "whole-unit questions abstain visibly",
  );
});

test("the unit cap never drops a unit silently: functions come first and overflow is an explicit abstention", (t) => {
  const files = {};
  for (let i = 0; i < 8; i++) files[`m${i}.ts`] = clone(`f${i}`);
  const plan = buildPlan(project(t, files), { limits: { maxCandidates: 12 } });
  const packed = plan.unitManifest.filter((m) => m.disposition === "packed"),
    dropped = plan.unitManifest.filter((m) => m.disposition !== "packed");
  assert.equal(packed.filter((m) => m.kind === "function").length, 8);
  assert.ok(
    dropped.length > 0 && dropped.every((m) => m.kind === "clone_pair"),
  );
  assert.equal(plan.coverage.unitsNotPacked, dropped.length);
  const report = buildReport(plan, []);
  assert.equal(report.unitsNotPacked, dropped.length);
  assert.equal(
    report.abstentions.filter((a) => a.status === "not_packed_candidate_limit")
      .length,
    dropped.length,
  );
  assert.equal(
    plan.unitManifest.filter((m) => m.kind === "clone_pair").length,
    28,
    "all 28 eligible pairs appear in the manifest, packed or not",
  );
  verifyPlan(plan);
});

test("limits can only be lowered", (t) => {
  const root = project(t, { "a.ts": clone("a") });
  assert.throws(() => buildPlan(root, { limits: { maxFiles: 10_000 } }));
  assert.throws(() => buildPlan(root, { limits: { nope: 1 } }));
  assert.throws(() => buildPlan(root, { limits: { maxFiles: 0 } }));
});
