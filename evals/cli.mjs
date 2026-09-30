#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { POLICY } from "../src/core.mjs";
import { verifyPlan } from "../src/plan.mjs";
import { makeClient, readJournal } from "../src/runner.mjs";
import { catalog } from "../src/catalog.mjs";
import { auditCases, loadCases } from "./lib/cases.mjs";
import { graderChecks } from "./lib/audit.mjs";
import { runEval } from "./lib/eval-run.mjs";
import { measureVariance } from "./lib/variance.mjs";
import { normalizeLabels } from "./lib/labels.mjs";
import {
  buildJudgeTasks,
  calibrate,
  importJudgeLabels,
  itemsFromCards,
  itemsFromCases,
  JUDGE_PROMPT_VERSION,
} from "./lib/judge.mjs";
import { evaluateGate, ruleSHA256 } from "./lib/gate.mjs";
import { pct, withNoise } from "./lib/stats.mjs";

const HELP = `Eval tools for jev-scanr signals. See evals/README.md.

  node evals/cli.mjs audit [--cases PATH]                       offline: case-set audit + oracle/null/no-answer/error/served-model checks
  node evals/cli.mjs run --yes --cap-usd N --out DIR [--cases PATH] [--signal ID] [--reps K] [--cut 0.7]
                                                                 live: one Jev call per case, results in the report.html layout
  node evals/cli.mjs report DIR                                  render report.html for each signal under DIR
  node evals/cli.mjs variance --plan P --run-dir R --n 50 --seed S --yes --cap-usd N --out DIR
                                                                 re-send N answered requests once and measure how much P moves
  node evals/cli.mjs judge-tasks (--cases PATH | --cards cards.json) --out FILE
  node evals/cli.mjs judge-import --tasks FILE --labels FILE.jsonl --model NAME --out FILE
  node evals/cli.mjs calibrate --judge LABELS --human LABELS --human-blind [--judge-model NAME] --out FILE
  node evals/cli.mjs gate --sample FILE.jsonl --labels LABELS [--calibration FILE] [--expect-rule-sha SHA] --out FILE

Live commands send the case sources to the Jev API with your TYPESAFE_API_KEY (environment only).
`;

