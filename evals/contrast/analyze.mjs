#!/usr/bin/env node
// Offline analyzer for the constructed-contrast evaluation. Reads evals/contrast/units.json and a source of
// P(positive option) per unit (a live run's journal, a scores file, or a fake source for validation).
// Never makes a request.
//
//   node evals/contrast/analyze.mjs --journal RUN/journal.jsonl [--markdown] [--out result.json]
//   node evals/contrast/analyze.mjs --fake random|oracle|inverse-oracle|feature[:NAME] [--markdown]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { auc, mulberry32 } from "../lib/stats.mjs";
import { fakeScores } from "./lib/fake.mjs";

export const HEURISTICS = {
  A: ["lines", "statements", "cyclomatic", "params", "tokens"],
  B: [
    "shingleJaccard",
    "tokenCoverage10",
    "rawJaccard5",
    "vocabJaccard",
    "minLines",
    "sizeRatio",
    "minTokens",
  ],
  C: [
    "lines",
    "statements",
    "cyclomatic",
    "params",
    "tokens",
    "nameWordsMissingFromBody",
  ],
};

HEURISTICS.A2 = HEURISTICS.A;
HEURISTICS.B2 = [...HEURISTICS.B, "surfaceJaccard"];
export const SECONDARY = { B: "vocabJaccard", B2: "surfaceJaccard" };

const quantile = (sorted, q) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    : null;
const interval = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return { lo: quantile(sorted, 0.025), hi: quantile(sorted, 0.975) };
};

function binomialTwoSided(k, n) {
  if (!n) return null;
  let total = 0;
  const pmf = (i) => {
    let c = 1;
    for (let j = 1; j <= i; j++) c = (c * (n - i + j)) / j;
    return c / 2 ** n;
  };
  const observed = pmf(k);
  for (let i = 0; i <= n; i++) if (pmf(i) <= observed + 1e-12) total += pmf(i);
  return Math.min(1, total);
}

export function scoresFromJournal(text, doc) {
  const presence = Object.fromEntries(
    Object.entries(doc.sets).map(([id, s]) => [id, [s.signal, s.presence]]),
  );
  const setOf = new Map(doc.units.map((u) => [u.id, u.set]));
  const scores = new Map();
  for (const line of text.trim().split("\n")) {
    const e = JSON.parse(line);
    if (e.type !== "finished" || e.status !== "succeeded") continue;
    const [signal, positive] = presence[setOf.get(e.unitId)];
    const answer = e.response.answers[signal];
    scores.set(e.unitId, {
      p: answer.probabilities[positive],
      choice: answer.choice,
    });
  }
  return scores;
}

