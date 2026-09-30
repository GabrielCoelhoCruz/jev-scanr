import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { POLICY } from "../src/core.mjs";
import { auditCases, loadCases } from "../evals/lib/cases.mjs";
import { answerFor, fakeClient, graderChecks } from "../evals/lib/audit.mjs";
import { readFlows, runEval } from "../evals/lib/eval-run.mjs";
import {
  chooseRepeats,
  compareRuns,
  measureVariance,
} from "../evals/lib/variance.mjs";
import {
  buildJudgeTasks,
  calibrate,
  importJudgeLabels,
  itemsFromCases,
  judgePrompt,
} from "../evals/lib/judge.mjs";
import { evaluateGate, ruleSHA256 } from "../evals/lib/gate.mjs";
import { normalizeLabels } from "../evals/lib/labels.mjs";
import { noiseFloor, wilson } from "../evals/lib/stats.mjs";
import { main } from "../evals/cli.mjs";
import { readJournal } from "../src/runner.mjs";
import { plan, scratch, run, fake, response, positive } from "./helpers.mjs";

const casesDir = new URL("../evals/cases/", import.meta.url).pathname;
const starter = loadCases(casesDir);
const oracle = (cases) => (request) => {
  const c = cases.find((k) =>
    Object.values(k.files).some((t) =>
      request.state.sections.some(
        (s) => s.source.includes(t.trim()) || t.includes(s.source.trim()),
      ),
    ),
  );
  return answerFor(request, c?.label.value === "actionable" ? 0.95 : 0.05);
};

test("the starter case sets are valid, cover both directions and warn that author labels are only sanity checks", () => {
  const audit = auditCases(starter);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.valid, 16);
  assert.equal(Object.keys(audit.bySignal).length, 8);
  assert.ok(audit.warnings.some((w) => /author-written/.test(w)));
  assert.ok(
    Object.values(audit.bySignal).every(
      (s) => s.actionable > 0 && s.no_action > 0,
    ),
  );
});

test("the case audit catches duplicates, contradictory labels, leakage and missing label sources", () => {
  const base = starter[0];
  const audit = auditCases([
    base,
    { ...base, id: "dup", label: { ...base.label, value: "no_action" } },
    {
      ...base,
      id: "leak",
      files: { "x.ts": `// ${base.signalId}\n${Object.values(base.files)[0]}` },
    },
    { ...base, id: "nosource", label: { value: "actionable" } },
    {
      ...base,
      id: "llm",
      label: {
        value: "actionable",
        source: { type: "llm_reviewer", who: "x" },
      },
    },
    { ...base, id: "bad path", files: { "../x.ts": "x" } },
  ]);
  const text = audit.problems.join("\n");
  assert.match(text, /same source with different labels/);
  assert.match(text, /label leakage/);
  assert.match(text, /label\.source\.type/);
  assert.match(text, /must name the model/);
  assert.match(text, /safe relative paths/);
});

test("the grader passes its oracle, null, no-answer, induced-error and served-model checks", async () => {
  const checks = await graderChecks(starter);
  assert.equal(checks.length, 6);
  for (const c of checks) assert.ok(c.pass, `${c.name}: ${c.detail}`);
  const bad = await graderChecks([
    { ...starter[0], label: { ...starter[0].label, value: "uncertain" } },
  ]);
  assert.equal(bad[0].pass, false);
});

test("a run writes results.jsonl, traces, errors and a summary with the noise floor next to each rate, and resumes idempotently", async (t) => {
  const out = join(scratch(t), "eval");
  let calls = 0;
  const client = fakeClient(async (request) => {
    calls++;
    return oracle(starter)(request);
  });
  const args = {
    cases: starter,
    client,
    mode: "synthetic",
    capUSD: 1,
    out,
    intervalMs: 0,
  };
  const summary = await runEval(args);
  assert.equal(calls, 16);
  const s = summary.signals.deep_nesting;
  assert.equal(s.graded, 2);
  assert.equal(s.tp + s.tn, 2);
  assert.equal(s.noiseFloor, noiseFloor(2));
  assert.equal(s.weakEvidence, true);
  const flow = join(out, "deep_nesting", "baseline");
  const rows = readFileSync(join(flow, "results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(
      r.prompt_id && r.prompt && r.status === "ok" && r.model === POLICY.model,
    );
    assert.ok(
      typeof r.grade.correct === "number" &&
        typeof r.grade.p_positive === "number",
    );
    assert.ok(r.usage.input_tokens > 0 && r.cost_usd > 0);
    assert.ok(
      existsSync(
        join(
          flow,
          "traces",
          `${r.prompt_id.replace(/[^A-Za-z0-9_.-]/g, "_")}_rep0.json`,
        ),
      ),
    );
  }
  await runEval(args);
  assert.equal(calls, 16, "resume makes no repeat calls");
  assert.equal(readFlows(out, starter).rows.length, 16);
  const html = join(out, "deep_nesting", "report.html");
  execFileSync(
    process.execPath,
    [
      new URL(
        "../evals/vendor/anthropic-skills/build-report-lite.mjs",
        import.meta.url,
      ).pathname,
      join(out, "deep_nesting"),
    ],
    { stdio: "pipe" },
  );
  assert.ok(existsSync(html));
  assert.match(readFileSync(html, "utf8"), /deep_nesting|fixture/);
});

