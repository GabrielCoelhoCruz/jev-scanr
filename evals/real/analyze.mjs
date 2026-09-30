#!/usr/bin/env node
// Offline analyzer for the real-code name_vs_behavior validation. Rules: evals/real/README.md, fixed before
// any label or request existed. Never makes a request.
//
//   node evals/real/analyze.mjs --journal RUN/journal.jsonl --labels evals/real/labels [--markdown] [--out FILE]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  auc,
  cohenKappa,
  mulberry32,
  precisionAtK,
  wilson,
} from "../lib/stats.mjs";
import { scoresFromJournal } from "../contrast/analyze.mjs";

export const LABELS = ["mismatch", "imprecise", "fits", "cannot_tell"];
export const HEURISTICS = [
  "lines",
  "statements",
  "cyclomatic",
  "params",
  "tokens",
  "nameMissing",
];
export const COMPARED = ["lines", "nameMissing"];
export const MIN_CLASS = 15;

export function parseLabels(text, doc) {
  const out = new Map();
  for (const line of text.trim().split("\n")) {
    const { id, label } = JSON.parse(line);
    if (out.has(id)) throw Error(`duplicate label for ${id}`);
    if (!LABELS.includes(label)) throw Error(`${id}: unknown label ${label}`);
    out.set(id, label);
  }
  const ids = new Set(doc.units.map((u) => u.id));
  if (out.size !== ids.size || [...out.keys()].some((id) => !ids.has(id)))
    throw Error(`labels must cover exactly the ${ids.size} units`);
  return out;
}

const klass = (label) =>
  label === "cannot_tell"
    ? "cannot_tell"
    : label === "mismatch"
      ? "mismatch"
      : "ok";

export function agreement(a, b) {
  const ids = [...a.keys()];
  const pairs4 = ids.map((id) => [a.get(id), b.get(id)]);
  const pairs3 = ids.map((id) => [klass(a.get(id)), klass(b.get(id))]);
  const table = {};
  for (const [x, y] of pairs4)
    table[`${x}|${y}`] = (table[`${x}|${y}`] ?? 0) + 1;
  const both = (k) => pairs3.filter(([x, y]) => x === k && y === k).length;
  return {
    items: ids.length,
    rawAgreement4: pairs4.filter(([x, y]) => x === y).length / ids.length,
    rawAgreement3: pairs3.filter(([x, y]) => x === y).length / ids.length,
    kappa4: cohenKappa(pairs4),
    kappa3: cohenKappa(pairs3),
    mismatchByFirst: pairs3.filter(([x]) => x === "mismatch").length,
    mismatchBySecond: pairs3.filter(([, y]) => y === "mismatch").length,
    mismatchByBoth: both("mismatch"),
    cannotTellByEither: pairs3.filter(
      ([x, y]) => x === "cannot_tell" || y === "cannot_tell",
    ).length,
    confusion: table,
  };
}

function views(first, second) {
  const ids = [...first.keys()];
  const single = (labels, lenient) =>
    Object.fromEntries(
      ids
        .filter((id) => labels.get(id) !== "cannot_tell")
        .map((id) => [
          id,
          lenient
            ? +["mismatch", "imprecise"].includes(labels.get(id))
            : +(labels.get(id) === "mismatch"),
        ]),
    );
  const agreed = Object.fromEntries(
    ids
      .filter(
        (id) =>
          klass(first.get(id)) === klass(second.get(id)) &&
          klass(first.get(id)) !== "cannot_tell",
      )
      .map((id) => [id, +(klass(first.get(id)) === "mismatch")]),
  );
  return {
    agreement_only: { primary: true, y: agreed },
    first_labeler: { primary: true, y: single(first, false) },
    second_labeler: { primary: true, y: single(second, false) },
    first_labeler_lenient: { primary: false, y: single(first, true) },
    second_labeler_lenient: { primary: false, y: single(second, true) },
  };
}

const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const interval = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length
    ? { lo: quantile(sorted, 0.025), hi: quantile(sorted, 0.975) }
    : { lo: null, hi: null };
};

