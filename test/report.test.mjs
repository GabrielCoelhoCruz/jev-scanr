import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readJournal } from "../src/runner.mjs";
import {
  buildReport,
  queueMarkdown,
  reportMarkdown,
  resolveThresholds,
} from "../src/report.mjs";
import { defaultSignalIds, selectSignals } from "../src/catalog.mjs";
import {
  plan,
  scratch,
  fake,
  response,
  positive,
  clone,
  run,
} from "./helpers.mjs";

const probabilityByName = (byName) => (request) =>
  response(request, (id, signal, negative) => {
    const name = request.state.members.map((m) => m.name ?? "").join(",");
    return id === "function_should_split" && name in byName
      ? positive(byName[name])(id, signal, negative)
      : null;
  });

async function completed(t, files, byName) {
  const p = plan(t, files);
  const dir = join(scratch(t), "run");
  await run(
    p,
    dir,
    fake(async (r) => probabilityByName(byName)(r)),
  );
  return { p, events: readJournal(dir, p) };
}

test("ordering and findings come only from Jev probabilities", async (t) => {
  const { p, events } = await completed(
    t,
    {
      "a.ts": clone("alpha") + clone("beta", "20"),
      "b.ts": clone("gamma"),
    },
    { alpha: 0.95, beta: 0.2, gamma: 0.75 },
  );
  const report = buildReport(p, events);
  const view = report.views.function_should_split;
  assert.deepEqual(
    view.shown.map((s) => s.location[0].name),
    ["alpha", "gamma"],
  );
  assert.ok(report.findings.every((f) => f.pPositive >= f.threshold));
  assert.deepEqual(
    report.findings.map((f) => f.pPositive),
    [...report.findings.map((f) => f.pPositive)].sort((a, b) => b - a),
  );
  const lowered = buildReport(p, events, {
    thresholds: { function_should_split: 0.1 },
  });
  assert.deepEqual(
    lowered.views.function_should_split.shown.map((s) => s.location[0].name),
    ["alpha", "gamma", "beta"],
  );
  assert.ok(!JSON.stringify(report).includes("deterministicScore"));
});

test("unanswered cells are abstentions, never scores", (t) => {
  const p = plan(t);
  const report = buildReport(p, []);
  assert.equal(report.findings.length, 0);
  assert.equal(report.provenance, "not_run");
  assert.ok(report.abstentions.every((a) => a.status === "unattempted"));
  assert.ok(Object.values(report.views).every((v) => v.scored === 0));
});

test("thresholds default to the catalog cut and reject unknown or invalid values", () => {
  selectSignals();
  const cuts = resolveThresholds();
  assert.deepEqual(Object.keys(cuts), defaultSignalIds);
  assert.ok(Object.values(cuts).every((v) => v === 0.7));
  assert.throws(() => resolveThresholds({ nope: 0.5 }));
  assert.throws(() => resolveThresholds({ function_should_split: 1.5 }));
  assert.throws(() => resolveThresholds({ function_should_split: "x" }));
  assert.equal(
    resolveThresholds({ function_should_split: 0 }).function_should_split,
    0,
  );
});

test("near-ties are flagged with both probabilities and never gain display from the losing option", async (t) => {
  const p = plan(t, { "a.ts": clone("alpha"), "b.ts": clone("gamma") });
  const dir = join(scratch(t), "run");
  await run(
    p,
    dir,
    fake(async (r) =>
      response(r, (id, signal, negative) => {
        if (id !== "function_should_split") return null;
        const name = r.state.members.map((m) => m.name).join(",");
        return name === "alpha"
          ? {
              choice: signal.presence,
              probabilities: {
                [signal.presence]: 0.49,
                [negative]: 0.5,
                insufficient: 0.01,
              },
            }
          : {
              choice: negative,
              probabilities: {
                [signal.presence]: 0.5,
                [negative]: 0.49,
                insufficient: 0.01,
              },
            };
      }),
    ),
  );
  const events = readJournal(dir, p);
  const report = buildReport(p, events);
  assert.equal(report.nearTies.length, 2);
  assert.ok(report.nearTies.every((n) => n.shown === false));
  assert.match(report.nearTieRule, /within 0\.01/);
  assert.equal(report.findings.length, 0);
  const atHalf = buildReport(p, events, {
    thresholds: { function_should_split: 0.5 },
  });
  const [finding] = atHalf.findings;
  assert.equal(
    atHalf.findings.length,
    1,
    "only the cell whose own P(positive) reaches 0.5",
  );
  assert.equal(finding.location[0].name, "gamma");
  assert.deepEqual(
    [finding.near_tie, finding.choiceProbability, finding.maximumProbability],
    [true, 0.49, 0.5],
  );
  assert.match(queueMarkdown(atHalf), /near tie: chosen 0\.49 vs max 0\.50/);
  assert.match(
    reportMarkdown(buildReport(p, events)),
    /2 answers were near ties/,
  );
});

test("reports without near-ties carry no near-tie fields", async (t) => {
  const { p, events } = await completed(t, undefined, {});
  const text = JSON.stringify(buildReport(p, events));
  for (const key of [
    "near_tie",
    "nearTies",
    "nearTieRule",
    "choiceProbability",
  ])
    assert.ok(!text.includes(key), key);
});

test("queue.md lists candidates by descending P with a verification instruction, and report.md explains the numbers", async (t) => {
  const { p, events } = await completed(
    t,
    { "a.ts": clone("alpha") + clone("beta", "20"), "b.ts": clone("gamma") },
    { alpha: 0.95, beta: 0.2, gamma: 0.75 },
  );
  const report = buildReport(p, events);
  const queue = queueMarkdown(report);
  assert.match(queue, /^# Refactor queue/);
  assert.match(queue, /`no change` is a valid outcome/);
  assert.ok(queue.indexOf("alpha") < queue.indexOf("gamma"));
  assert.ok(
    !queue.includes("beta a.ts"),
    "below-cut cells are not in the queue",
  );
  assert.match(queue, /P=0\.95/);
  const summary = reportMarkdown(report, {
    knownEstimatedUSD: 0.0123,
    knownInputTokens: 1000,
    reservedAttempts: 3,
  });
  assert.match(summary, /US\$0\.0123/);
  assert.match(summary, /not reproducible/);
  assert.match(summary, /\| function_should_split@/);
  assert.match(summary, /actionable above the cut/);
});

test("reports contain paths, ranges and hashes but never source text or secrets", async (t) => {
  const { p, events } = await completed(t, undefined, { alpha: 0.95 });
  const report = buildReport(p, events);
  const text =
    JSON.stringify(report) + queueMarkdown(report) + reportMarkdown(report);
  assert.ok(!text.includes("const threshold"));
  assert.ok(!text.includes("return input - threshold"));
});

test("untrusted paths cannot inject markdown into queue.md", async (t) => {
  const { p, events } = await completed(
    t,
    { "x`![i](http:__evil).ts": clone("alpha") + clone("beta", "20") },
    { alpha: 0.95 },
  );
  const queue = queueMarkdown(buildReport(p, events));
  assert.ok(!queue.includes("`![i]"));
  assert.ok(!/\r|\u2028/.test(queue));
});