test("abstentions and errors are never counted as negatives, and the first error stops the run", async (t) => {
  const out = join(scratch(t), "eval");
  const summary = await runEval({
    cases: starter,
    mode: "synthetic",
    capUSD: 1,
    out,
    intervalMs: 0,
    client: fakeClient(async (r) =>
      answerFor(r, 0, { choice: "insufficient" }),
    ),
  });
  const total = (k) =>
    Object.values(summary.signals).reduce((n, s) => n + s[k], 0);
  assert.equal(total("abstained"), 16);
  assert.equal(total("graded") + total("tn") + total("fn"), 0);
  const out2 = join(scratch(t), "eval2");
  let n = 0;
  const stopped = await runEval({
    cases: starter,
    mode: "synthetic",
    capUSD: 1,
    out: out2,
    intervalMs: 0,
    client: fakeClient(async (r) =>
      ++n === 3 ? { ...answerFor(r, 0.9), model: "other" } : answerFor(r, 0.9),
    ),
  });
  assert.match(stopped.stopped, /served_model_mismatch/);
  assert.equal(n, 3);
});

test("P variance: repeats are chosen by a frozen seed, and the registered rule reports when P moves too much", async (t) => {
  const p = plan(t);
  const dir = join(scratch(t), "base");
  await run(
    p,
    dir,
    fake(async (r) => response(r, positive(0.8))),
  );
  const events = readJournal(dir, p);
  const a = chooseRepeats(p, events, { n: 2, seed: "s" }),
    b = chooseRepeats(p, events, { n: 2, seed: "s" }),
    c = chooseRepeats(p, events, { n: 2, seed: "other" });
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(c.length, 2);
  const steady = await measureVariance({
    plan: p,
    events,
    mode: "synthetic",
    n: 2,
    seed: "s",
    capUSD: 1,
    intervalMs: 0,
    directory: join(scratch(t), "steady"),
    client: fake(async (r) => response(r, positive(0.8))),
  });
  assert.equal(steady.cellsOverThreshold, 0);
  assert.equal(steady.ruleTriggered, false);
  assert.equal(steady.requestsRepeated, 2);
  const noisy = await measureVariance({
    plan: p,
    events,
    mode: "synthetic",
    n: 2,
    seed: "s",
    capUSD: 1,
    intervalMs: 0,
    directory: join(scratch(t), "noisy"),
    client: fake(async (r) => response(r, positive(0.6))),
  });
  assert.ok(noisy.shareCellsOver > 0.2);
  assert.equal(noisy.ruleTriggered, true);
  assert.ok(noisy.maxDelta >= 0.2 - 1e-9);
  assert.ok(noisy.cutCrossings > 0, "0.8 to 0.6 crosses the 0.7 cut");
  await assert.rejects(
    measureVariance({
      plan: p,
      events,
      mode: "synthetic",
      n: 999,
      seed: "s",
      capUSD: 1,
      directory: join(scratch(t), "x"),
      client: fake(),
    }),
    /Only \d+ answered requests/,
  );
  assert.equal(compareRuns(p, events, events).cellsOverThreshold, 0);
});

