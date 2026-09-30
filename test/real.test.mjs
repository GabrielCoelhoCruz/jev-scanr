import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agreement,
  analyzeReal,
  conclude,
  markdown,
  parseLabels,
} from "../evals/real/analyze.mjs";
import { rngFor } from "../evals/contrast/lib/match.mjs";
import { STRATA } from "../evals/real/build.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const doc = JSON.parse(
  readFileSync(join(root, "evals/real/units.json"), "utf8"),
);
const ids = doc.units.map((u) => u.id);

const labelsFrom = (pick) =>
  new Map(doc.units.map((u, i) => [u.id, pick(u, i)]));
const positives = (n, seed) => {
  const rng = rngFor(seed, "positives");
  const chosen = new Set(
    ids
      .map((id) => [rng(), id])
      .sort()
      .slice(0, n)
      .map(([, id]) => id),
  );
  return labelsFrom((u) => (chosen.has(u.id) ? "mismatch" : "fits"));
};
const scoresOf = (fn) =>
  new Map(doc.units.map((u, i) => [u.id, { p: fn(u, i), choice: null }]));
const run = (scores, a, b) =>
  analyzeReal(
    doc,
    scores,
    [
      { name: "a", labels: a },
      { name: "b", labels: b },
    ],
    { resamples: 300 },
  );

