import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY } from "../src/core.mjs";
import { question } from "../src/catalog.mjs";
import { analyze, jaccard, nameWords } from "../evals/contrast/lib/code.mjs";
import {
  arrowBody,
  arrowParens,
  braces,
  callbackForm,
  constToLet,
  invertConditions,
  literalForms,
  parenWrap,
  quotes,
  renameLocals,
  reorder,
  semicolons,
  swapParams,
  templateConcat,
  trailingCommas,
  updateForms,
} from "../evals/contrast/lib/transforms.mjs";
import { fakeScores } from "../evals/contrast/lib/fake.mjs";
import {
  analyzeContrast,
  markdown,
  scoresFromJournal,
} from "../evals/contrast/analyze.mjs";
import { makeChimera, PINNED } from "../evals/contrast/build.mjs";
import { receipt } from "../evals/contrast/requests.mjs";
import { runContrast } from "../evals/contrast/run.mjs";
import { scratch } from "./helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const doc = JSON.parse(
  readFileSync(join(root, "evals/contrast/units.json"), "utf8"),
);
const rng = () => 0.9;
const SAMPLE = `function total(rows: Row[], rate: number) {
  const base = 10;
  const scale = 2;
  let sum = 0;
  for (const row of rows) sum += row.amount;
  if (!rows.length) {
    return undefined;
  }
  const kept = rows.filter((row) => row.n > 0);
  const label = \`sum=\${sum}\`;
  return rows.map((r) => ({ label, ok: true, n: r.n * rate + base, s: 'x' }));
}
`;

function same(a, b) {
  return jaccard(analyze(a, "ts").shingles, analyze(b, "ts").shingles);
}

test("each mechanical pass keeps the function parseable and lowers scanner token overlap", () => {
  for (const [name, pass] of [
    ["semicolons", semicolons],
    ["braces", braces],
    ["arrowParens", arrowParens],
    ["arrowBody", arrowBody],
    ["callbackForm", callbackForm],
    ["templateConcat", templateConcat],
    ["literalForms", literalForms],
    ["constToLet", constToLet],
    ["updateForms", updateForms],
    ["parenWrap", parenWrap],
  ]) {
    const out = pass(SAMPLE, "ts", rng);
    assert.ok(out && out !== SAMPLE, `${name} changed nothing`);
    assert.ok(same(SAMPLE, out) < 1, `${name} kept every shingle`);
    assert.equal(analyze(out, "ts").name, "total");
  }
});

test("passes produce the exact rewrite on a small function", () => {
  const src = "function f(a, b) {\n  const x = 1;\n  return `${a}-${b}`;\n}\n";
  assert.equal(
    templateConcat(src, "ts"),
    'function f(a, b) {\n  const x = 1;\n  return "" + a + "-" + b;\n}\n',
  );
  assert.equal(
    semicolons(src, "ts"),
    "function f(a, b) {\n  const x = 1\n  return `${a}-${b}`\n}\n",
  );
  assert.equal(
    swapParams(src, "ts"),
    "function f(b, a) {\n  const x = 1;\n  return `${a}-${b}`;\n}\n",
  );
  assert.equal(
    constToLet(src, "ts"),
    "function f(a, b) {\n  let x = 1;\n  return `${a}-${b}`;\n}\n",
  );
});

test("renaming locals leaves names other code can see alone and expands shorthand", () => {
  const src =
    "function f(a: number, { b, c = 2 }: P) {\n  const out = { a, b, c };\n  out.b += a;\n  return out.c;\n}\n";
  const out = renameLocals(src, "ts");
  assert.equal(
    out,
    "function f(item: number, { b: entry, c: value = 2 }: P) {\n  const input = { a: item, b: entry, c: value };\n  input.b += item;\n  return input.c;\n}\n",
  );
  assert.equal(analyze(out, "ts").name, "f");
});

test("reordering swaps only independent pure declarations", () => {
  const free =
    "function f() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n";
  assert.equal(
    reorder(free, "ts", () => 1),
    "function f() {\n  const b = 2;\n  const a = 1;\n  return a + b;\n}\n",
  );
  const dependent =
    "function f() {\n  const a = 1;\n  const b = a + 1;\n  return b;\n}\n";
  assert.equal(
    reorder(dependent, "ts", () => 1),
    null,
  );
  const effect =
    "function f() {\n  const a = load();\n  const b = 2;\n  return b;\n}\n";
  assert.equal(
    reorder(effect, "ts", () => 1),
    null,
  );
});