test("judge tasks use a different prompt from the question, carry known-negative controls, and reject a Jev judge", () => {
  const { meta, tasks } = buildJudgeTasks(itemsFromCases(starter));
  assert.equal(meta.controls, 3);
  assert.equal(tasks.length, 19);
  for (const t of tasks) {
    assert.ok(
      !t.prompt.includes("evaluationRules"),
      "not the Jev question prompt",
    );
    assert.ok(!t.prompt.includes("Apply state."));
    assert.match(t.prompt, /untrusted data/);
    assert.match(t.prompt, /not shown any model output|not answering a model/);
  }
  const good = tasks.map((t) => ({
    task_id: t.task_id,
    label:
      t.task_id === "control/empty"
        ? "uncertain"
        : t.task_id.endsWith("fixture-positive")
          ? "actionable"
          : "no_action",
    rationale: "because",
  }));
  const ok = importJudgeLabels(tasks, good, { model: "some-judge" });
  assert.equal(ok.ok, true);
  assert.equal(ok.controlsPassed, true);
  assert.equal(
    importJudgeLabels(tasks, good, { model: "jev-1.13.0" }).ok,
    false,
  );
  const failing = good.map((r) =>
    r.task_id === "control/wrong-question" ? { ...r, label: "actionable" } : r,
  );
  const bad = importJudgeLabels(tasks, failing, { model: "some-judge" });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(" "), /known-negative controls/);
  assert.equal(
    importJudgeLabels(tasks, good.slice(1), { model: "j" }).ok,
    false,
  );
  assert.throws(() => judgePrompt({ text: "x" }, undefined));
});

const labelFile = (type, who, rows) => ({
  schema: "eval-labels/1",
  sourceType: type,
  who,
  labels: rows,
});
const rowsOf = (n, f) =>
  Array.from({ length: n }, (_, i) => ({
    cardId: `c${i}`,
    signalId: "deep_nesting",
    label: f(i),
  }));

test("a judge is calibrated only with enough clear human-labeled cases and about 90% agreement", () => {
  const human = normalizeLabels(
    labelFile(
      "human",
      "gabriel",
      rowsOf(30, (i) =>
        i % 3 === 0 ? "actionable" : i % 10 === 1 ? "uncertain" : "no_action",
      ),
    ),
  );
  const same = normalizeLabels(
    labelFile(
      "llm_reviewer",
      "judge-x",
      rowsOf(30, (i) => (i % 3 === 0 ? "actionable" : "no_action")),
    ),
  );
  const result = calibrate(same, human, { judgeModel: "judge-x" });
  assert.ok(result.clearCases >= 20);
  assert.equal(result.humanUncertain, 2);
  assert.equal(result.clearCases, 28);
  assert.equal(result.calibrated, true);
  assert.ok(result.agreementCI95.lo < result.agreement);
  const off = normalizeLabels(
    labelFile(
      "llm_reviewer",
      "judge-x",
      rowsOf(30, (i) => (i % 3 === 0 ? "no_action" : "no_action")),
    ),
  );
  const worse = calibrate(off, human, {});
  assert.equal(worse.calibrated, false);
  assert.match(worse.reasons.join(" "), /below 90%/);
  const few = calibrate(
    same,
    normalizeLabels(
      labelFile(
        "human",
        "g",
        rowsOf(5, () => "no_action"),
      ),
    ),
    {},
  );
  assert.match(few.reasons.join(" "), /only 5 clear cases/);
  assert.match(
    calibrate(
      same,
      normalizeLabels(
        labelFile(
          "llm_reviewer",
          "z",
          rowsOf(30, () => "no_action"),
        ),
      ),
      {},
    ).reasons.join(" "),
    /not from a human/,
  );
  assert.throws(() => normalizeLabels({ schema: "nope" }));
  assert.throws(() => normalizeLabels(labelFile("human", "", [])));
  assert.throws(() =>
    normalizeLabels(
      labelFile("human", "g", [{ cardId: "a", signalId: "s", label: "maybe" }]),
    ),
  );
});

test("the review package and human label formats from the blind protocol load as label sets", () => {
  const review = normalizeLabels(
    {
      schema: "blind-relational-reference/1",
      reviewer: "example-llm-reviewer",
      cards: [
        {
          cardId: "a",
          evaluations: [{ signalId: "s", label: "actionable", rationale: "r" }],
        },
      ],
    },
    { model: "claude-opus-5-5" },
  );
  assert.deepEqual(review.source, {
    type: "llm_reviewer",
    who: "claude-opus-5-5",
  });
  const human = normalizeLabels({
    schema: "human-labels/1",
    labelerKind: "human",
    labeler: "gabriel",
    labels: [{ cardId: "a", signalId: "s", label: "", note: "" }],
  });
  assert.equal(human.unlabeled, 1);
  assert.equal(human.labels.size, 0);
});

