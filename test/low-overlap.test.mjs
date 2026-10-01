import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildPlan } from "../src/build-plan.mjs";
import { buildIndex } from "../src/index.mjs";
import { generateCandidates } from "../src/candidates.mjs";
import { readSnapshot } from "../src/snapshot.mjs";
import { buildReport } from "../src/report.mjs";
import { project, scratch, twoFiles } from "./helpers.mjs";
import { INVOICES, ORDERS, OTHER, TAG_COPY } from "./fixtures/copies.mjs";

const rewrittenCopies = {
  "orders.ts": ORDERS,
  "invoices.ts": INVOICES,
  "other.ts": OTHER,
  "tag-copy.ts": TAG_COPY,
};
const candidatesOf = (root, options) =>
  generateCandidates(buildIndex(readSnapshot(root)), options);
const cli = new URL("../src/cli.mjs", import.meta.url).pathname;

test("a mechanically rewritten copy is proposed by the second source, which the first source cannot see", (t) => {
  const { candidates, stats } = candidatesOf(project(t, rewrittenCopies));
  assert.deepEqual(
    candidates.map((c) => [
      c.members.map((m) => m.name).sort(),
      c.facts.retrievalSource,
      Number(c.facts.jaccard.toFixed(4)),
      Number(c.facts.surfaceJaccard.toFixed(4)),
      Number(c.facts.shapeSimilarity.toFixed(4)),
      Number(c.facts.score.toFixed(4)),
    ]),
    [
      [
        ["tagList", "uniqueLowercase"],
        "low_overlap_surface",
        0.3393,
        0.8571,
        0.7681,
        0.8126,
      ],
      [
        ["outstandingByCustomer", "pendingTotals"],
        "low_overlap_surface",
        0.3156,
        0.6842,
        0.7769,
        0.7306,
      ],
    ],
  );
  assert.deepEqual(stats.lowOverlap, {
    functions: 5,
    comparisons: 4,
    passing: 2,
    candidates: 2,
  });
  assert.equal(stats.eligiblePairs, 0);
});

test("the pair becomes a clone_pair unit asked only through clone_same_policy, tagged with its source", (t) => {
  const plan = buildPlan(project(t, rewrittenCopies), {
    signals: ["clone_same_policy"],
  });
  assert.equal(plan.coverage.pairUnits, 2);
  assert.deepEqual(
    plan.units.map((u) => [u.kind, u.facts.retrievalSource]),
    [
      ["clone_pair", "low_overlap_surface"],
      ["clone_pair", "low_overlap_surface"],
    ],
  );
  assert.deepEqual(
    plan.requests.map((r) => Object.keys(r.request.questions)),
    [["clone_same_policy"], ["clone_same_policy"]],
  );
  assert.deepEqual(plan.retrieval.lowOverlap, {
    cap: 50,
    minScore: 0.6,
    minSurface: 3,
    maxDocumentFrequency: 250,
  });
  const report = buildReport(plan);
  assert.deepEqual(
    report.blocks.map((b) => b.kind),
    ["clone_pair", "clone_pair"],
  );
});

test("the cap keeps the best-scoring pairs and records how many it left out", (t) => {
  const root = project(t, rewrittenCopies);
  const one = candidatesOf(root, { lowOverlap: { cap: 1 } });
  assert.deepEqual(
    one.candidates.map((c) => c.members.map((m) => m.name).sort()),
    [["tagList", "uniqueLowercase"]],
  );
  assert.deepEqual(one.omitted, [
    { kind: "clone_pair", reason: "low_overlap_cap", count: 1 },
  ]);
  const plan = buildPlan(root, {
    signals: ["clone_same_policy"],
    retrieval: { lowOverlap: { cap: 1 } },
  });
  assert.deepEqual(
    plan.coverage.generatorOmissions.map((o) => o.reason),
    ["low_overlap_cap"],
  );
});

