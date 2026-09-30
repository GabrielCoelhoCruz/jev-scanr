#!/usr/bin/env node
// Stage B of the free-baseline comparison: does Jev's stored P rank the labeled cells better than cheap,
// free heuristics (function length, statements, cyclomatic complexity, parameters; token similarity for pairs)?
// Offline, deterministic (seeded bootstrap), no API call. Input: evals/baseline/cells.json.
//
//   node evals/baseline/analyze.mjs [--cells FILE] [--out FILE] [--markdown]
//
// Declared before any number was computed:
//  * Population: every labeled cell of one default signal, both samples pooled. Positive = "actionable"
//    (an LLM reviewer's label; "uncertain" and "no_action" both count as not positive, as in evals/gate.json).
//    Primary labels: pass 1 (sealed before repository access). Pass 2, a second LLM and a gate-only
//    restriction are sensitivity views.
//  * Jev's rule: P >= 0.7 (the display cut). Equivalent cut for a heuristic: the same number of cells
//    (k = Jev's labeled above-cut count), taken from the top of the heuristic's ranking; ties at the edge
//    share the remaining slots in equal fractions.
//  * Primary heuristic per signal, fixed in advance: function length in lines for the two function signals,
//    jscpd-style token coverage (k=10) for clone_same_policy. The others are reported beside it. The best of
//    all heuristics is shown but labeled optimistic (it is picked after seeing the labels).
//  * Rank metric: AUC (ties count one half). Intervals: 95% percentile bootstrap over cells, 2000 resamples,
//    seed 20260930; differences use the same resamples (paired).
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { auc, bootstrap, precisionAtK } from "../lib/stats.mjs";

export const CUT = 0.7;
export const RESAMPLES = 2000;
export const SEED = 20260930;

export const HEURISTICS = {
  function_should_split: [
    "lines",
    "statements",
    "cyclomatic",
    "params",
    "tokens",
  ],
  function_multiple_responsibilities: [
    "lines",
    "statements",
    "cyclomatic",
    "params",
    "tokens",
  ],
  clone_same_policy: [
    "jscpdCoverage10",
    "retrievalJaccard",
    "rawJaccard5",
    "minLines",
  ],
};
const DESCRIPTION = {
  lines: "function length (lines)",
  statements: "statement count",
  cyclomatic: "cyclomatic complexity",
  params: "parameter count",
  tokens: "token count",
  jscpdCoverage10: "jscpd-style duplicated-token coverage (k=10)",
  retrievalJaccard: "5-token shingle Jaccard (the scanner's pairing score)",
  rawJaccard5: "raw-token 5-gram Jaccard",
  minLines: "size of the smaller member (lines)",
};
export const PRIMARY = {
  function_should_split: "lines",
  function_multiple_responsibilities: "lines",
  clone_same_policy: "jscpdCoverage10",
};
export const VIEWS = [
  { name: "pass1", label: "pass1", sample: "all" },
  { name: "pass2", label: "pass2", sample: "all" },
  { name: "pass1-gate-only", label: "pass1", sample: "gate" },
  { name: "second-llm", label: "second", sample: "all" },
];

const interval = (xs) => {
  if (xs.length < 20) return null;
  const s = [...xs].sort((a, b) => a - b);
  return [
    s[Math.floor(0.025 * (s.length - 1))],
    s[Math.ceil(0.975 * (s.length - 1))],
  ];
};
const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
const roundCI = (ci) => (ci ? ci.map(round) : null);
const verdict = (ci) =>
  !ci
    ? "n/a"
    : ci[0] > 0
      ? "jev_ahead"
      : ci[1] < 0
        ? "baseline_ahead"
        : "no_detectable_difference";

function measure(rows, feature) {
  const y = rows.map((r) => r.y),
    jev = rows.map((r) => r.p),
    h = rows.map((r) => r.features[feature]);
  const k = jev.filter((p) => p >= CUT).length;
  return {
    jevAuc: auc(jev, y),
    hAuc: auc(h, y),
    k,
    jevP: k
      ? y.filter((_, i) => jev[i] >= CUT).reduce((a, b) => a + b, 0) / k
      : null,
    hP: precisionAtK(h, y, k),
  };
}