test("condition inversion and trailing commas keep meaning", () => {
  const src =
    "function f(x) {\n  if (!x) {\n    a();\n  } else {\n    b();\n  }\n  return [\n    1,\n    2,\n  ];\n}\n";
  assert.match(
    invertConditions(src, "ts"),
    /if \(x\) \{\n    b\(\);\n  \} else \{\n    a\(\);/,
  );
  assert.match(trailingCommas(src, "ts"), /2\n {2}\];/);
  assert.match(
    quotes("function f() {\n  return 'a' + \"b\";\n}\n", "ts"),
    /"a" \+ "b"|'a' \+ 'b'/,
  );
});

test("a chimera is one function holding both parts in order, under the first part's name", () => {
  const mk = (text) => ({ text, ext: "ts", info: analyze(text, "ts") });
  const a = mk(
    "function sumCells(grid: number[][]) {\n  let total = 0;\n  for (const row of grid) total += row.length;\n  return total;\n}\n",
  );
  const b = mk(
    "async function loadPrefs(path: string) {\n  const res = await fetch(path);\n  return res.json();\n}\n",
  );
  const chimera = makeChimera(a, b);
  assert.ok(chimera);
  assert.equal(chimera.info.name, "sumCells");
  assert.equal(chimera.info.async, true);
  assert.match(
    chimera.text,
    /^async function sumCells\(grid: number\[\]\[\], path: string\) \{/,
  );
  assert.ok(
    chimera.text.indexOf("total += row.length") <
      chimera.text.indexOf("await fetch"),
  );
  assert.match(chimera.text, /const sumCellsResult = total;/);
  assert.equal(chimera.text.split("\nfunction ").length, 1);
});

test("a chimera is refused when the parts would collide", () => {
  const mk = (text) => ({ text, ext: "ts", info: analyze(text, "ts") });
  const a = mk("function one() {\n  const data = 1;\n  return data;\n}\n");
  const b = mk("function two() {\n  const data = 2;\n  return data;\n}\n");
  assert.equal(makeChimera(a, b), null);
});

test("name words drop stopwords and plurals", () => {
  assert.deepEqual([...nameWords("getUserProfiles")].sort(), [
    "profile",
    "user",
  ]);
  assert.deepEqual([...nameWords("handleResize")], ["resize"]);
});

test("units.json: three sets of 50 positives and 50 controls, no source text, opaque ids and paths", () => {
  assert.equal(doc.schema, "contrast-units/1");
  assert.equal(doc.units.length, 300);
  assert.equal(new Set(doc.units.map((u) => u.id)).size, 300);
  for (const set of ["A", "B", "C"]) {
    const units = doc.units.filter((u) => u.set === set);
    assert.equal(units.filter((u) => u.label === 1).length, 50);
    assert.equal(units.filter((u) => u.label === 0).length, 50);
  }
  for (const u of doc.units) {
    assert.match(u.id, /^[0-9a-f]{8}$/);
    for (const f of u.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      assert.ok(!/chimera|control|rename|orig|pos|neg/i.test(f.path), f.path);
    }
    assert.ok(!("texts" in u) && !("text" in u));
    assert.deepEqual(
      Object.keys(doc.pinned).sort(),
      Object.keys(PINNED).sort(),
    );
  }
  assert.ok(JSON.stringify(doc).length < 400000);
});

test("set A: chimeras and controls are matched on length; set B: both classes sit below the retrieval threshold", () => {
  const a = doc.units.filter((u) => u.set === "A");
  const mean = (l) =>
    a.filter((u) => u.label === l).reduce((n, u) => n + u.features.lines, 0) /
    50;
  assert.ok(Math.abs(mean(1) - mean(0)) < 1, `${mean(1)} vs ${mean(0)}`);
  const b = doc.units.filter((u) => u.set === "B");
  for (const u of b) {
    assert.ok(u.features.shingleJaccard < 0.45, "at or above the scanner cut");
    assert.ok(u.features.minLines >= 8 && u.features.sizeRatio >= 0.5);
  }
  assert.ok(
    b
      .filter((u) => u.label === 1)
      .every((u) => u.features.shingleJaccard >= 0.1),
  );
  const c = doc.units.filter((u) => u.set === "C");
  for (let i = 0; i < 50; i++) {
    const pair = c.filter((u) => u.pairId === i);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].features.lines, pair[1].features.lines);
    assert.notEqual(
      pair.find((u) => u.label).recipe.newName,
      pair.find((u) => u.label).recipe.originalName,
    );
  }
});