export function analyzeContrast(
  doc,
  scores,
  { resamples = 2000, seed = 20260930, cut = 0.7 } = {},
) {
  const result = {
    schema: "contrast-result/1",
    cut,
    resamples,
    seed,
    sets: {},
  };
  for (const [id, meta] of Object.entries(doc.sets)) {
    const rows = doc.units
      .filter((u) => u.set === id)
      .map((u) => ({ u, y: u.label, s: scores.get(u.id) ?? null }));
    const scored = rows.filter((r) => r.s && Number.isFinite(r.s.p));
    const scorers = {
      jev: (r) => r.s.p,
      ...Object.fromEntries(
        HEURISTICS[id]
          .filter((h) => scored.every((r) => r.u.features[h] !== undefined))
          .map((h) => [h, (r) => r.u.features[h]]),
      ),
    };
    const aucOf = (list, get) =>
      auc(
        list.map(get),
        list.map((r) => r.y),
      );
    const clusterKey = (r) => (id === "C" ? `pair${r.u.pairId}` : r.u.id);
    const clusters = [...Map.groupBy(scored, clusterKey).values()];
    const random = mulberry32(seed ^ id.charCodeAt(0));
    const draws = Object.fromEntries(Object.keys(scorers).map((k) => [k, []]));
    const diffs = [],
      diffs2 = [],
      second = SECONDARY[id];
    const main = meta.mainHeuristic;
    for (let b = 0; b < resamples; b++) {
      const list = Array.from(
        { length: clusters.length },
        () => clusters[Math.floor(random() * clusters.length)],
      ).flat();
      const values = {};
      for (const [k, get] of Object.entries(scorers)) {
        values[k] = aucOf(list, get);
        draws[k].push(values[k]);
      }
      if (values.jev !== null && values[main] !== null)
        diffs.push(values.jev - values[main]);
      if (second && values.jev !== null && values[second] !== null)
        diffs2.push(values.jev - values[second]);
    }
    const summary = (k) => ({
      auc: scored.length ? aucOf(scored, scorers[k]) : null,
      ...interval(draws[k]),
    });
    const jev = summary("jev");
    const heuristics = Object.fromEntries(
      Object.keys(scorers)
        .filter((k) => k !== "jev")
        .map((k) => [k, { ...summary(k), main: k === main }]),
    );
    const diff = {
      value: jev.auc === null ? null : jev.auc - heuristics[main].auc,
      ...interval(diffs),
    };
    const mean = (xs) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const pos = scored.filter((r) => r.y),
      neg = scored.filter((r) => !r.y);
    const nonInsufficient = scored.filter((r) => r.s.choice !== "insufficient");
    const sensitivity = {
      excludingInsufficient: {
        n: nonInsufficient.length,
        auc: nonInsufficient.length
          ? aucOf(nonInsufficient, scorers.jev)
          : null,
      },
    };
    const entry = {
      signal: meta.signal,
      units: rows.length,
      scored: scored.length,
      unscored: rows.length - scored.length,
      positives: pos.length,
      controls: neg.length,
      mainHeuristic: main,
      jev,
      heuristics,
      diff,
      matched: heuristics[main].lo <= 0.5 && heuristics[main].hi >= 0.5,
      meanP: {
        positive: mean(pos.map((r) => r.s.p)),
        control: mean(neg.map((r) => r.s.p)),
      },
      atCut: {
        positiveRate: pos.length
          ? pos.filter((r) => r.s.p >= cut).length / pos.length
          : null,
        controlRate: neg.length
          ? neg.filter((r) => r.s.p >= cut).length / neg.length
          : null,
      },
      sensitivity,
    };
    if (id === "B2") {
      const hard = neg.filter((r) => r.u.features.surfaceJaccard >= 0.8);
      entry.hardNegatives = {
        n: hard.length,
        surfaceThreshold: 0.8,
        meanP: mean(hard.map((r) => r.s.p)),
        atCut: hard.length
          ? hard.filter((r) => r.s.p >= cut).length / hard.length
          : null,
        note: "Different functions that share most literals, property names and type names. Some may truly share a policy, so a high P here is not automatically an error.",
      };
    }
    if (id === "C") {
      const byPair = Map.groupBy(scored, (r) => r.u.pairId);
      const deltas = [...byPair.values()]
        .filter((g) => g.length === 2)
        .map((g) => g.find((r) => r.y).s.p - g.find((r) => !r.y).s.p);
      const meanDraws = [];
      for (let b = 0; b < resamples; b++)
        meanDraws.push(
          mean(
            Array.from(
              { length: deltas.length },
              () => deltas[Math.floor(random() * deltas.length)],
            ),
          ),
        );
      const up = deltas.filter((d) => d > 0).length,
        down = deltas.filter((d) => d < 0).length;
      entry.paired = {
        pairs: deltas.length,
        meanDelta: mean(deltas),
        ...interval(meanDraws),
        higher: up,
        lower: down,
        tied: deltas.length - up - down,
        signTestP: binomialTwoSided(up, up + down),
      };
    }
    if (second)
      entry.diffSecondary = {
        against: second,
        value: jev.auc === null ? null : jev.auc - heuristics[second].auc,
        ...interval(diffs2),
      };
    entry.verdict = verdict(entry);
    result.sets[id] = entry;
  }
  return result;
}

