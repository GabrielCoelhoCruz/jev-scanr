import { readFileSync } from "node:fs";
import { hash } from "../../src/core.mjs";
import { key } from "./labels.mjs";
import { noiseFloor, rate, wilson } from "./stats.mjs";

export const DEFAULT_RULE = JSON.parse(
  readFileSync(new URL("../gate.json", import.meta.url)),
);
export const ruleSHA256 = (rule = DEFAULT_RULE) => hash(rule);

const tally = (rows) => ({
  n: rows.length,
  actionable: rows.filter((r) => r.label === "actionable").length,
  uncertain: rows.filter((r) => r.label === "uncertain").length,
});

export function evaluateGate({
  sample,
  labels,
  calibration = null,
  rule = DEFAULT_RULE,
}) {
  const joined = [],
    unlabeled = [];
  for (const s of sample) {
    const l = labels.labels.get(key(s.cardId, s.signalId));
    if (l) joined.push({ ...s, label: l.label });
    else unlabeled.push(s);
  }
  const labelerOk =
    labels.source.type === "human" ||
    (labels.source.type === "llm_reviewer" &&
      calibration?.calibrated === true &&
      calibration.judge?.who === labels.source.who);
  const stable = rule.stable;
  const signals = {};
  for (const id of new Set(sample.map((s) => s.signalId))) {
    const mine = joined.filter((r) => r.signalId === id);
    const above = mine.filter((r) => r.stratum === stable.aboveCutStratum);
    const below = mine.filter((r) => stable.belowCutStrata.includes(r.stratum));
    const top = mine.filter((r) => r.stratum === rule.alpha.aboveCutStratum);
    const a = tally(above),
      b = tally(below);
    const aboveRate = rate(a.actionable, a.n),
      belowRate = rate(b.actionable, b.n);
    const projects = new Set(above.map((r) => r.project)).size;
    const reasons = [];
    if (!labelerOk)
      reasons.push("labels are not from a human or a calibrated judge");
    if (a.n < stable.minReviewedAboveCut)
      reasons.push(
        `only ${a.n} random above-cut cells reviewed, need ${stable.minReviewedAboveCut}`,
      );
    if (projects < stable.minProjects)
      reasons.push(
        `cells come from ${projects} project(s), need ${stable.minProjects}`,
      );
    let verdict = "experimental";
    if (!reasons.length) {
      const beats =
        !stable.mustExceedBelowCutRate ||
        (belowRate === null ? true : aboveRate > belowRate);
      if (aboveRate >= stable.actionableRate && beats) verdict = "default";
      else if (aboveRate >= stable.lowPrecisionRate && beats)
        verdict = "default_low_precision";
      else
        reasons.push(
          `actionable rate ${(aboveRate * 100).toFixed(0)}% ${beats ? "is below the bar" : "does not beat the below-cut rate"}`,
        );
    }
    const floor = noiseFloor(a.n);
    signals[id] = {
      verdict,
      reasons,
      aboveCut: {
        ...a,
        rate: aboveRate,
        ci95: wilson(a.actionable, a.n),
        noiseFloor: floor,
        projects,
      },
      belowCut: { ...b, rate: belowRate },
      withinNoiseOfBar:
        floor !== null &&
        aboveRate !== null &&
        [stable.actionableRate, stable.lowPrecisionRate].some(
          (bar) => Math.abs(aboveRate - bar) <= floor,
        ),
      topRankedSampleIgnored: top.length,
    };
  }
  const r = rule.release;
  const defaults = Object.values(signals).filter((s) =>
    r.countsAsDefault.includes(s.verdict),
  ).length;
  const release = {
    defaultSignals: defaults,
    outcome: !labelerOk
      ? "not_decidable"
      : defaults >= r.stableAtLeast
        ? "stable"
        : defaults <= r.pivotAtMost
          ? "pivot"
          : r.between,
  };
  return {
    schema: "signal-gate-result/1",
    ruleSHA256: ruleSHA256(rule),
    labeler: labels.source,
    labelerOk,
    calibration: calibration
      ? {
          calibrated: calibration.calibrated,
          agreement: calibration.agreement,
          clearCases: calibration.clearCases,
        }
      : null,
    unlabeledSampleRows: unlabeled.length,
    release,
    signals,
  };
}