test("analyzer, fake P = function length: matched sets read 0.5, and an unmatched set is flagged", () => {
  const result = analyzeContrast(
    doc,
    fakeScores(doc, "feature", { feature: "lines" }),
    {
      resamples: 300,
    },
  );
  for (const id of ["A", "C"]) {
    const s = result.sets[id];
    assert.equal(s.jev.auc, s.heuristics.lines.auc);
    assert.ok(s.matched && s.jev.lo <= 0.5 && s.jev.hi >= 0.5, id);
  }
  const skewed = {
    ...doc,
    units: doc.units
      .filter((u) => u.set === "A")
      .map((u) => ({
        ...u,
        features: {
          ...u.features,
          lines: u.features.lines + (u.label ? 30 : 0),
        },
      })),
    sets: { A: doc.sets.A },
  };
  const out = analyzeContrast(
    skewed,
    fakeScores(skewed, "feature", { feature: "lines" }),
    {
      resamples: 300,
    },
  );
  assert.ok(out.sets.A.jev.auc > 0.95);
  assert.equal(out.sets.A.matched, false);
  assert.match(out.sets.A.verdict[0], /^UNMATCHED/);
});

test("analyzer, fake P = oracle, inverse oracle and seeded noise", () => {
  const oracle = analyzeContrast(doc, fakeScores(doc, "oracle"), {
    resamples: 200,
  });
  const inverse = analyzeContrast(doc, fakeScores(doc, "inverse-oracle"), {
    resamples: 200,
  });
  for (const id of ["A", "B", "C"]) {
    assert.equal(oracle.sets[id].jev.auc, 1);
    assert.equal(inverse.sets[id].jev.auc, 0);
    assert.ok(
      oracle.sets[id].diff.lo > 0,
      `${id} oracle should beat the matched heuristic`,
    );
  }
  assert.equal(oracle.sets.C.paired.higher, 50);
  assert.ok(oracle.sets.C.paired.signTestP < 1e-10);
  const noise = analyzeContrast(doc, fakeScores(doc, "random", { seed: 7 }), {
    resamples: 500,
  });
  for (const id of ["A", "B", "C"]) {
    const s = noise.sets[id];
    assert.ok(s.jev.auc > 0.3 && s.jev.auc < 0.7, `${id} ${s.jev.auc}`);
    assert.ok(
      s.jev.lo < 0.5 && s.jev.hi > 0.5,
      `${id} noise should not separate`,
    );
    assert.doesNotMatch(s.verdict.join(" "), /Jev separates|Jev ahead/);
  }
});