test("a cap of 0 turns the source off", (t) => {
  const root = project(t, rewrittenCopies);
  const off = candidatesOf(root, { lowOverlap: { cap: 0 } });
  assert.equal(off.candidates.length, 0);
  assert.deepEqual(off.stats.lowOverlap, { candidates: 0 });
  const plan = buildPlan(root, {
    signals: ["clone_same_policy"],
    retrieval: { lowOverlap: { cap: 0 } },
  });
  assert.equal(plan.coverage.pairUnits, 0);
  assert.equal(plan.retrieval.lowOverlap.cap, 0);
});

test("function-only scans skip clone retrieval and keep its public shape", (t) => {
  const root = project(t, rewrittenCopies);
  const plan = buildPlan(root, { signals: ["function_should_split"] });
  assert.deepEqual(
    {
      functionsIndexed: plan.coverage.functionsIndexed,
      clonePool: plan.coverage.clonePool,
      comparisons: plan.coverage.comparisons,
      eligiblePairs: plan.coverage.eligiblePairs,
      candidateCount: plan.coverage.candidateCount,
      lowOverlap: plan.coverage.lowOverlap,
      functionUnits: plan.coverage.functionUnits,
      pairUnits: plan.coverage.pairUnits,
    },
    {
      functionsIndexed: 11,
      clonePool: 0,
      comparisons: 0,
      eligiblePairs: 0,
      candidateCount: 0,
      lowOverlap: { candidates: 0 },
      functionUnits: 5,
      pairUnits: 0,
    },
  );
  assert.deepEqual(plan.clusters, []);
  assert.deepEqual(plan.coverage.generatorOmissions, []);
  assert.deepEqual(plan.retrieval, {
    minLines: 8,
    minJaccard: 0.45,
    minSizeRatio: 0.5,
    includeTests: false,
    lowOverlap: {
      cap: 50,
      minScore: 0.6,
      minSurface: 3,
      maxDocumentFrequency: 250,
    },
  });
  assert.throws(
    () =>
      buildPlan(root, {
        signals: ["function_should_split"],
        retrieval: { lowOverlap: { cap: -1 } },
      }),
    /Invalid retrieval options/,
  );
});

test("unrelated functions and near copies stay with their own source", (t) => {
  const unrelated = candidatesOf(project(t, { "other.ts": OTHER }));
  assert.equal(unrelated.candidates.length, 0);
  assert.equal(unrelated.stats.lowOverlap.passing, 0);
  const near = candidatesOf(project(t, twoFiles));
  assert.deepEqual(
    near.candidates.map((c) => c.facts.provenance),
    Array(3).fill("token_shingles_not_semantic_equivalence"),
  );
  assert.equal(near.stats.lowOverlap.candidates, 0);
});

test("invalid low-overlap options are refused", (t) => {
  const root = project(t, rewrittenCopies);
  for (const lowOverlap of [
    { cap: -1 },
    { cap: 1.5 },
    { minScore: 2 },
    { minSurface: 0 },
    { maxDocumentFrequency: 1 },
  ])
    assert.throws(
      () => candidatesOf(root, { lowOverlap }),
      /Invalid retrieval options/,
    );
});

test("--low-overlap is validated and reported in the dry run summary", (t) => {
  const root = project(t, rewrittenCopies),
    cwd = scratch(t);
  const run = (...args) =>
    spawnSync(process.execPath, [cli, "scan", root, ...args], {
      cwd,
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
  assert.match(
    run().stdout,
    /Units: 5 functions, 2 similar pairs \(2 from the low-overlap source\)/,
  );
  assert.match(
    run("--low-overlap", "1").stdout,
    /Units: 5 functions, 1 similar pair \(1 from/,
  );
  assert.match(
    run("--low-overlap", "0").stdout,
    /Units: 5 functions, 0 similar pairs\n/,
  );
  assert.match(
    run("--low-overlap", "x").stderr,
    /--low-overlap must be an integer from 0 to 2000/,
  );
});