const options = {
  cases: { type: "string" },
  signal: { type: "string" },
  out: { type: "string" },
  "cap-usd": { type: "string" },
  yes: { type: "boolean" },
  reps: { type: "string" },
  cut: { type: "string" },
  plan: { type: "string" },
  "run-dir": { type: "string" },
  n: { type: "string" },
  seed: { type: "string" },
  cards: { type: "string" },
  tasks: { type: "string" },
  labels: { type: "string" },
  model: { type: "string" },
  judge: { type: "string" },
  human: { type: "string" },
  "human-blind": { type: "boolean" },
  "judge-model": { type: "string" },
  sample: { type: "string" },
  calibration: { type: "string" },
  "expect-rule-sha": { type: "string" },
  "min-clear": { type: "string" },
};
const json = (p) => JSON.parse(readFileSync(resolve(p), "utf8"));
const write = (p, v) =>
  writeFileSync(resolve(p), JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const need = (v, name) => {
  if (v === undefined) throw Error(`${name} is required`);
  return v;
};
const client = (deps) => {
  if (deps.client) return deps.client;
  if (!process.env.TYPESAFE_API_KEY)
    throw Error("Set TYPESAFE_API_KEY in the environment");
  return makeClient({ apiKey: process.env.TYPESAFE_API_KEY });
};
const live = (values) => {
  const cap = Number(values["cap-usd"]);
  if (!values.yes || !Number.isFinite(cap) || cap <= 0)
    throw Error(
      "Live commands need --yes (consent to send sources to the Jev API) and a positive --cap-usd",
    );
  return cap;
};
const defaultCases = new URL("./cases/", import.meta.url).pathname;

export async function main(args = process.argv.slice(2), deps = {}) {
  const [command, ...rest] = args;
  if (!command || command === "--help") return console.log(HELP);
  const { values, positionals } = parseArgs({
    args: rest,
    options,
    allowPositionals: true,
    strict: true,
  });
  if (command === "audit") {
    const cases = loadCases(resolve(values.cases ?? defaultCases));
    const audit = auditCases(cases);
    console.log(`${audit.valid}/${audit.cases} cases valid`);
    for (const [id, s] of Object.entries(audit.bySignal))
      console.log(
        `  ${id}: ${s.actionable} actionable, ${s.no_action} no_action, ${s.uncertain} uncertain; labels: ${JSON.stringify(s.sources)}; majority baseline ${pct(s.majorityBaseline)}`,
      );
    for (const w of audit.warnings) console.log(`warning: ${w}`);
    for (const p of audit.problems) console.log(`PROBLEM: ${p}`);
    const checks = audit.problems.length ? [] : await graderChecks(cases);
    for (const c of checks)
      console.log(`${c.pass ? "ok  " : "FAIL"} ${c.name} (${c.detail})`);
    if (audit.problems.length || checks.some((c) => !c.pass))
      process.exitCode = 1;
    return;
  }
  if (command === "run") {
    const cap = live(values);
    let cases = loadCases(resolve(values.cases ?? defaultCases));
    if (values.signal)
      cases = cases.filter((c) => c.signalId === values.signal);
    const audit = auditCases(cases);
    if (audit.problems.length || !cases.length)
      throw Error(
        `Case set is not valid:\n${audit.problems.join("\n") || "no cases"}`,
      );
    const summary = await runEval({
      cases,
      client: client(deps),
      capUSD: cap,
      out: resolve(need(values.out, "--out")),
      reps: Number(values.reps ?? 1),
      cut: Number(values.cut ?? catalog.displayThresholdDefault),
      intervalMs: deps.intervalMs ?? POLICY.minIntervalMs,
    });
    for (const [id, s] of Object.entries(summary.signals)) {
      console.log(
        `${id}: ${s.graded} graded, ${s.abstained} abstained, ${s.errors} errors, ${s.excludedUncertain} uncertain-labeled excluded`,
      );
      console.log(
        `  recall ${withNoise(s.tp, s.tp + s.fn)}; false positives ${withNoise(s.fp, s.fp + s.tn)}; majority baseline ${pct(s.majorityBaseline)}`,
      );
      console.log(
        `  labels: ${JSON.stringify(s.labelSources)}${s.weakEvidence ? "  (author labels only: a sanity check, not evidence for the gate)" : ""}`,
      );
    }
    console.log(
      `Calculated cost US$${summary.calculatedUSD.toFixed(4)} (not an invoice).${summary.stopped ? ` STOPPED: ${summary.stopped}` : ""}`,
    );
    if (summary.stopped) process.exitCode = 2;
    return;
  }
  if (command === "report") {
    const dir = resolve(positionals[0] ?? need(values.out, "DIR"));
    const builder = new URL(
      "./vendor/anthropic-skills/build-report-lite.mjs",
      import.meta.url,
    ).pathname;
    for (const id of readdirSync(dir).filter((f) =>
      existsSync(join(dir, f, "baseline")),
    ))
      execFileSync(process.execPath, [builder, join(dir, id)], {
        stdio: "inherit",
      });
    return;
  }
  if (command === "variance") {
    const cap = live(values);
    const plan = verifyPlan(json(need(values.plan, "--plan")));
    const events = readJournal(
      resolve(need(values["run-dir"], "--run-dir")),
      plan,
    );
    const result = await measureVariance({
      plan,
      events,
      client: client(deps),
      n: Number(need(values.n, "--n")),
      seed: need(values.seed, "--seed"),
      capUSD: cap,
      directory: resolve(need(values.out, "--out")),
      intervalMs: deps.intervalMs ?? POLICY.minIntervalMs,
    });
    console.log(
      `${result.cells} cells re-measured: ${result.cellsOverThreshold} moved by more than ${result.threshold} (${pct(result.shareCellsOver)} ±${pct(result.noiseFloorOfShare)}); max ${result.maxDelta.toFixed(2)}; ${result.choiceFlips} choice flips; ${result.cutCrossings} crossed the cut.`,
    );
    console.log(
      result.ruleTriggered
        ? `RULE TRIGGERED: ${result.registeredRule}`
        : `Registered rule not triggered (${result.registeredRule}).`,
    );
    write(join(resolve(values.out), "variance.json"), result);
    return;
  }
  if (command === "judge-tasks") {
    const items = values.cards
      ? itemsFromCards(json(values.cards).cards)
      : itemsFromCases(loadCases(resolve(values.cases ?? defaultCases)));
    const built = buildJudgeTasks(items);
    write(need(values.out, "--out"), built);
    console.log(
      `${built.meta.tasks} judge tasks (${built.meta.controls} controls), ${JUDGE_PROMPT_VERSION}. Run each prompt with a judge model that is not Jev, then: judge-import`,
    );
    return;
  }
  if (command === "judge-import") {
    const built = json(need(values.tasks, "--tasks"));
    const rows = readFileSync(resolve(need(values.labels, "--labels")), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const result = importJudgeLabels(built.tasks, rows, {
      model: values.model,
    });
    for (const c of result.controls)
      console.log(
        `${c.pass ? "ok  " : "FAIL"} control ${c.id}: expected ${c.expected}, got ${c.got}`,
      );
    for (const p of result.problems) console.log(`PROBLEM: ${p}`);
    if (!result.ok) {
      process.exitCode = 1;
      return;
    }
    const byId = new Map(built.tasks.map((t) => [t.task_id, t]));
    write(need(values.out, "--out"), {
      schema: "eval-labels/1",
      sourceType: "llm_reviewer",
      who: values.model,
      promptVersion: built.meta.promptVersion,
      rubricSHA256: built.meta.rubricSHA256,
      labels: [...result.labels.values()]
        .filter((r) => !r.task_id.startsWith("control/"))
        .map((r) => ({
          cardId: r.task_id.includes("|") ? r.task_id.split("|")[0] : r.task_id,
          signalId: byId.get(r.task_id).signalId,
          label: r.label,
          note: r.rationale,
        })),
    });
    console.log(
      `${result.labels.size - result.controls.length} labels written; controls passed`,
    );
    return;
  }
  if (command === "calibrate") {
    if (!values["human-blind"])
      throw Error(
        "Pass --human-blind to state that the human labeled without seeing the judge's labels",
      );
    const judge = normalizeLabels(json(need(values.judge, "--judge")), {
      model: values["judge-model"],
    });
    const human = normalizeLabels(json(need(values.human, "--human")));
    const result = calibrate(judge, human, {
      judgeModel: values["judge-model"] ?? judge.source.who,
      minClear: Number(values["min-clear"] ?? 20),
    });
    write(need(values.out, "--out"), result);
    console.log(
      `${result.agree}/${result.clearCases} agree on clear cases (${pct(result.agreement)}), kappa ${result.kappa?.toFixed(2)}; ${result.calibrated ? "CALIBRATED" : `NOT calibrated: ${result.reasons.join("; ")}`}`,
    );
    if (!result.calibrated) process.exitCode = 1;
    return;
  }
  if (command === "gate") {
    const sample = readFileSync(
      resolve(need(values.sample, "--sample")),
      "utf8",
    )
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const labels = normalizeLabels(json(need(values.labels, "--labels")));
    if (values["expect-rule-sha"] && values["expect-rule-sha"] !== ruleSHA256())
      throw Error(
        `Gate rule changed: ${ruleSHA256()} is not the pre-registered ${values["expect-rule-sha"]}`,
      );
    const result = evaluateGate({
      sample,
      labels,
      calibration: values.calibration ? json(values.calibration) : null,
    });
    write(need(values.out, "--out"), result);
    console.log(
      `gate rule ${result.ruleSHA256.slice(0, 12)}…; labeler ${result.labeler.type} (${result.labeler.who}) ${result.labelerOk ? "accepted" : "NOT accepted"}`,
    );
    console.log(
      `release: ${result.release.defaultSignals} signal(s) default; outcome ${result.release.outcome}`,
    );
    for (const [id, s] of Object.entries(result.signals))
      console.log(
        `${id}: ${s.verdict}; above cut ${s.aboveCut.actionable}/${s.aboveCut.n} (${pct(s.aboveCut.rate)} ±${pct(s.aboveCut.noiseFloor)}), ${s.aboveCut.projects} project(s); below cut ${pct(s.belowCut.rate)}${s.withinNoiseOfBar ? "; WITHIN NOISE of a bar" : ""}${s.reasons.length ? `; ${s.reasons.join("; ")}` : ""}`,
      );
    return;
  }
  throw Error("Unknown command; run with --help");
}

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
const entry = (() => {
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
})();
if (entry)
  main().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  });