function sampleRows(perProject) {
  const rows = [];
  for (const project of ["p1", "p2"])
    for (let i = 0; i < perProject; i++) {
      rows.push({
        cardId: `${project}-a${i}`,
        signalId: "deep_nesting",
        project,
        stratum: "above_cut_random",
      });
      rows.push({
        cardId: `${project}-b${i}`,
        signalId: "deep_nesting",
        project,
        stratum: "below_cut_near",
      });
      rows.push({
        cardId: `${project}-t${i}`,
        signalId: "deep_nesting",
        project,
        stratum: "above_cut_top",
      });
    }
  return rows;
}
const labelsFor = (rows, type, who, aboveActionable) =>
  normalizeLabels(
    labelFile(
      type,
      who,
      rows.map((r) => ({
        cardId: r.cardId,
        signalId: r.signalId,
        label:
          r.stratum === "above_cut_random"
            ? Number(r.cardId.slice(-1)) < aboveActionable
              ? "actionable"
              : "no_action"
            : r.stratum === "above_cut_top"
              ? "actionable"
              : "no_action",
      })),
    ),
  );

test("the gate needs a random above-cut sample, two projects, n of 8 and a trusted labeler, and prints the noise floor", () => {
  const rows = sampleRows(5);
  const human = labelsFor(rows, "human", "gabriel", 4);
  const result = evaluateGate({ sample: rows, labels: human });
  const s = result.signals.deep_nesting;
  assert.equal(s.verdict, "default");
  assert.equal(s.aboveCut.n, 10);
  assert.equal(s.aboveCut.actionable, 8);
  assert.equal(s.aboveCut.projects, 2);
  assert.equal(s.aboveCut.noiseFloor, noiseFloor(10));
  assert.equal(
    s.topRankedSampleIgnored,
    10,
    "the top-ranked sample never counts toward the stable verdict",
  );
  assert.equal(s.belowCut.rate, 0);
  assert.equal(
    evaluateGate({ sample: rows, labels: labelsFor(rows, "human", "g", 2) })
      .signals.deep_nesting.verdict,
    "default_low_precision",
  );
  assert.equal(
    evaluateGate({ sample: rows, labels: labelsFor(rows, "human", "g", 1) })
      .signals.deep_nesting.verdict,
    "experimental",
  );
  assert.equal(
    evaluateGate({
      sample: rows.filter((r) => r.project === "p1"),
      labels: human,
    }).signals.deep_nesting.verdict,
    "experimental",
  );
  assert.equal(
    evaluateGate({
      sample: sampleRows(2),
      labels: labelsFor(sampleRows(2), "human", "g", 2),
    }).signals.deep_nesting.verdict,
    "experimental",
  );
  const llm = labelsFor(rows, "llm_reviewer", "judge-x", 4);
  const uncalibrated = evaluateGate({ sample: rows, labels: llm });
  assert.equal(uncalibrated.signals.deep_nesting.verdict, "experimental");
  assert.match(
    uncalibrated.signals.deep_nesting.reasons.join(" "),
    /not from a human or a calibrated judge/,
  );
  const calibrated = evaluateGate({
    sample: rows,
    labels: llm,
    calibration: {
      calibrated: true,
      judge: { who: "judge-x" },
      agreement: 0.93,
      clearCases: 30,
    },
  });
  assert.equal(calibrated.signals.deep_nesting.verdict, "default");
  const other = evaluateGate({
    sample: rows,
    labels: llm,
    calibration: { calibrated: true, judge: { who: "different-judge" } },
  });
  assert.equal(
    other.signals.deep_nesting.verdict,
    "experimental",
    "calibration belongs to one judge",
  );
  assert.equal(wilson(8, 10).hi < 1, true);
  assert.match(ruleSHA256(), /^[a-f0-9]{64}$/);
});

test("the eval CLI audits offline, refuses live use without consent, and runs with an injected client", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (l) => lines.push(l));
  await main(["audit"]);
  assert.ok(lines.some((l) => /^ok\s+oracle/.test(l)));
  assert.equal(process.exitCode ?? 0, 0);
  await assert.rejects(main(["run", "--out", join(scratch(t), "x")]), /--yes/);
  const out = join(scratch(t), "run");
  await main(
    [
      "run",
      "--yes",
      "--cap-usd",
      "1",
      "--signal",
      "deep_nesting",
      "--out",
      out,
    ],
    {
      client: fakeClient(async (r) => answerFor(r, 0.05)),
      intervalMs: 0,
    },
  );
  assert.ok(lines.some((l) => /recall .*noise floor/.test(l)));
  assert.ok(lines.some((l) => /author labels only/.test(l)));
  const gateOut = join(scratch(t), "gate.json");
  const rows = sampleRows(5);
  const sample = join(scratch(t), "sample.jsonl"),
    labels = join(scratch(t), "labels.json");
  writeFileSync(sample, rows.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(
    labels,
    JSON.stringify(
      labelFile(
        "human",
        "gabriel",
        rows.map((r) => ({
          cardId: r.cardId,
          signalId: r.signalId,
          label: r.stratum === "above_cut_random" ? "actionable" : "no_action",
        })),
      ),
    ),
  );
  await assert.rejects(
    main([
      "gate",
      "--sample",
      sample,
      "--labels",
      labels,
      "--expect-rule-sha",
      "0".repeat(64),
      "--out",
      gateOut,
    ]),
    /Gate rule changed/,
  );
  await main([
    "gate",
    "--sample",
    sample,
    "--labels",
    labels,
    "--expect-rule-sha",
    ruleSHA256(),
    "--out",
    gateOut,
  ]);
  assert.equal(
    JSON.parse(readFileSync(gateOut)).signals.deep_nesting.verdict,
    "default",
  );
  process.exitCode = 0;
});

