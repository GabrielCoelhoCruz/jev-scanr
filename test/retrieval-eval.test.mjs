import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pairLevel, repoLevel } from "../evals/retrieval/validate.mjs";
import { measure } from "../evals/retrieval/names.mjs";
import { buildIndex } from "../src/index.mjs";
import { readSnapshot } from "../src/snapshot.mjs";
import { INVOICES, ORDERS, OTHER } from "./fixtures/copies.mjs";
import { project } from "./helpers.mjs";

const committed = JSON.parse(
  readFileSync(new URL("../evals/retrieval/result.json", import.meta.url)),
);

test("the committed validation proposes every planted rewritten copy within the default cap", () => {
  assert.deepEqual(committed.totals, { planted: 50, found: 50, maxRank: 38 });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(committed.repos).map(([repo, r]) => [
        repo,
        [r.planted, r.found, r.ranks.at(-1), r.proposedLowOverlap],
      ]),
    ),
    {
      "paulrobello/claude-office": [8, 8, 12, 50],
      "reshaped-ui/reshaped": [8, 8, 38, 50],
      "pingdotgg/t3code": [17, 17, 24, 28],
      "can1357/oh-my-pi": [17, 17, 25, 50],
    },
  );
});

test("the committed pair-level numbers keep the false proposals visible", () => {
  const { B, B2 } = committed.pairLevel;
  assert.deepEqual(
    [B.positives.k, B.positives.n, B.negatives.k, B.negatives.n],
    [50, 50, 17, 50],
  );
  assert.deepEqual(
    [B2.negatives.k, B2.negatives.n, B2.hardNegatives.k, B2.hardNegatives.n],
    [29, 50, 18, 28],
  );
  assert.equal(Math.min(...B.scores.positives), 0.6066);
});

test("the committed same-repo pair rates come from an exhaustive count", () => {
  assert.deepEqual(
    Object.values(committed.repos).map((r) => [
      r.sameRepoPairs.k,
      r.sameRepoPairs.n,
      r.sameRepoPairs.foundByIndex,
    ]),
    [
      [65, 208335, 65],
      [54, 123256, 54],
      [5, 55278, 5],
      [184, 5788503, 179],
    ],
  );
});

test("pairLevel labels a rewritten copy proposed and two unrelated functions not", (t) => {
  const root = project(t, {
    "u/copy/a.ts": ORDERS,
    "u/copy/b.ts": INVOICES,
    "u/apart/a.ts": ORDERS,
    "u/apart/b.ts": OTHER,
  });
  const unit = (id, label) => ({
    id,
    label,
    features: {},
    files: ["a", "b"].map((x) => ({ path: `u/${id}/${x}.ts` })),
  });
  const result = pairLevel(root, [unit("copy", 1), unit("apart", 0)]);
  assert.deepEqual(result.positives, {
    k: 1,
    n: 1,
    rate: 1,
    wilson95: [0.2065, 1],
    reasons: { proposed: 1 },
  });
  assert.deepEqual(result.negatives.reasons, { score: 1 });
});

test("repoLevel ranks the planted copy against its original", (t) => {
  const root = project(t, {
    "orders.ts": ORDERS,
    "other.ts": OTHER,
    "__planted__/p0.ts": INVOICES,
  });
  const result = repoLevel(root, [{}], [{ path: "orders.ts", startLine: 1 }]);
  assert.deepEqual(
    [result.planted, result.found, result.ranks, result.maxRank],
    [1, 1, [1], 1],
  );
  assert.deepEqual(result.sameRepoPairs.k, 0);
});

const names = JSON.parse(
  readFileSync(
    new URL("../evals/retrieval/names-result.json", import.meta.url),
  ),
);

test("the committed name-cue validation keeps selectivity and the recall of unrelated renames visible", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(names.repos).map(([repo, r]) => [
        repo,
        [r.named, r.selectivity.k, r.renamedPassing.k, r.sampled],
      ]),
    ),
    {
      "paulrobello/claude-office": [509, 78, 271, 300],
      "reshaped-ui/reshaped": [361, 78, 285, 300],
      "pingdotgg/t3code": [1456, 301, 275, 300],
      "can1357/oh-my-pi": [3806, 474, 270, 300],
    },
  );
  assert.deepEqual(
    [names.pooled.selectivity.k, names.pooled.selectivity.n],
    [931, 6132],
  );
  assert.deepEqual(
    [names.pooled.renamedPassing.k, names.pooled.renamedPassing.n],
    [1101, 1200],
  );
  assert.deepEqual(
    [names.constructed.positives.k, names.constructed.controls.k],
    [50, 50],
  );
});

test("measure counts functions the cue lets through and renames that still pass", (t) => {
  const source = (name, words) =>
    `export function ${name}(a: number[]) {\n  let ${words} = 0;\n  for (const x of a) ${words} += x;\n  return ${words};\n}\n`;
  const root = project(t, {
    "a.ts": [
      source("invoiceTotal", "acc"),
      source("sumRows", "sumRows"),
      source("parseDuration", "acc"),
      source("readConfig", "acc"),
    ].join(""),
  });
  const result = measure(buildIndex(readSnapshot(root)), 1, 4);
  assert.deepEqual(
    [result.named, result.selectivity.k, result.sampled],
    [4, 3, 4],
  );
  assert.equal(result.originalsPassingInSample.k, 3);
  assert.equal(result.renamedPassing.k, 4);
});
