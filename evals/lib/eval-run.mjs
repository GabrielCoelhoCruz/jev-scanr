import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { POLICY } from "../../src/core.mjs";
import { buildPlan } from "../../src/build-plan.mjs";
import { runPlan, readJournal } from "../../src/runner.mjs";
import { buildReport } from "../../src/report.mjs";
import { catalog } from "../../src/catalog.mjs";
import { caseProject, caseProblems } from "./cases.mjs";
import { noiseFloor, rate, wilson } from "./stats.mjs";

const FAILURE_CLASSES = {
  unexpected_model: "served_model_mismatch",
  model_required: "served_model_mismatch",
};

export function expectedOf(c) {
  return c.label.value === "actionable"
    ? "positive"
    : c.label.value === "no_action"
      ? "negative"
      : "excluded";
}

function cellFor(c, report) {
  const cells = report.blocks
    .filter(
      (b) =>
        !c.focus ||
        c.focus.every((name) => b.location.some((l) => l.name === name)),
    )
    .flatMap((b) => b.signals)
    .filter((s) => s.signalId === c.signalId);
  const scored = cells.filter((s) => s.status === "scored");
  if (scored.length)
    return {
      status: "scored",
      p: Math.max(...scored.map((s) => s.pPositive)),
      near_tie: scored.some((s) => s.near_tie),
    };
  return { status: cells[0]?.status ?? "no_cell" };
}

export function grade(c, cell, cut) {
  const expected = expectedOf(c);
  if (cell.status !== "scored") return null;
  const fired = cell.p >= cut;
  return {
    correct:
      expected === "excluded"
        ? null
        : Number(fired === (expected === "positive")),
    fired: Number(fired),
    p_positive: cell.p,
  };
}

const jsonl = (path, row) => appendFileSync(path, JSON.stringify(row) + "\n");