export function analyzeSignal(cells, signalId, view) {
  const rows = cells
    .filter(
      (c) =>
        c.signalId === signalId &&
        (view.sample === "all" || c.sample === view.sample) &&
        c.labels[view.label],
    )
    .map((c) => ({
      p: c.p,
      y: c.labels[view.label] === "actionable" ? 1 : 0,
      features: c.features,
    }));
  const positives = rows.reduce((n, r) => n + r.y, 0);
  const base = {
    n: rows.length,
    actionable: positives,
    baseRate: rows.length ? round(positives / rows.length) : null,
    aboveCut: rows.filter((r) => r.p >= CUT).length,
    aboveCutActionable: rows.filter((r) => r.p >= CUT && r.y).length,
  };
  if (!rows.length || positives === 0 || positives === rows.length)
    return {
      ...base,
      note: "one class only: AUC is undefined",
      heuristics: {},
    };
  const jev = measure(rows, HEURISTICS[signalId][0]);
  const out = {
    ...base,
    jev: { auc: round(jev.jevAuc), precisionAtCut: round(jev.jevP) },
    heuristics: {},
  };
  const jevAucs = [],
    jevPs = [];
  const perFeature = Object.fromEntries(
    HEURISTICS[signalId].map((f) => [
      f,
      { hAuc: [], dAuc: [], hP: [], dP: [] },
    ]),
  );
  bootstrap(rows, RESAMPLES, SEED, (sample) => {
    const classes = sample.reduce((n, r) => n + r.y, 0);
    if (classes === 0 || classes === sample.length) return;
    let first = true;
    for (const f of HEURISTICS[signalId]) {
      const m = measure(sample, f);
      if (first) {
        jevAucs.push(m.jevAuc);
        if (m.jevP !== null) jevPs.push(m.jevP);
        first = false;
      }
      const slot = perFeature[f];
      slot.hAuc.push(m.hAuc);
      slot.dAuc.push(m.jevAuc - m.hAuc);
      if (m.jevP !== null) {
        slot.hP.push(m.hP);
        slot.dP.push(m.jevP - m.hP);
      }
    }
  });
  out.jev.aucCI = roundCI(interval(jevAucs));
  out.jev.precisionAtCutCI = roundCI(interval(jevPs));
  for (const f of HEURISTICS[signalId]) {
    const m = measure(rows, f),
      slot = perFeature[f];
    const dAucCI = interval(slot.dAuc),
      dPCI = interval(slot.dP);
    out.heuristics[f] = {
      description: DESCRIPTION[f],
      auc: round(m.hAuc),
      aucCI: roundCI(interval(slot.hAuc)),
      deltaAuc: round(m.jevAuc - m.hAuc),
      deltaAucCI: roundCI(dAucCI),
      aucVerdict: verdict(dAucCI),
      precisionAtK: round(m.hP),
      precisionAtKCI: roundCI(interval(slot.hP)),
      deltaPrecision: m.hP === null ? null : round(m.jevP - m.hP),
      deltaPrecisionCI: roundCI(dPCI),
      precisionVerdict: verdict(dPCI),
    };
  }
  return out;
}

export function analyze(data) {
  const signals = Object.keys(HEURISTICS);
  const views = Object.fromEntries(
    VIEWS.map((view) => [
      view.name,
      Object.fromEntries(
        signals.map((s) => [s, analyzeSignal(data.cells, s, view)]),
      ),
    ]),
  );
  return {
    schema: "baseline-result/1",
    cut: CUT,
    resamples: RESAMPLES,
    seed: SEED,
    primary: PRIMARY,
    cells: data.cells.length,
    views,
  };
}

const pct = (x) =>
  x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`;
const num = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(2));
const span = (ci, f = num) => (ci ? `${f(ci[0])} to ${f(ci[1])}` : "n/a");

export function markdown(result, viewName = "pass1") {
  const lines = [];
  for (const [signalId, r] of Object.entries(result.views[viewName])) {
    const primary = r.heuristics?.[PRIMARY[signalId]];
    lines.push(
      `| \`${signalId}\` | ${r.n} (${r.actionable}) | ${r.aboveCut} | ${r.aboveCutActionable}/${r.aboveCut} = ${pct(r.jev ? r.jev.precisionAtCut : null)} | ${primary ? `${pct(primary.precisionAtK)}` : "n/a"} | ${r.jev ? num(r.jev.auc) : "n/a"} (${span(r.jev?.aucCI)}) | ${primary ? `${num(primary.auc)} (${span(primary.aucCI)})` : "n/a"} | ${primary ? `${num(primary.deltaAuc)} (${span(primary.deltaAucCI)})` : "n/a"} |`,
    );
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      cells: {
        type: "string",
        default: new URL("./cells.json", import.meta.url).pathname,
      },
      out: { type: "string" },
      markdown: { type: "boolean" },
    },
  });
  const result = analyze(JSON.parse(readFileSync(values.cells, "utf8")));
  if (values.out)
    writeFileSync(values.out, JSON.stringify(result, null, 2) + "\n");
  if (values.markdown)
    for (const v of Object.keys(result.views))
      console.log(`\n${v}\n${markdown(result, v)}`);
  else if (!values.out) console.log(JSON.stringify(result, null, 2));
}
