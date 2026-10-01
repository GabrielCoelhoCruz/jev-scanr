import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan as build } from "../src/build-plan.mjs";
import { packSignals, verifyPlan } from "../src/plan.mjs";
import { buildReport } from "../src/report.mjs";
import { project, clone, reseal } from "./helpers.mjs";

const SEVEN = [
  "clone_same_policy",
  "function_should_split",
  "magic_policy_literal",
  "internal_duplication",
  "function_multiple_responsibilities",
  "unused_local_or_parameter",
  "deep_nesting",
];
const buildPlan = (root, options = {}) =>
  build(root, { signals: SEVEN, ...options });

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
    limits: {
      maxRequestBytes: Math.floor(whole * 0.8),
      maxHardRequestBytes: Math.floor(whole * 0.8),
    },
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
  const tiny = buildPlan(root, {
    limits: { maxRequestBytes: 7000, maxHardRequestBytes: 7000 },
  });
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

const longFunction = (lines) =>
  `export function huge(input: number) {\n${Array.from(
    { length: lines },
    (_, i) => `  const value${i} = input * ${i} + ${"1".repeat(20)};`,
  ).join("\n")}\n  return value1;\n}\n`;

test("a focus above the 24 KB trim target but inside the provider budget is one request, not split", (t) => {
  const root = project(t, { "huge.ts": longFunction(420) });
  const p = buildPlan(root);
  const units = p.units.filter((u) => u.members[0].name === "huge");
  assert.equal(units.length, 1, "no question groups and no line windows");
  assert.equal(units[0].kind, "function");
  assert.equal(units[0].status, "eligible");
  const request = p.requests.find((r) => r.unitId === units[0].id);
  assert.ok(
    request.serializedBytes > 24000 && request.serializedBytes <= 64000,
    String(request.serializedBytes),
  );
  assert.deepEqual(
    Object.keys(request.request.questions).sort(),
    packSignals({ kind: "function" })
      .map((s) => s.id)
      .sort(),
    "every eligible signal is asked in the same request",
  );
  assert.equal(p.coverage.splits.lineWindows, 0);
  const legacy = buildPlan(root, { limits: { maxHardRequestBytes: 24000 } });
  assert.ok(
    legacy.units.some((u) => u.kind === "function_chunk"),
    "the old 24 KB rule would have windowed it",
  );
});

test("above the provider budget the function is split into line windows", (t) => {
  const p = buildPlan(project(t, { "huge.ts": longFunction(1200) }));
  assert.ok(p.units.some((u) => u.kind === "function_chunk"));
  assert.ok(p.requests.every((r) => r.serializedBytes <= 64000));
  assert.equal(
    p.units.find((u) => u.kind === "function").status,
    "insufficient_context",
  );
});

test("requests at or under the trim target do not change when the hard cap is present or absent", (t) => {
  const root = project(t, {
    "a.ts": clone("a") + clone("b", "20"),
    "c.ts": clone("c", "30"),
  });
  const hashes = (p) => p.requests.map((r) => r.requestHash);
  assert.deepEqual(
    hashes(buildPlan(root)),
    hashes(buildPlan(root, { limits: { maxHardRequestBytes: 24000 } })),
  );
});

test("the hard cap cannot be below the trim target or above its ceiling", (t) => {
  const root = project(t, { "a.ts": clone("a") });
  assert.throws(
    () => buildPlan(root, { limits: { maxHardRequestBytes: 10000 } }),
    /must not be below/,
  );
  assert.throws(
    () => buildPlan(root, { limits: { maxHardRequestBytes: 64001 } }),
    /Invalid lowered limit/,
  );
});

const oversized = (t) =>
  project(t, {
    "huge.ts": longFunction(1200),
    "user.ts":
      "import {huge} from './huge';\nexport function useHuge(){ return huge(2) }\n",
  });

test("an oversized function windowed into chunks never crashes, and every pack that sends no request has a zero budget", (t) => {
  const root = oversized(t);
  const plan = build(root);
  const chunks = plan.units.filter((p) => p.kind === "function_chunk");
  assert.ok(chunks.length >= 2, "the function is split into line windows");
  const sent = new Set(plan.requests.map((r) => r.unitId));
  for (const pack of plan.units) {
    const budget = pack.budget;
    if (sent.has(pack.id)) assert.ok(budget.serializedRequestBytes > 0);
    else {
      assert.equal(budget.serializedRequestBytes, 0, pack.kind);
      assert.equal(budget.heuristicInputTokensBytesDiv3, 0);
      assert.equal(budget.statePlusLongestQuestionBytes, 0);
    }
  }
  verifyPlan(plan);
});

test("chunks with no eligible signal abstain visibly instead of vanishing, and totals exclude their absent requests", (t) => {
  const root = oversized(t);
  const plan = build(root);
  const chunks = plan.units.filter((p) => p.kind === "function_chunk");
  const signalless = chunks.filter((p) => packSignals(p).length === 0);
  assert.ok(
    signalless.length >= 1,
    "default signals leave no chunkable question",
  );
  for (const pack of signalless) {
    assert.equal(pack.status, "insufficient_context");
    assert.deepEqual(pack.questionEligibility, {});
    assert.ok(plan.requests.every((r) => r.unitId !== pack.id));
  }
  assert.equal(
    plan.coverage.splits.noRequestPacks,
    plan.units.filter((p) => plan.requests.every((r) => r.unitId !== p.id))
      .length,
  );
  const sentBytes = plan.requests.reduce((n, r) => n + r.serializedBytes, 0);
  assert.equal(plan.estimates.serializedRequestBytes, sentBytes);
  assert.equal(plan.estimates.requests, plan.requests.length);
  const report = buildReport(plan, []);
  assert.equal(
    report.coverage.packsWithoutRequest,
    plan.coverage.splits.noRequestPacks,
  );
  assert.ok(
    plan.units
      .filter((p) => plan.requests.every((r) => r.unitId !== p.id))
      .every(
        (p) =>
          p.status === "insufficient_context" &&
          (packSignals(p).length === 0 ||
            p.omitted.some(
              (o) => o.what === "unit_request" && o.decisive === true,
            )),
      ),
    "every pack without a request is either signalless or an explicit abstention",
  );
});

test("totals a plan claims must match the requests it actually holds", (t) => {
  const root = project(t, { "a.ts": clone("a") });
  const plan = buildPlan(root);
  const edit = (fn) => {
    const c = structuredClone(plan);
    fn(c);
    return reseal(c);
  };
  assert.throws(
    () =>
      verifyPlan(
        edit((c) => {
          c.estimates.requests += 1;
        }),
      ),
    /Estimates mismatch/,
  );
  assert.throws(
    () =>
      verifyPlan(
        edit((c) => {
          delete c.estimates;
        }),
      ),
    /Estimates mismatch/,
  );
  assert.throws(
    () =>
      verifyPlan(
        edit((c) => {
          c.estimates.serializedRequestBytes += 1;
        }),
      ),
    /Estimates mismatch/,
  );
  assert.throws(
    () =>
      verifyPlan(
        edit((c) => {
          c.units[0].budget.serializedRequestBytes += 1;
        }),
      ),
    /Pack integrity mismatch|Budget mismatch/,
  );
});