export function retest(doc, scores, earlierScores) {
  const rows = doc.units
    .filter((u) => u.reuses && scores.has(u.id) && earlierScores.has(u.reuses))
    .map((u) => ({
      set: u.set,
      label: u.label,
      a: earlierScores.get(u.reuses),
      b: scores.get(u.id),
    }));
  const summarize = (list) => {
    const d = list.map((r) => r.b.p - r.a.p);
    const n = list.length;
    const mean = (xs) => xs.reduce((x, y) => x + y, 0) / (xs.length || 1);
    const ma = mean(list.map((r) => r.a.p)),
      mb = mean(list.map((r) => r.b.p));
    const cov = mean(list.map((r) => (r.a.p - ma) * (r.b.p - mb)));
    const va = mean(list.map((r) => (r.a.p - ma) ** 2)),
      vb = mean(list.map((r) => (r.b.p - mb) ** 2));
    const crossing = (t) =>
      list.filter((r) => r.a.p >= t !== r.b.p >= t).length;
    return {
      n,
      meanAbsChange: mean(d.map(Math.abs)),
      maxAbsChange: Math.max(0, ...d.map(Math.abs)),
      meanSignedChange: mean(d),
      changedByMoreThan005: d.filter((x) => Math.abs(x) > 0.05).length,
      correlation: va && vb ? cov / Math.sqrt(va * vb) : null,
      choiceFlips: list.filter((r) => r.a.choice !== r.b.choice).length,
      crossing05: crossing(0.5),
      crossing07: crossing(0.7),
    };
  };
  return {
    schema: "contrast-retest/1",
    all: summarize(rows),
    bySet: Object.fromEntries(
      [...new Set(rows.map((r) => r.set))].map((set) => [
        set,
        summarize(rows.filter((r) => r.set === set)),
      ]),
    ),
  };
}

const f = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(2));
const span = (s) => `${f(s.auc)} (${f(s.lo)} to ${f(s.hi)})`;

function verdict(e) {
  const out = [];
  const h = e.heuristics[e.mainHeuristic];
  if (!e.matched)
    out.push(
      `UNMATCHED: the matched heuristic (${e.mainHeuristic}) separates the classes, AUC ${span(h)}. The set does not isolate judgment; read Jev only against this number.`,
    );
  else
    out.push(
      `Matched: ${e.mainHeuristic} AUC ${span(h)} includes 0.5, as constructed.`,
    );
  out.push(
    e.jev.lo !== null && e.jev.lo > 0.5
      ? `Jev separates the classes: AUC ${span(e.jev)}, interval above 0.5.`
      : `No detectable separation by Jev: AUC ${span(e.jev)}, interval includes 0.5 or lies below it.`,
  );
  if (e.diff.lo !== null)
    out.push(
      e.diff.lo > 0
        ? `Jev ahead of ${e.mainHeuristic}: AUC difference ${f(e.diff.value)} (${f(e.diff.lo)} to ${f(e.diff.hi)}).`
        : e.diff.hi < 0
          ? `Jev behind ${e.mainHeuristic}: AUC difference ${f(e.diff.value)} (${f(e.diff.lo)} to ${f(e.diff.hi)}).`
          : `No detectable difference from ${e.mainHeuristic}: AUC difference ${f(e.diff.value)} (${f(e.diff.lo)} to ${f(e.diff.hi)}).`,
    );
  const d2 = e.diffSecondary;
  if (d2 && d2.lo !== null)
    out.push(
      `Against the pre-registered secondary comparison ${d2.against}: AUC difference ${f(d2.value)} (${f(d2.lo)} to ${f(d2.hi)})${d2.lo > 0 ? ", Jev ahead" : d2.hi < 0 ? ", Jev behind" : ", no detectable difference"}.`,
    );
  const leaks = Object.entries(e.heuristics).filter(
    ([k, v]) => k !== e.mainHeuristic && (v.lo > 0.5 || v.hi < 0.5),
  );
  if (leaks.length)
    out.push(
      `Unmatched features that separate the classes: ${leaks.map(([k, v]) => `${k} ${span(v)}`).join("; ")}. A score that tracks these is not evidence of judgment.`,
    );
  return out;
}

