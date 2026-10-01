import { hash, POLICY } from "./core.mjs";
import { verifyPlan } from "./plan.mjs";
import { summarize } from "./runner.mjs";

const sameRequests = (a, b) =>
  hash(a.requests.map((r) => [r.unitId, r.requestHash])) ===
  hash(b.requests.map((r) => [r.unitId, r.requestHash]));

const answersBelongTo = (plan, events) =>
  events
    .filter((e) => e.type === "reserved")
    .every((e) =>
      plan.requests.some(
        (r) => r.unitId === e.unitId && r.requestHash === e.requestHash,
      ),
    );

function mergeFinished(basePlan, runs) {
  const baseUnits = new Set(basePlan.requests.map((r) => r.unitId));
  const outcomes = new Map(),
    superseded = [];
  runs.forEach(({ plan, events }, runIndex) => {
    if (events[0]?.type !== "initialized" || !answersBelongTo(plan, events))
      throw Error("Run journal does not belong to its plan");
    if (events[0].mode !== runs[0].events[0].mode)
      throw Error("Combined runs must share one mode");
    const stats = summarize(events, plan);
    if (stats.unknownAttempts || stats.unresolvedReservations)
      throw Error("Unknown attempts cannot be continued or combined");
    for (const e of events.filter((x) => x.type === "finished")) {
      if (!baseUnits.has(e.unitId))
        throw Error("Outcome outside the base plan");
      const prior = outcomes.get(e.unitId);
      if (prior?.status === "succeeded")
        throw Error("A request was answered twice");
      if (prior)
        superseded.push({
          unitId: e.unitId,
          runIndex: prior.runIndex,
          failure: prior.event.failure?.validation ?? prior.event.failure?.kind,
        });
      outcomes.set(e.unitId, { runIndex, status: e.status, event: e });
    }
  });
  return { outcomes, superseded };
}

export function subsetPlan(basePlan, requestUnitIds, extra) {
  verifyPlan(basePlan);
  const chosen = new Set(requestUnitIds);
  const requests = basePlan.requests.filter((r) => chosen.has(r.unitId));
  if (!requests.length || requests.length !== chosen.size)
    throw Error("Subset must name existing requests");
  const units = basePlan.units.filter((p) =>
    basePlan.units.some((q) => q.unitId === p.unitId && chosen.has(q.id)),
  );
  const unitIds = new Set(units.map((p) => p.unitId));
  const bytes = requests.reduce((n, r) => n + r.serializedBytes, 0);
  const { planHash: basePlanHash, ...base } = basePlan;
  const plan = {
    ...base,
    unitManifest: basePlan.unitManifest.filter((u) => unitIds.has(u.unitId)),
    units,
    requests,
    estimates: {
      ...basePlan.estimates,
      requests: requests.length,
      questions: requests.reduce(
        (n, r) => n + Object.keys(r.request.questions).length,
        0,
      ),
      serializedRequestBytes: bytes,
      heuristicInputTokensBytesDiv3: Math.ceil(bytes / 3),
      heuristicUSDBytesDiv3:
        (Math.ceil(bytes / 3) * POLICY.inputUSDPerMillion) / 1e6,
      USDOneBytePerTokenSensitivity: (bytes * POLICY.inputUSDPerMillion) / 1e6,
      fullProviderReservationUSD:
        (requests.length * POLICY.maxInputTokens * POLICY.inputUSDPerMillion) /
        1e6,
    },
    ...extra(basePlanHash, requests),
  };
  return verifyPlan({ ...plan, planHash: hash(plan) });
}

export function continuationPlan(basePlan, priorRuns) {
  verifyPlan(basePlan);
  if (basePlan.continuationOf || basePlan.repeatOf)
    throw Error("Continuations extend one base plan");
  if (!priorRuns[0] || !sameRequests(priorRuns[0].plan, basePlan))
    throw Error("The first prior run must be the base plan");
  const { outcomes } = mergeFinished(basePlan, priorRuns);
  const missing = basePlan.requests
    .filter((r) => outcomes.get(r.unitId)?.status !== "succeeded")
    .map((r) => r.unitId);
  if (!missing.length) throw Error("Nothing to continue");
  const missingSet = new Set(missing);
  if (
    basePlan.units.some(
      (p) =>
        outcomes.get(p.id)?.status === "succeeded" &&
        basePlan.units.some(
          (q) => q.unitId === p.unitId && missingSet.has(q.id),
        ),
    )
  )
    throw Error("Partial-unit continuation is not supported");
  return subsetPlan(basePlan, missing, (basePlanHash, requests) => ({
    continuationOf: {
      basePlanHash,
      priorRunHeads: priorRuns.map((r) => r.events.at(-1).eventHash),
      requestUnitIds: requests.map((r) => r.unitId),
      scope:
        "Only base requests without a succeeded outcome: unsent requests and requests whose answer was rejected. Requests are byte-identical to the base plan.",
    },
  }));
}

export function combineRuns(basePlan, runs) {
  verifyPlan(basePlan);
  if (!runs[0] || !sameRequests(runs[0].plan, basePlan))
    throw Error("The first run must be the base plan");
  runs.slice(1).forEach(({ plan }, i) => {
    if (!sameRequests(continuationPlan(basePlan, runs.slice(0, i + 1)), plan))
      throw Error("Continuation plan does not match the prior runs");
  });
  const { outcomes, superseded } = mergeFinished(basePlan, runs);
  const perRun = runs.map(({ plan, events }) => ({
    planHash: plan.planHash,
    ...summarize(events, plan),
  }));
  const sum = (k) => perRun.reduce((n, r) => n + r[k], 0);
  const finished = basePlan.requests
    .filter((r) => outcomes.has(r.unitId))
    .map((r) => outcomes.get(r.unitId).event);
  const succeeded = finished.filter((e) => e.status === "succeeded").length;
  return {
    events: [
      {
        type: "initialized",
        planHash: basePlan.planHash,
        mode: runs[0].events[0].mode,
        combinedFrom: perRun.map((r) => r.planHash),
      },
      ...finished,
    ],
    accounting: {
      basePlanHash: basePlan.planHash,
      runs: perRun,
      plannedRequests: basePlan.requests.length,
      plannedQuestions: basePlan.estimates.questions,
      answeredRequests: succeeded,
      failedRequests: finished.length - succeeded,
      unattemptedRequests: basePlan.requests.length - finished.length,
      supersededFailures: superseded,
      complete: succeeded === basePlan.requests.length,
      reservedAttempts: sum("reservedAttempts"),
      knownInputTokens: sum("knownInputTokens"),
      knownOutputTokens: sum("knownOutputTokens"),
      knownEstimatedUSD: sum("knownEstimatedUSD"),
      invoiceVerified: false,
    },
  };
}
