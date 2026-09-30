import { createHash } from "node:crypto";
import { POLICY } from "../../src/core.mjs";
import { catalog } from "../../src/catalog.mjs";
import { runPlan, readJournal } from "../../src/runner.mjs";
import { subsetPlan } from "../../src/continuation.mjs";
import { verifyPlan, packSignals } from "../../src/plan.mjs";
import { noiseFloor } from "./stats.mjs";

const order = (seed, id) =>
  createHash("sha256").update(`${seed}|${id}`).digest("hex");

export function chooseRepeats(plan, events, { n, seed }) {
  const ok = new Set(
    events
      .filter((e) => e.type === "finished" && e.status === "succeeded")
      .map((e) => e.unitId),
  );
  return plan.requests
    .map((r) => r.unitId)
    .filter((id) => ok.has(id))
    .sort((a, b) => order(seed, a).localeCompare(order(seed, b)))
    .slice(0, n);
}

export function compareRuns(
  plan,
  first,
  second,
  { threshold = 0.05, cut = catalog.displayThresholdDefault, rule = 0.2 } = {},
) {
  const answers = (events) =>
    new Map(
      events
        .filter((e) => e.type === "finished" && e.status === "succeeded")
        .map((e) => [e.unitId, e.response.answers]),
    );
  const a = answers(first),
    b = answers(second);
  const cells = [];
  const requestsOver = new Set();
  for (const [unitId, second_] of b) {
    const pack = plan.units.find((p) => p.id === unitId);
    for (const signal of packSignals(pack)) {
      const x = a.get(unitId)?.[signal.id],
        y = second_[signal.id];
      if (!x || !y) continue;
      const p1 = x.probabilities[signal.presence],
        p2 = y.probabilities[signal.presence];
      cells.push({
        unitId,
        signalId: signal.id,
        p1,
        p2,
        delta: Math.abs(p1 - p2),
        flip: x.choice !== y.choice,
        crossesCut: p1 >= cut !== p2 >= cut,
        insufficientOnce:
          (x.choice === "insufficient") !== (y.choice === "insufficient"),
      });
      if (Math.abs(p1 - p2) > threshold + 1e-9) requestsOver.add(unitId);
    }
  }
  const over = cells.filter((c) => c.delta > threshold + 1e-9);
  return {
    threshold,
    cut,
    requests: b.size,
    cells: cells.length,
    cellsOverThreshold: over.length,
    shareCellsOver: cells.length ? over.length / cells.length : null,
    requestsOverThreshold: requestsOver.size,
    shareRequestsOver: b.size ? requestsOver.size / b.size : null,
    maxDelta: cells.reduce((m, c) => Math.max(m, c.delta), 0),
    meanDelta: cells.length
      ? cells.reduce((s, c) => s + c.delta, 0) / cells.length
      : null,
    choiceFlips: cells.filter((c) => c.flip).length,
    cutCrossings: cells.filter((c) => c.crossesCut).length,
    noiseFloorOfShare: noiseFloor(cells.length),
    registeredRule: `Show a range instead of a number, and require P at or above the cut in two calls, if |P1-P2| > ${threshold} in more than ${rule * 100}% of cells`,
    ruleTriggered: cells.length ? over.length / cells.length > rule : null,
    worst: [...cells].sort((x, y) => y.delta - x.delta).slice(0, 5),
  };
}

export async function measureVariance({
  plan,
  events,
  client,
  mode = "live",
  n,
  seed,
  capUSD,
  directory,
  intervalMs = POLICY.minIntervalMs,
  threshold,
  cut,
}) {
  verifyPlan(plan);
  const ids = chooseRepeats(plan, events, { n, seed });
  if (ids.length < n)
    throw Error(`Only ${ids.length} answered requests are available to repeat`);
  const repeat = subsetPlan(plan, ids, (basePlanHash, requests) => ({
    repeatOf: {
      basePlanHash,
      seed,
      requestUnitIds: requests.map((r) => r.unitId),
    },
  }));
  const summary = await runPlan({
    plan: repeat,
    directory,
    client,
    mode,
    capUSD,
    intervalMs,
  });
  if (!summary.complete)
    throw Error(`Repeat run stopped: ${summary.stoppedReason ?? "incomplete"}`);
  return {
    seed,
    requestsRepeated: ids.length,
    calculatedUSD: summary.knownEstimatedUSD,
    ...compareRuns(plan, events, readJournal(directory, repeat), {
      threshold,
      cut,
    }),
  };
}