test("every catalog signal has starter cases in both directions, and CONTRIBUTING quotes the current gate rule hash", async () => {
  const { fullCatalog } = await import("../src/catalog.mjs");
  for (const s of fullCatalog.signals) {
    const mine = starter.filter((c) => c.signalId === s.id);
    assert.ok(
      mine.some((c) => c.label.value === "actionable"),
      s.id,
    );
    assert.ok(
      mine.some((c) => c.label.value === "no_action"),
      s.id,
    );
  }
  const contributing = readFileSync(
    new URL("../CONTRIBUTING.md", import.meta.url),
    "utf8",
  );
  assert.ok(
    contributing.includes(ruleSHA256()),
    "re-pin the hash in CONTRIBUTING.md after editing evals/gate.json",
  );
  const sets = JSON.parse(
    readFileSync(
      new URL("../evals/calibration/calibration-sets.json", import.meta.url),
    ),
  );
  assert.equal(sets.sets[0].id, "human-30");
  assert.match(sets.sets[0].cardsSHA256, /^[a-f0-9]{64}$/);
});

test("a human-labels file must declare a human labeler and cannot be an LLM", () => {
  const file = (extra) => ({
    schema: "human-labels/1",
    labels: [{ cardId: "a", signalId: "s", label: "actionable", note: "n" }],
    ...extra,
  });
  assert.equal(
    normalizeLabels(file({ labelerKind: "human", labeler: "Ana Souza" })).source
      .type,
    "human",
  );
  assert.throws(
    () => normalizeLabels(file({ labeler: "Ana Souza" })),
    /labelerKind/,
  );
  assert.throws(
    () =>
      normalizeLabels(file({ labelerKind: "llm", labeler: "claude-opus-5-5" })),
    /labelerKind/,
  );
  assert.throws(
    () =>
      normalizeLabels(
        file({
          labeler: "LLM (not human): example-model, independent reviewer",
        }),
      ),
    /labelerKind/,
  );
  assert.throws(
    () =>
      normalizeLabels(
        file({ labelerKind: "human", labeler: "anthropic/claude-opus-5-5" }),
      ),
    /looks like a model/,
  );
  assert.throws(
    () =>
      normalizeLabels({
        schema: "eval-labels/1",
        sourceType: "human",
        who: "LLM (not human)",
        labels: [],
      }),
    /looks like a model/,
  );
  assert.equal(
    normalizeLabels({
      schema: "eval-labels/1",
      sourceType: "llm_reviewer",
      who: "anthropic/claude-opus-5-5",
      labels: [],
    }).source.type,
    "llm_reviewer",
  );
});

test("the release outcome covers the middle case and needs a decidable labeler", () => {
  const ids = ["s1", "s2", "s3", "s4", "s5"];
  const build = (passing, source) => {
    const sample = [],
      labels = [];
    for (const [i, id] of ids.entries())
      for (const project of ["p1", "p2"])
        for (let j = 0; j < 4; j++) {
          const above = `${id}-${project}-a${j}`;
          sample.push({
            cardId: above,
            signalId: id,
            project,
            stratum: "above_cut_random",
          });
          labels.push({
            cardId: above,
            signalId: id,
            label: i < passing ? "actionable" : "no_action",
            note: "n",
          });
        }
    return evaluateGate({
      sample,
      labels: normalizeLabels({
        schema: "eval-labels/1",
        sourceType: source,
        who: source === "human" ? "Ana Souza" : "some-model",
        labels,
      }),
    });
  };
  assert.equal(build(4, "human").release.outcome, "stable");
  assert.equal(build(3, "human").release.outcome, "stay_alpha");
  assert.equal(build(3, "human").release.defaultSignals, 3);
  assert.equal(build(2, "human").release.outcome, "pivot");
  assert.equal(build(4, "llm_reviewer").release.outcome, "not_decidable");
});