test("units.json: 400 random functions, 25 per repository and length band, no source text, opaque ids", () => {
  assert.equal(doc.units.length, 400);
  assert.equal(new Set(ids).size, 400);
  const cells = new Map();
  for (const u of doc.units) {
    const k = `${u.source[0].repo}|${u.stratum}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
    const band = STRATA.find((s) => s.name === u.stratum);
    assert.ok(u.features.lines >= band.min && u.features.lines <= band.max);
    assert.match(u.id, /^[0-9a-f]{8}$/);
    assert.ok(!("text" in u) && !("label" in u));
    assert.ok(u.features.nameMissing >= 0 && u.features.nameMissing <= 1);
  }
  assert.equal(cells.size, 16);
  assert.ok([...cells.values()].every((n) => n === 25));
  assert.equal(doc.sets.R.signal, "name_vs_behavior");
});

test("label files are validated: exact coverage, known labels, no duplicates", () => {
  const good = ids
    .map((id) => JSON.stringify({ id, label: "fits" }))
    .join("\n");
  assert.equal(parseLabels(good, doc).size, 400);
  assert.throws(
    () => parseLabels(good.split("\n").slice(1).join("\n"), doc),
    /exactly/,
  );
  assert.throws(
    () =>
      parseLabels(
        `${good}\n${JSON.stringify({ id: ids[0], label: "fits" })}`,
        doc,
      ),
    /duplicate/,
  );
  assert.throws(
    () => parseLabels(good.replace("fits", "maybe"), doc),
    /unknown label/,
  );
});

test("agreement: kappa and counts match a hand-worked table", () => {
  const a = new Map([
    ["1", "mismatch"],
    ["2", "mismatch"],
    ["3", "fits"],
    ["4", "fits"],
    ["5", "imprecise"],
    ["6", "cannot_tell"],
  ]);
  const b = new Map([
    ["1", "mismatch"],
    ["2", "fits"],
    ["3", "fits"],
    ["4", "fits"],
    ["5", "fits"],
    ["6", "fits"],
  ]);
  const g = agreement(a, b);
  assert.equal(g.items, 6);
  assert.equal(g.rawAgreement4, 3 / 6);
  assert.equal(g.rawAgreement3, 4 / 6);
  assert.equal(g.mismatchByBoth, 1);
  assert.equal(g.cannotTellByEither, 1);
  assert.equal(g.confusion["mismatch|fits"], 1);
  assert.ok(Math.abs(g.kappa3 - 7 / 19) < 1e-9);
});

test("fake P = function length on random labels: no separation, no lead over lines", () => {
  const a = positives(40, 1),
    b = positives(40, 2);
  const r = run(
    scoresOf((u) => u.features.lines / 100),
    a,
    b,
  );
  for (const v of [r.views.first_labeler, r.views.second_labeler]) {
    assert.equal(v.jev.auc, v.heuristics.lines.auc);
    assert.equal(v.diff.lines.value, 0);
    assert.ok(v.jev.lo < 0.5 && v.jev.hi > 0.5);
  }
  assert.doesNotMatch(r.conclusion, /^Supported/);
});

test("fake P = the labels: supported only when both labelers agree and lengths do not explain the labels", () => {
  const a = positives(40, 3);
  const r = run(
    scoresOf((u) => (a.get(u.id) === "mismatch" ? 0.9 : 0.1)),
    a,
    a,
  );
  assert.equal(r.views.agreement_only.jev.auc, 1);
  assert.equal(r.views.agreement_only.positives, 40);
  assert.match(r.conclusion, /^Supported/);
  assert.equal(r.views.agreement_only.atCut.precision, 1);
  assert.equal(r.views.agreement_only.atCut.flagged, 40);
  assert.equal(r.agreement.kappa4, 1);
});

test("fake P = the labels, but the labels are just function length: Jev separates and is not ahead of lines", () => {
  const long = labelsFrom((u) =>
    u.features.lines >= 40 ? "mismatch" : "fits",
  );
  const r = run(
    scoresOf((u) => (u.features.lines >= 40 ? 0.9 : 0.1)),
    long,
    long,
  );
  assert.equal(r.views.agreement_only.jev.auc, 1);
  assert.equal(r.views.agreement_only.ahead.lines, false);
  assert.match(r.conclusion, /not shown ahead of lines/);
});

test("fake P = noise: no separation in any view and the verdict says so plainly", () => {
  const a = positives(40, 4),
    b = positives(40, 5);
  const rng = rngFor(9, "noise");
  const r = run(
    scoresOf(() => rng()),
    a,
    b,
  );
  assert.equal(r.views.first_labeler.separates, false);
  assert.equal(r.views.agreement_only.separates, false);
  assert.ok(!r.views.first_labeler.ahead.lines);
});

test("labelers that disagree: agreement-only keeps the shared items, cannot_tell is dropped not counted negative", () => {
  const a = labelsFrom((u, i) =>
    i % 10 === 0 ? "mismatch" : i % 10 === 1 ? "cannot_tell" : "fits",
  );
  const b = labelsFrom((u, i) => (i % 20 === 0 ? "mismatch" : "fits"));
  const r = run(
    scoresOf((u, i) => i / 400),
    a,
    b,
  );
  assert.equal(r.views.first_labeler.units, 360);
  assert.equal(r.views.first_labeler.positives, 40);
  assert.equal(r.views.second_labeler.units, 400);
  assert.equal(r.views.agreement_only.positives, 20);
  assert.equal(r.views.agreement_only.units, 400 - 40 - 20);
  assert.equal(r.agreement.cannotTellByEither, 40);
});

test("too few positives: flagged underpowered and no conclusion is drawn", () => {
  const a = positives(6, 6);
  const r = run(
    scoresOf((u) => (a.get(u.id) === "mismatch" ? 0.95 : 0.05)),
    a,
    a,
  );
  assert.equal(r.views.agreement_only.underpowered, true);
  assert.equal(r.views.agreement_only.separates, false);
  assert.match(r.conclusion, /^No conclusion/);
  assert.match(markdown(r), /UNDERPOWERED/);
});

test("lenient views count imprecise as a mismatch and stay out of the conclusion", () => {
  const a = labelsFrom((u, i) =>
    i % 40 === 0 ? "mismatch" : i % 10 === 0 ? "imprecise" : "fits",
  );
  const r = run(
    scoresOf((u, i) => i / 400),
    a,
    a,
  );
  assert.equal(r.views.first_labeler.positives, 10);
  assert.equal(r.views.first_labeler_lenient.positives, 40);
  assert.equal(r.views.first_labeler_lenient.primary, false);
});

test("committed labels cover all 400 units with known labels; the truncated first round is kept apart", () => {
  const read = (name) =>
    parseLabels(
      readFileSync(join(root, `evals/real/labels/${name}.jsonl`), "utf8"),
      doc,
    );
  const claude = read("claude"),
    gpt = read("gpt"),
    round1 = read("claude-round1-truncated");
  assert.equal(claude.size, 400);
  assert.deepEqual(
    [claude, gpt].map(
      (m) => [...m.values()].filter((l) => l === "mismatch").length,
    ),
    [0, 5],
  );
  assert.ok(agreement(round1, claude).rawAgreement4 > 0.95);
});

test("descriptive readout lists flagged and labeled units by name", () => {
  const a = labelsFrom((u, i) => (i === 7 ? "imprecise" : "fits"));
  const b = labelsFrom((u, i) => (i === 7 ? "mismatch" : "fits"));
  const r = run(
    scoresOf((u, i) => (i === 7 || i === 9 ? 0.8 : 0.1)),
    a,
    b,
  );
  assert.deepEqual(
    r.descriptive.flagged.map((x) => x.id).sort(),
    [ids[7], ids[9]].sort(),
  );
  assert.deepEqual(
    r.descriptive.labeled.map((x) => [x.id, x.a, x.b]),
    [[ids[7], "imprecise", "mismatch"]],
  );
  assert.match(markdown(r), /Descriptive readout/);
});