test("analyzer, fake P = shingle overlap reads 0.5 on B; fake P = vocabulary overlap exposes the unmatched leak", () => {
  const shingle = analyzeContrast(
    doc,
    fakeScores(doc, "feature", { feature: "shingleJaccard" }),
    { resamples: 300 },
  );
  assert.ok(shingle.sets.B.matched);
  assert.ok(shingle.sets.B.jev.lo <= 0.5 && shingle.sets.B.jev.hi >= 0.5);
  const vocab = analyzeContrast(
    doc,
    fakeScores(doc, "feature", { feature: "vocabJaccard" }),
    { resamples: 300 },
  );
  assert.ok(vocab.sets.B.jev.lo > 0.5, "vocabulary overlap separates B");
  assert.match(
    vocab.sets.B.verdict.join(" "),
    /Unmatched features that separate.*vocabJaccard/,
  );
  assert.match(markdown(vocab), /## Set B: clone_same_policy/);
});

const CANDIDATE = JSON.parse(
  readFileSync(
    join(root, "evals/contrast/signals/name_vs_behavior.json"),
    "utf8",
  ),
);

test("the candidate signal has a positive option and an insufficient option", () => {
  assert.equal(CANDIDATE.presence, "name_mismatch");
  assert.deepEqual(Object.keys(CANDIDATE.criteria), [
    "name_mismatch",
    "name_fits",
    "insufficient",
  ]);
  assert.equal(question(CANDIDATE).type, "choice");
});

const fakeRequests = (n) =>
  Array.from({ length: n }, (_, i) => {
    const request = {
      model: POLICY.model,
      state: { path: `u/${i}.ts`, members: [] },
      questions: { name_vs_behavior: question(CANDIDATE) },
    };
    return {
      unitId: doc.units.filter((u) => u.set === "C")[i].id,
      set: "C",
      request,
      requestHash: `h${i}`,
      serializedBytes: 4000,
    };
  });
const answerFor = (p) => ({
  model: POLICY.model,
  usage: { input_tokens: 1300, output_tokens: 5 },
  answers: {
    name_vs_behavior: {
      type: "choice",
      choice: p >= 0.5 ? "name_mismatch" : "name_fits",
      confidence: 0.7,
      probabilities: { name_mismatch: p, name_fits: 1 - p, insufficient: 0 },
    },
  },
});
const clientOf = (fn) => {
  const calls = [];
  return {
    calls,
    systemOne: (request) => ({
      withResponse: async () => {
        calls.push(request);
        return {
          data: await fn(calls.length, request),
          requestId: "synthetic",
        };
      },
    }),
  };
};

test("live runner: one pass over every request, answers journaled, feeds the analyzer", async (t) => {
  const out = join(scratch(t), "run");
  const requests = fakeRequests(6);
  const client = clientOf(() => answerFor(0.8));
  const result = await runContrast({
    requests,
    client,
    capUSD: 0.5,
    outDir: out,
    sleep: async () => {},
  });
  assert.equal(result.complete, true);
  assert.equal(client.calls.length, 6);
  assert.ok(
    Math.abs(
      result.calculatedUSD - (6 * 1300 * POLICY.inputUSDPerMillion) / 1e6,
    ) < 1e-12,
  );
  const journal = readFileSync(join(out, "journal.jsonl"), "utf8");
  const scores = scoresFromJournal(journal, doc);
  assert.equal(scores.size, 6);
  assert.deepEqual([...scores.values()][0], {
    p: 0.8,
    choice: "name_mismatch",
  });
  assert.ok(existsSync(join(out, "requests.json")));
  await assert.rejects(
    runContrast({
      requests,
      client,
      capUSD: 0.5,
      outDir: out,
      sleep: async () => {},
    }),
    /EEXIST/,
  );
  assert.equal(client.calls.length, 6, "a second run must not send anything");
});

test("live runner: the first error stops the run and nothing is retried", async (t) => {
  const out = join(scratch(t), "run");
  const client = clientOf((n) => {
    if (n === 3) throw Object.assign(new Error("boom"), { status: 429 });
    return answerFor(0.2);
  });
  const result = await runContrast({
    requests: fakeRequests(6),
    client,
    capUSD: 0.5,
    outDir: out,
    sleep: async () => {},
  });
  assert.equal(result.complete, false);
  assert.equal(result.stopped, "first_error");
  assert.equal(client.calls.length, 3);
  const events = readFileSync(join(out, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const failed = events.find((e) => e.status === "failed");
  assert.equal(failed.failure.httpStatus, 429);
  assert.ok(!JSON.stringify(events).includes("boom"));
  assert.equal(events.at(-1).type, "stopped");
});

test("live runner: a cap above US$0.50 or below the worst case is refused before any request", async (t) => {
  const client = clientOf(() => answerFor(0.5));
  await assert.rejects(
    runContrast({
      requests: fakeRequests(2),
      client,
      capUSD: 1,
      outDir: join(scratch(t), "a"),
    }),
    /at most/,
  );
  await assert.rejects(
    runContrast({
      requests: fakeRequests(2),
      client,
      capUSD: 0.001,
      outDir: join(scratch(t), "b"),
    }),
    /exceeds the cap/,
  );
  assert.equal(client.calls.length, 0);
});

test("receipt: worst case is one token per byte plus one reservation", () => {
  const r = receipt(fakeRequests(10));
  assert.equal(r.requests, 10);
  assert.equal(r.estimatedInputTokens, Math.ceil(40000 / 3));
  assert.ok(
    Math.abs(
      r.worstCaseUSD - (40000 * 0.042) / 1e6 - r.perRequestReservationUSD,
    ) < 1e-12,
  );
  assert.equal(r.capUSD, 0.5);
});

test("the live runner takes no key on the command line", () => {
  const r = spawnSync(
    process.execPath,
    [
      join(root, "evals/contrast/run.mjs"),
      "--project",
      "x",
      "--api-key",
      "SECRET-VALUE-123",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.ok(
    !r.stderr.includes("SECRET-VALUE-123") || /Unknown option/.test(r.stderr),
  );
  assert.match(r.stderr, /Unknown option/);
});

test("the committed live run reproduces its stored analysis, every answer has an escape option and the served model", () => {
  const dir = join(root, "evals/contrast/results/live-1");
  const journal = readFileSync(join(dir, "journal.jsonl"), "utf8");
  const stored = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  const again = analyzeContrast(doc, scoresFromJournal(journal, doc), {
    resamples: stored.resamples,
  });
  assert.deepEqual(again, stored);
  const finished = journal
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "finished");
  assert.equal(finished.length, 300);
  for (const e of finished) {
    assert.equal(e.status, "succeeded");
    assert.equal(e.response.model, POLICY.model);
    assert.ok(
      "insufficient" in Object.values(e.response.answers)[0].probabilities,
    );
  }
  assert.ok(
    stored.sets.A.diff.lo > 0 &&
      stored.sets.B.diff.lo > 0 &&
      stored.sets.C.diff.lo > 0,
  );
});