function analyzeView(name, view, doc, scores, { resamples, seed, cut }) {
  const byId = new Map(doc.units.map((u) => [u.id, u]));
  const rows = Object.entries(view.y)
    .filter(([id]) => scores.has(id))
    .map(([id, y]) => ({ y, p: scores.get(id).p, f: byId.get(id).features }));
  const positives = rows.filter((r) => r.y).length,
    negatives = rows.length - positives;
  const get = {
    jev: (r) => r.p,
    ...Object.fromEntries(HEURISTICS.map((h) => [h, (r) => r.f[h]])),
  };
  const aucOf = (list, k) =>
    auc(
      list.map(get[k]),
      list.map((r) => r.y),
    );
  const random = mulberry32(seed ^ name.length);
  const draws = Object.fromEntries(Object.keys(get).map((k) => [k, []]));
  const diffs = Object.fromEntries(COMPARED.map((h) => [h, []]));
  for (let b = 0; b < resamples; b++) {
    const list = Array.from(
      { length: rows.length },
      () => rows[Math.floor(random() * rows.length)],
    );
    const v = Object.fromEntries(
      Object.keys(get).map((k) => [k, aucOf(list, k)]),
    );
    for (const k of Object.keys(get)) draws[k].push(v[k]);
    for (const h of COMPARED)
      if (v.jev !== null && v[h] !== null) diffs[h].push(v.jev - v[h]);
  }
  const point = Object.fromEntries(
    Object.keys(get).map((k) => [k, rows.length ? aucOf(rows, k) : null]),
  );
  const span = (k) => ({ auc: point[k], ...interval(draws[k]) });
  const flagged = rows.filter((r) => r.p >= cut);
  const hits = flagged.filter((r) => r.y).length;
  const w = wilson(hits, flagged.length);
  const atK = (h) =>
    flagged.length && positives
      ? precisionAtK(
          rows.map(get[h]),
          rows.map((r) => r.y),
          flagged.length,
        )
      : null;
  const underpowered = positives < MIN_CLASS || negatives < MIN_CLASS;
  const entry = {
    primary: view.primary,
    units: rows.length,
    positives,
    negatives,
    prevalence: rows.length ? positives / rows.length : null,
    underpowered,
    jev: span("jev"),
    heuristics: Object.fromEntries(HEURISTICS.map((h) => [h, span(h)])),
    diff: Object.fromEntries(
      COMPARED.map((h) => [
        h,
        {
          value: point.jev === null ? null : point.jev - point[h],
          ...interval(diffs[h]),
        },
      ]),
    ),
    atCut: {
      cut,
      flagged: flagged.length,
      truePositives: hits,
      precision: flagged.length ? hits / flagged.length : null,
      precisionLo: w?.lo ?? null,
      precisionHi: w?.hi ?? null,
      sameCountByLines: atK("lines"),
      sameCountByNameMissing: atK("nameMissing"),
    },
  };
  entry.separates = !underpowered && entry.jev.lo > 0.5;
  entry.ahead = Object.fromEntries(
    COMPARED.map((h) => [h, !underpowered && entry.diff[h].lo > 0]),
  );
  entry.behind = Object.fromEntries(
    COMPARED.map((h) => [h, !underpowered && entry.diff[h].hi < 0]),
  );
  return entry;
}

export function conclude(result) {
  const agree = result.views.agreement_only,
    singles = [result.views.first_labeler, result.views.second_labeler];
  if (agree.underpowered && singles.every((v) => v.underpowered))
    return "No conclusion: fewer than 15 positives or 15 negatives in every primary view. Point estimates are shown, not interpreted.";
  const contradicts = singles.some(
    (v) => !v.underpowered && COMPARED.some((h) => v.behind[h]),
  );
  if (agree.separates && COMPARED.every((h) => agree.ahead[h]) && !contradicts)
    return "Supported on this sample: under agreement-only labels Jev separates mismatched from fitting names and is ahead of both lines and the name-word cue, and neither single labeler contradicts it.";
  if (agree.separates)
    return `Jev separates under agreement-only labels, but is not shown ahead of ${COMPARED.filter((h) => !agree.ahead[h]).join(" and ")}${contradicts ? ", and a single labeler contradicts it" : ""}. No evidence here that it adds value over that free cue.`;
  if (!agree.underpowered && singles.every((v) => !v.separates))
    return "Jev does not separate on real code in this sample under agreement-only labels or either labeler.";
  return "Mixed: the views disagree or some are underpowered. Read the per-view table, not a verdict.";
}

