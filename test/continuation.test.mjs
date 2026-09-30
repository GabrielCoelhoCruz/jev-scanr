import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { hash } from "../src/core.mjs";
import { verifyPlan } from "../src/plan.mjs";
import { readJournal } from "../src/runner.mjs";
import { buildReport } from "../src/report.mjs";
import { continuationPlan, combineRuns } from "../src/continuation.mjs";
import { plan, scratch, fake, response, positive, run } from "./helpers.mjs";

async function stopped(t) {
  const p = plan(t),
    dir = join(scratch(t), "base");
  let n = 0;
  const first = await run(
    p,
    dir,
    fake(async (r) =>
      ++n === 3 ? { ...response(r), model: "x" } : response(r, positive(0.9)),
    ),
  );
  assert.equal(first.stoppedReason, "first_error");
  return { p, dir, first, events: readJournal(dir, p) };
}

test("a continuation holds exactly the unanswered requests, byte-identical to the base plan", async (t) => {
  const { p, events } = await stopped(t);
  const answered = new Set(
    events
      .filter((e) => e.type === "finished" && e.status === "succeeded")
      .map((e) => e.unitId),
  );
  const next = continuationPlan(p, [{ plan: p, events }]);
  assert.deepEqual(
    next.requests,
    p.requests.filter((r) => !answered.has(r.unitId)),
  );
  assert.equal(next.continuationOf.basePlanHash, p.planHash);
  assert.equal(
    next.planHash,
    continuationPlan(p, [{ plan: p, events }]).planHash,
  );
  assert.ok(next.requests.length > 0);
  verifyPlan(next);
  assert.throws(
    () => continuationPlan(next, [{ plan: next, events }]),
    /one base plan|base plan/,
  );
});

test("combined runs answer every request once, keep the superseded failure and add the costs", async (t) => {
  const { p, first, events } = await stopped(t);
  const next = continuationPlan(p, [{ plan: p, events }]);
  const dir = join(scratch(t), "cont");
  const second = await run(
    next,
    dir,
    fake(async (r) => response(r, positive(0.9))),
  );
  assert.equal(second.complete, true);
  const runs = [
    { plan: p, events },
    { plan: next, events: readJournal(dir, next) },
  ];
  const { events: combined, accounting } = combineRuns(p, runs);
  assert.equal(accounting.complete, true);
  assert.equal(accounting.answeredRequests, p.requests.length);
  assert.equal(accounting.supersededFailures.length, 1);
  assert.equal(
    accounting.knownInputTokens,
    first.knownInputTokens + second.knownInputTokens,
  );
  const report = buildReport(p, combined);
  assert.equal(report.statusCounts.error ?? 0, 0);
  assert.equal(report.statusCounts.unattempted ?? 0, 0);
  assert.throws(
    () => combineRuns(p, [runs[0], runs[1], runs[1]]),
    /does not match|Nothing to continue/,
  );
});

test("a forged continuation plan is rejected when combining", async (t) => {
  const { p, events } = await stopped(t);
  const next = continuationPlan(p, [{ plan: p, events }]);
  const dir = join(scratch(t), "cont");
  await run(next, dir);
  const forged = structuredClone(next);
  forged.requests = forged.requests.slice(1);
  forged.units = forged.units.filter((u) => u.id !== next.requests[0].unitId);
  forged.unitManifest = forged.unitManifest.filter((u) =>
    forged.units.some((q) => q.unitId === u.unitId),
  );
  const { planHash: _h, ...body } = forged;
  forged.planHash = hash(body);
  assert.throws(
    () =>
      combineRuns(p, [
        { plan: p, events },
        { plan: forged, events: readJournal(dir, next) },
      ]),
    /does not match|integrity|mismatch/,
  );
});
