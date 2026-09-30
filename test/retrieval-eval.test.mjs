import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pairLevel, repoLevel } from "../evals/retrieval/validate.mjs";
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
