#!/usr/bin/env node
// Derives the per-signal default display cuts and floors (cuts.json) from data committed in this repository:
// the constructed-contrast journals (evals/contrast/results) and the LLM-labeled baseline cells
// (evals/baseline/cells.json). Offline: no request, no key. The rule is fixed in RULE and explained in
// docs/CUTS.md, with its limits.
//
//   node evals/cuts/derive.mjs [--markdown] [--out evals/cuts/result.json] [--check]
import { deepStrictEqual } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { scoresFromJournal } from "../contrast/analyze.mjs";
import { wilson } from "../lib/stats.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

export const RULE = {
  default: { cut: 70, floor: 50 },
  cutGrid: [50, 55, 60, 65, 70],
  floorGrid: [30, 35, 40, 45, 50, 55, 60, 65, 70],
  cutPrimaryFalseAlarm: 0.05,
  cutHardenedFalseAlarm: 0.1,
  floorPrimaryFalseAlarm: 0.1,
  realCellMinActionable: 0.3,
};

const SIGNALS = {
  function_should_split: {
    primary: { set: "A", label: 0 },
    hardened: { set: "A2", label: 0 },
    positives: ["A"],
  },
  clone_same_policy: {
    primary: { set: "B", label: 0 },
    hardened: { set: "B2", label: 0 },
    positives: ["B"],
  },
  name_vs_behavior: {
    primary: { set: "C", label: 0 },
    hardened: null,
    positives: ["C"],
  },
};

const round = (x) => Math.round(x * 1e4) / 1e4;

function scoredUnits() {
  const units = read("../contrast/units.json"),
    controls = read("../contrast/controls.json");
  const live1 = scoresFromJournal(
      text("../contrast/results/live-1/journal.jsonl"),
      units,
    ),
    live2 = scoresFromJournal(
      text("../contrast/results/live-2/journal.jsonl"),
      controls,
    );
  const rows = [];
  for (const [doc, scores] of [
    [units, live1],
    [controls, live2],
  ])
    for (const u of doc.units) {
      const s = scores.get(u.id);
      if (s) rows.push({ set: u.set, label: u.label, p: s.p });
    }
  return rows;
}

function atOrAbove(rows, hundredths) {
  const k = rows.filter((r) => r.p >= hundredths / 100 - 1e-9).length;
  return {
    k,
    n: rows.length,
    rate: rows.length ? round(k / rows.length) : null,
  };
}

export function derive() {
  const rows = scoredUnits(),
    cells = read("../baseline/cells.json").cells,
    signals = {},
    perSignal = {};
  for (const [id, spec] of Object.entries(SIGNALS)) {
    const pick = (ref) =>
      ref ? rows.filter((r) => r.set === ref.set && r.label === ref.label) : [];
    const primary = pick(spec.primary),
      hardened = pick(spec.hardened),
      positives = rows.filter(
        (r) => spec.positives.includes(r.set) && r.label === 1,
      ),
      real = cells.filter((c) => c.signalId === id);
    const table = RULE.floorGrid.map((g) => ({
      at: g / 100,
      positivesAtOrAbove: atOrAbove(positives, g),
      controlsAtOrAbove: atOrAbove(primary, g),
      hardenedControlsAtOrAbove: hardened.length
        ? atOrAbove(hardened, g)
        : null,
      labeledCellsAtOrAbove: real.length
        ? {
            n: real.filter((c) => c.p >= g / 100 - 1e-9).length,
            actionable: real.filter(
              (c) => c.p >= g / 100 - 1e-9 && c.labels.pass1 === "actionable",
            ).length,
          }
        : null,
    }));
    const row = (g) => table.find((t) => t.at === g / 100);
    const cutOk = (g) =>
      row(g).controlsAtOrAbove.rate <= RULE.cutPrimaryFalseAlarm &&
      (!hardened.length ||
        row(g).hardenedControlsAtOrAbove.rate <= RULE.cutHardenedFalseAlarm) &&
      (!real.length ||
        (row(g).labeledCellsAtOrAbove.n > 0 &&
          row(g).labeledCellsAtOrAbove.actionable /
            row(g).labeledCellsAtOrAbove.n >=
            RULE.realCellMinActionable));
    const cut = RULE.cutGrid.find(cutOk) ?? RULE.default.cut;
    const floor =
      RULE.floorGrid.find(
        (g) =>
          g <= cut &&
          row(g).controlsAtOrAbove.rate <= RULE.floorPrimaryFalseAlarm,
      ) ?? RULE.default.floor;
    perSignal[id] = { cut: cut / 100, floor: Math.min(floor, cut) / 100 };
    signals[id] = {
      positiveSets: spec.positives,
      primaryControls: spec.primary.set,
      hardenedControls: spec.hardened?.set ?? null,
      labeledCells: real.length,
      chosen: perSignal[id],
      controlFalseAlarmAtCut: {
        ...atOrAbove(primary, cut),
        wilson95: Object.values(
          wilson(atOrAbove(primary, cut).k, primary.length),
        ).map(round),
      },
      positivesAtCut: atOrAbove(positives, cut),
      positivesAtOldCut: atOrAbove(positives, RULE.default.cut),
      table,
    };
  }
  return {
    schema: "display-cuts-derivation/1",
    rule: RULE,
    cuts: {
      default: { cut: RULE.default.cut / 100, floor: RULE.default.floor / 100 },
      signals: Object.fromEntries(
        Object.entries(perSignal).filter(
          ([, v]) =>
            v.cut * 100 !== RULE.default.cut ||
            v.floor * 100 !== RULE.default.floor,
        ),
      ),
    },
    signals,
  };
}

export function markdown(result) {
  const pct = (r) => `${Math.round(r.rate * 100)}% (${r.k}/${r.n})`;
  const lines = [
    "# Per-signal display cuts: derivation",
    "",
    `Rule: ${JSON.stringify(result.rule)}. No Jev call was made.`,
    "",
    "| Signal | Cut | Floor | Positives at the new cut | Positives at 0.70 | Untouched controls at the new cut |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const [id, s] of Object.entries(result.signals))
    lines.push(
      `| \`${id}\` | ${s.chosen.cut} | ${s.chosen.floor} | ${pct(s.positivesAtCut)} | ${pct(s.positivesAtOldCut)} | ${pct(s.controlFalseAlarmAtCut)} |`,
    );
  return lines.join("\n") + "\n";
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      markdown: { type: "boolean" },
      check: { type: "boolean" },
    },
  });
  const result = derive();
  const out = values.out ?? new URL("result.json", import.meta.url).pathname;
  if (values.check) {
    if (!existsSync(out)) throw Error(`${out} does not exist`);
    deepStrictEqual(JSON.parse(readFileSync(out, "utf8")), result);
    deepStrictEqual(
      JSON.parse(readFileSync(new URL("../../cuts.json", import.meta.url)))
        .cuts,
      result.cuts,
    );
    console.log("result.json and cuts.json are what the rule gives");
    return;
  }
  if (values.markdown) process.stdout.write(markdown(result));
  else writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