export function markdown(result) {
  const lines = [
    `# Constructed-contrast result`,
    "",
    `AUC = chance that a random positive outscores a random control (0.5 = chance). Intervals: 95% percentile bootstrap, ${result.resamples} resamples, seed ${result.seed}${"C" in result.sets ? "; set C resamples pairs" : ""}. Display cut ${result.cut}.`,
    "",
  ];
  for (const [id, e] of Object.entries(result.sets)) {
    lines.push(
      `## Set ${id}: ${e.signal}`,
      "",
      `Scored ${e.scored} of ${e.units} units (${e.positives} positives, ${e.controls} controls).`,
      "",
      "| Scorer | AUC (95% interval) | Note |",
      "| --- | --- | --- |",
      `| Jev P(${e.signal}) | ${span(e.jev)} | |`,
      ...Object.entries(e.heuristics).map(
        ([k, v]) =>
          `| ${k} | ${span(v)} | ${v.main ? "matched by construction" : "not matched"} |`,
      ),
      "",
      `Mean P: positives ${f(e.meanP.positive)}, controls ${f(e.meanP.control)}. At the cut: ${f(e.atCut.positiveRate)} of positives, ${f(e.atCut.controlRate)} of controls. Excluding answers with choice insufficient: AUC ${f(e.sensitivity.excludingInsufficient.auc)} on ${e.sensitivity.excludingInsufficient.n} units.`,
      "",
    );
    if (e.paired)
      lines.push(
        `Paired view (same body, renamed against original): ${e.paired.pairs} pairs, mean P difference ${f(e.paired.meanDelta)} (${f(e.paired.lo)} to ${f(e.paired.hi)}); renamed higher in ${e.paired.higher}, lower in ${e.paired.lower}, tied in ${e.paired.tied}; two-sided sign test p = ${f(e.paired.signTestP)}.`,
        "",
      );
    if (e.hardNegatives)
      lines.push(
        `Hard negatives (surface overlap at least ${e.hardNegatives.surfaceThreshold}): ${e.hardNegatives.n} units, mean P ${f(e.hardNegatives.meanP)}, ${f(e.hardNegatives.atCut)} at the cut. ${e.hardNegatives.note}`,
        "",
      );
    lines.push(...e.verdict.map((v) => `- ${v}`), "");
  }
  return lines.join("\n");
}

export function balanceMarkdown(result) {
  const lines = [
    "| Set | Feature | AUC of the feature alone (95% interval) | Matched |",
    "| --- | --- | --- | --- |",
  ];
  for (const [id, e] of Object.entries(result.sets))
    for (const [k, v] of Object.entries(e.heuristics))
      lines.push(
        `| ${id} | ${k} | ${span(v)} | ${v.main ? "yes, by construction" : "no"} |`,
      );
  return lines.join("\n");
}

function main() {
  const { values } = parseArgs({
    options: {
      units: {
        type: "string",
        default: new URL("./units.json", import.meta.url).pathname,
      },
      journal: { type: "string" },
      fake: { type: "string" },
      out: { type: "string" },
      markdown: { type: "boolean" },
      balance: { type: "boolean" },
      "retest-of": { type: "string" },
      resamples: { type: "string", default: "2000" },
    },
  });
  const doc = JSON.parse(readFileSync(values.units, "utf8"));
  let scores;
  if (values.balance) scores = fakeScores(doc, "random");
  else if (values.journal)
    scores = scoresFromJournal(readFileSync(values.journal, "utf8"), doc);
  else if (values.fake) {
    const [kind, feature] = values.fake.split(":");
    scores = fakeScores(doc, kind, { feature });
  } else throw Error("Give --journal FILE or --fake KIND");
  if (values["retest-of"]) {
    const earlier = scoresFromJournal(
      readFileSync(values["retest-of"], "utf8"),
      JSON.parse(
        readFileSync(new URL("./units.json", import.meta.url), "utf8"),
      ),
    );
    const out = retest(doc, scores, earlier);
    return console.log(JSON.stringify(out, null, 2));
  }
  const result = analyzeContrast(doc, scores, {
    resamples: Number(values.resamples),
  });
  if (values.out)
    writeFileSync(values.out, JSON.stringify(result, null, 2) + "\n");
  if (values.balance) console.log(balanceMarkdown(result));
  else if (values.markdown) console.log(markdown(result));
  else if (!values.out) console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