export function analyzeReal(
  doc,
  scores,
  labelSets,
  { resamples = 2000, seed = 20260930, cut = 0.7 } = {},
) {
  const [first, second] = labelSets;
  const vs = views(first.labels, second.labels);
  const result = {
    schema: "real-result/1",
    labelers: [first.name, second.name],
    cut,
    resamples,
    seed,
    scored: [...scores.keys()].filter((id) =>
      doc.units.some((u) => u.id === id),
    ).length,
    units: doc.units.length,
    alertRate: {
      cut,
      flagged: doc.units.filter((u) => (scores.get(u.id)?.p ?? 0) >= cut)
        .length,
    },
    agreement: agreement(first.labels, second.labels),
    views: Object.fromEntries(
      Object.entries(vs).map(([name, view]) => [
        name,
        analyzeView(name, view, doc, scores, { resamples, seed, cut }),
      ]),
    ),
  };
  result.conclusion = conclude(result);
  return result;
}

const f = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(2));
const span = (s) => `${f(s.auc)} (${f(s.lo)} to ${f(s.hi)})`;

export function markdown(result) {
  const [a, b] = result.labelers;
  const g = result.agreement;
  const lines = [
    "# Real-code name_vs_behavior result",
    "",
    `Scored ${result.scored} of ${result.units} units. Labelers: ${a} (first), ${b} (second). Intervals: 95% percentile bootstrap over units, ${result.resamples} resamples. Cut ${result.cut}: Jev flagged ${result.alertRate.flagged} units.`,
    "",
    "## Conclusion",
    "",
    result.conclusion,
    "",
    "## Agreement between labelers",
    "",
    `Raw agreement ${f(g.rawAgreement4)} on four labels, ${f(g.rawAgreement3)} on mismatch / ok / cannot_tell. Cohen kappa ${f(g.kappa4)} and ${f(g.kappa3)}. Mismatch: ${g.mismatchByFirst} by ${a}, ${g.mismatchBySecond} by ${b}, ${g.mismatchByBoth} by both. Cannot tell by either: ${g.cannotTellByEither}.`,
    "",
  ];
  for (const [name, v] of Object.entries(result.views)) {
    lines.push(
      `## View: ${name}${v.primary ? "" : " (exploratory)"}`,
      "",
      `${v.units} units, ${v.positives} positives (${f(v.prevalence)}).${v.underpowered ? " UNDERPOWERED: fewer than 15 in a class; read the numbers as descriptions." : ""}`,
      "",
      "| Scorer | AUC (95% interval) |",
      "| --- | --- |",
      `| Jev P(name_mismatch) | ${span(v.jev)} |`,
      ...Object.entries(v.heuristics).map(([k, s]) => `| ${k} | ${span(s)} |`),
      "",
      `Jev minus lines: ${f(v.diff.lines.value)} (${f(v.diff.lines.lo)} to ${f(v.diff.lines.hi)}). Jev minus nameMissing: ${f(v.diff.nameMissing.value)} (${f(v.diff.nameMissing.lo)} to ${f(v.diff.nameMissing.hi)}).`,
      "",
      `At the cut: Jev flagged ${v.atCut.flagged} of these units, ${v.atCut.truePositives} true (precision ${f(v.atCut.precision)}, ${f(v.atCut.precisionLo)} to ${f(v.atCut.precisionHi)}); prevalence ${f(v.prevalence)}. The same count taken from the top of lines: precision ${f(v.atCut.sameCountByLines)}; of nameMissing: ${f(v.atCut.sameCountByNameMissing)}.`,
      "",
    );
  }
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
      labels: {
        type: "string",
        default: new URL("./labels", import.meta.url).pathname,
      },
      first: { type: "string", default: "claude" },
      second: { type: "string", default: "gpt" },
      out: { type: "string" },
      markdown: { type: "boolean" },
      resamples: { type: "string", default: "2000" },
    },
  });
  if (!values.journal) throw Error("Give --journal FILE");
  const doc = JSON.parse(readFileSync(values.units, "utf8"));
  const scores = scoresFromJournal(readFileSync(values.journal, "utf8"), doc);
  const labelSets = [values.first, values.second].map((name) => ({
    name,
    labels: parseLabels(
      readFileSync(`${values.labels}/${name}.jsonl`, "utf8"),
      doc,
    ),
  }));
  const result = analyzeReal(doc, scores, labelSets, {
    resamples: Number(values.resamples),
  });
  if (values.out)
    writeFileSync(values.out, JSON.stringify(result, null, 2) + "\n");
  if (values.markdown) console.log(markdown(result));
  else if (!values.out) console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