export async function runEval({
  cases,
  client,
  mode = "live",
  capUSD,
  out,
  reps = 1,
  cut = catalog.displayThresholdDefault,
  intervalMs = POLICY.minIntervalMs,
}) {
  for (const c of cases) {
    const p = caseProblems(c);
    if (p.length) throw Error(`Invalid case ${c.id}: ${p.join("; ")}`);
  }
  if (!Number.isFinite(capUSD) || capUSD <= 0)
    throw Error("A positive cap is required");
  for (const id of new Set(cases.map((c) => c.signalId)))
    mkdirSync(join(out, id, "baseline", "traces"), { recursive: true });
  const rows = [],
    errors = [],
    result = { stopped: null, spentUSD: 0 };
  for (let rep = 0; rep < reps && !result.stopped; rep++)
    for (const c of cases) {
      if (result.stopped) break;
      const flow = join(out, c.signalId, "baseline");
      const name = `${c.id.replace(/[^A-Za-z0-9_.-]/g, "_")}_rep${rep}`;
      mkdirSync(join(flow, "traces"), { recursive: true });
      const done = existsSync(join(flow, "results.jsonl"))
        ? readFileSync(join(flow, "results.jsonl"), "utf8").includes(
            `"prompt_id":"${c.id}","rep":${rep},`,
          )
        : false;
      if (done) continue;
      const root = caseProject(c);
      const walDir = join(flow, "wal", name);
      let plan;
      try {
        plan = buildPlan(root, { signals: [c.signalId] });
        if (!plan.requests.length) throw Error("no request formed");
      } catch (e) {
        const row = {
          prompt_id: c.id,
          rep,
          failure_class: "harness_error",
          detail: e.message,
        };
        jsonl(join(flow, "errors.jsonl"), row);
        errors.push({ ...row, signalId: c.signalId });
        continue;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
      const summary = await runPlan({
        plan,
        directory: walDir,
        client,
        mode,
        capUSD: Math.max(capUSD - result.spentUSD, 0.000001),
        intervalMs,
      });
      result.spentUSD += summary.knownEstimatedUSD;
      const events = readJournal(walDir, plan);
      const failed = events.find(
        (e) => e.type === "finished" && e.status === "failed",
      );
      if (failed || !summary.complete) {
        const code = failed?.failure?.validation;
        const row = {
          prompt_id: c.id,
          rep,
          failure_class: failed
            ? (FAILURE_CLASSES[code] ??
              (failed.failure.kind === "transport_error"
                ? "serving_error"
                : "invalid_answer"))
            : (summary.stoppedReason ?? "incomplete"),
          detail:
            code ?? failed?.failure?.kind ?? summary.stoppedReason ?? null,
          usage: failed?.usage ?? null,
        };
        jsonl(join(flow, "errors.jsonl"), row);
        errors.push({ ...row, signalId: c.signalId });
        result.stopped = `${row.failure_class} on ${c.id}`;
        break;
      }
      const report = buildReport(plan, events, {
        thresholds: { [c.signalId]: cut },
      });
      const cell = cellFor(c, report);
      const graded = grade(c, cell, cut);
      const request = plan.requests[0].request;
      const answers = events.find((e) => e.type === "finished").response;
      const usage = events
        .filter((e) => e.type === "finished")
        .reduce(
          (u, e) => ({
            input_tokens: u.input_tokens + e.usage.input_tokens,
            output_tokens: u.output_tokens + e.usage.output_tokens,
          }),
          { input_tokens: 0, output_tokens: 0 },
        );
      writeFileSync(
        join(flow, "traces", `${name}.json`),
        JSON.stringify(
          [
            { role: "system", content: request.state.evaluationRules },
            {
              role: "user",
              content: JSON.stringify(
                {
                  question: request.questions,
                  sections: request.state.sections.map((s) => ({
                    path: s.path,
                    source: s.source,
                  })),
                },
                null,
                2,
              ),
            },
            {
              role: "assistant",
              content: JSON.stringify(answers.answers, null, 2),
            },
          ],
          null,
          2,
        ),
      );
      if (!graded) {
        const row = {
          prompt_id: c.id,
          rep,
          failure_class: "abstained",
          detail: cell.status,
        };
        jsonl(join(flow, "errors.jsonl"), row);
        errors.push({ ...row, signalId: c.signalId });
        continue;
      }
      const row = {
        prompt_id: c.id,
        rep,
        prompt: Object.entries(c.files)
          .map(([p, s]) => `// ${p}\n${s}`)
          .join("\n"),
        tags: [c.signalId, expectedOf(c), ...(c.tags ?? [])],
        status: "ok",
        grade: Object.fromEntries(
          Object.entries(graded).filter(([, v]) => v !== null),
        ),
        model: answers.model,
        usage,
        cost_usd: (usage.input_tokens * POLICY.inputUSDPerMillion) / 1e6,
        meta: {
          label: c.label.value,
          labelSource: c.label.source,
          near_tie: cell.near_tie ?? false,
        },
      };
      jsonl(join(flow, "results.jsonl"), row);
      rows.push({ ...row, signalId: c.signalId });
    }
  const summary = summarizeEval({ cases, ...readFlows(out, cases), cut });
  summary.stopped = result.stopped;
  summary.calculatedUSD = result.spentUSD;
  for (const id of Object.keys(summary.signals))
    writeFileSync(
      join(out, id, "_state.json"),
      JSON.stringify(
        { metrics: [{ id: "correct", label: "correct", kind: "binary" }] },
        null,
        2,
      ) + "\n",
    );
  writeFileSync(
    join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}

export function readFlows(out, cases) {
  const read = (path) =>
    existsSync(path)
      ? readFileSync(path, "utf8")
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
      : [];
  const rows = [],
    errors = [],
    byId = new Map(cases.map((c) => [c.id, c]));
  for (const signalId of new Set(cases.map((c) => c.signalId))) {
    const flow = join(out, signalId, "baseline");
    for (const r of read(join(flow, "results.jsonl")))
      if (byId.has(r.prompt_id)) rows.push({ ...r, signalId });
    for (const e of read(join(flow, "errors.jsonl")))
      if (byId.has(e.prompt_id)) errors.push({ ...e, signalId });
  }
  return { rows, errors };
}

export function summarizeEval({ cases, rows, errors, cut }) {
  const signals = {};
  for (const c of cases) {
    const s = (signals[c.signalId] ??= {
      cases: 0,
      graded: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
      abstained: 0,
      errors: 0,
      excludedUncertain: 0,
      labelSources: {},
      models: [],
    });
    s.cases++;
    s.labelSources[c.label.source.type] =
      (s.labelSources[c.label.source.type] ?? 0) + 1;
    if (expectedOf(c) === "excluded") s.excludedUncertain++;
  }
  for (const r of rows) {
    const s = signals[r.signalId],
      positive = r.tags[1] === "positive";
    if (r.grade.correct === undefined) continue;
    s.graded++;
    s[positive ? (r.grade.fired ? "tp" : "fn") : r.grade.fired ? "fp" : "tn"]++;
    if (!s.models.includes(r.model)) s.models.push(r.model);
  }
  for (const e of errors) {
    const s =
      signals[e.signalId ?? cases.find((c) => c.id === e.prompt_id)?.signalId];
    if (!s) continue;
    s[e.failure_class === "abstained" ? "abstained" : "errors"]++;
  }
  for (const s of Object.values(signals)) {
    const pos = s.tp + s.fn,
      neg = s.tn + s.fp;
    s.recall = {
      k: s.tp,
      n: pos,
      rate: rate(s.tp, pos),
      ci: wilson(s.tp, pos),
    };
    s.falsePositiveRate = {
      k: s.fp,
      n: neg,
      rate: rate(s.fp, neg),
      ci: wilson(s.fp, neg),
    };
    s.precision = {
      k: s.tp,
      n: s.tp + s.fp,
      rate: rate(s.tp, s.tp + s.fp),
      ci: wilson(s.tp, s.tp + s.fp),
    };
    s.accuracy = {
      k: s.tp + s.tn,
      n: s.graded,
      rate: rate(s.tp + s.tn, s.graded),
      ci: wilson(s.tp + s.tn, s.graded),
    };
    s.majorityBaseline = s.graded ? Math.max(pos, neg) / s.graded : null;
    s.noiseFloor = noiseFloor(s.graded);
    s.weakEvidence = Object.keys(s.labelSources).every((t) => t === "author");
  }
  return { cut, signals };
}
