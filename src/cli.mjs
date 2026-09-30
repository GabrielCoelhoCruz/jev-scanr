#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import { writeNew, outside, POLICY } from "./core.mjs";
import { verifyPlan } from "./plan.mjs";
import { allSignals, defaultSignalIds } from "./catalog.mjs";
import { buildPlan } from "./build-plan.mjs";
import {
  makeClient,
  runPlan,
  readJournal,
  summarize,
  reservationUSD,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
} from "./runner.mjs";
import { buildReport, queueMarkdown, reportMarkdown } from "./report.mjs";
import { continuationPlan, combineRuns } from "./continuation.mjs";
import {
  credentialsPath,
  readSecret,
  removeApiKey,
  resolveApiKey,
  saveApiKey,
} from "./credentials.mjs";

export const SKILL_SOURCE = "GabrielCoelhoCruz/jev-refactor";

export const HELP = `jev-refactor (short alias: jr) ${JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version}

Ranks refactoring candidates in a TypeScript/JavaScript project by asking the Jev model a few narrow questions about each function or similar pair. Deterministic code only cuts the project into units and gathers context. It does not score, rank or filter. Every finding and its order come from Jev's probabilities.

Usage
  jr auth [--remove]                        save your TypeSafe API key (owner-only file), or delete it
  jr skill [--global] [--yes]               install the agent skill for your coding agents (uses npx skills)
  jr scan PATH [options]         dry run: shows units, requests and estimated cost, sends nothing
  jr scan PATH --run --yes --cap-usd N [options]
                                                sends source excerpts to the Jev API and writes the report
  jr report --plan PLAN --run RUN --out DIR [--threshold 0.7]
  jr continue --plan PLAN --run RUN --out NEWPLAN
                                                plan only the requests without an accepted answer
  jr run --plan PLAN --out DIR --cap-usd N --yes
                                                run an existing plan
  jr signals                     list the catalog and its evidence

Options for scan
  --exclude a,b,c     paths (files or directories, relative to PATH) that are never read or sent
  --paths a,b         scan only these directories or files (relative to PATH). Units and their context
                      come only from them. A scan reads at most 500 files, so scan a large project in slices
  --experimental      also ask the experimental signals (off by default)
  --signals a,b       ask exactly these signals instead of the defaults
  --include-tests     also analyze test files (off by default)
  --external-configs FILE
                      offline JSON data for tsconfig files that live in packages (for example
                      "extends": "expo/tsconfig.base"). Never downloaded or executed; see docs/EXTERNAL-CONFIGS.md
  --list-files        dry run: list every file whose source would be sent
  --concurrency N     live runs: up to N requests in flight (1 to 32, default 8). A token-bucket limiter keeps the
                      rate under Jev's documented limits (about 40 requests and 100K tokens per second, at 80%).
                      Any error, 429 included, stops the run; there are no automatic retries
  --out DIR           output directory (default ./jev-scan-out; must not exist for a new run)
  --threshold N       display cut for every signal, 0 to 1 (default 0.7)

Sending source. Every analyzed excerpt goes to the Jev API (https://api.typesafe.ai) under your own key: TYPESAFE_API_KEY in the environment, or the one saved by jr auth. Files whose path or content looks like a secret are skipped, and dot-directories, node_modules, build output and generated files are never read. That guard is a heuristic. Check --list-files and use --exclude before a live run.
`;

const options = {
  plan: { type: "string" },
  run: { type: "boolean" },
  "run-dir": { type: "string" },
  out: { type: "string" },
  "cap-usd": { type: "string" },
  yes: { type: "boolean" },
  exclude: { type: "string" },
  paths: { type: "string" },
  concurrency: { type: "string" },
  experimental: { type: "boolean" },
  signals: { type: "string" },
  "include-tests": { type: "boolean" },
  "external-configs": { type: "string" },
  "list-files": { type: "boolean" },
  threshold: { type: "string" },
  global: { type: "boolean" },
  remove: { type: "boolean" },
  "continuation-plan": { type: "string" },
  "continuation-run": { type: "string" },
};

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  )
    return { command: "help", values: {}, positionals: [] };
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options,
    allowPositionals: true,
    strict: true,
  });
  const scanValues = command === "report" || command === "continue";
  if (scanValues && values.run)
    throw Error("Use --run-dir RUN for the run directory");
  return { command, values, positionals };
}

const usd = (n) => `US$${n.toFixed(4)}`;

function signalSelection(values) {
  if (values.signals && values.experimental)
    throw Error("Use either --signals or --experimental");
  if (values.signals) return values.signals.split(",").filter(Boolean);
  return values.experimental ? allSignals.map((s) => s.id) : defaultSignalIds;
}

function thresholds(values, plan) {
  if (values.threshold === undefined) return {};
  const cut = Number(values.threshold);
  if (!Number.isFinite(cut) || cut < 0 || cut > 1)
    throw Error("--threshold must be within [0, 1]");
  return Object.fromEntries(plan.enabledSignals.map((id) => [id, cut]));
}

export function unindexedByDirectory(plan) {
  const files = new Set(
    (plan.coverage.parseAndIndexOmissions ?? [])
      .filter((o) => o.reason === "function_limit")
      .map((o) => o.path),
  );
  const counts = new Map();
  for (const path of files) {
    const dir = path.split("/").slice(0, -1).slice(0, 4).join("/") || ".";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return {
    files: files.size,
    directories: [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}

export function unreadByDirectory(plan) {
  const depth = Math.max(
    2,
    ...(plan.scope?.paths ?? []).map((p) => p.split("/").length + 1),
  );
  const counts = new Map();
  for (const f of plan.files)
    if (
      f.status === "file_or_byte_limit" &&
      /\.(?:[cm]?[jt]s|[jt]sx)$/.test(f.path)
    ) {
      const dir =
        f.path
          .split("/")
          .slice(0, Math.min(depth, f.path.split("/").length - 1))
          .join("/") || ".";
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

const n = (x) => x.toLocaleString("en-US");
export function coverageLines(c, paths, unread, extra = {}) {
  if (!c) return [];
  const lines = [];
  const pct = c.inScope ? Math.round((c.read / c.inScope) * 100) : 100;
  if (paths.length)
    lines.push(
      `Scope: --paths ${paths.join(",")} covers ${n(c.inScope)} of ${n(c.inProject)} source files in the project.`,
    );
  lines.push(
    `Coverage: read ${n(c.read)} of ${n(c.inScope)} source files${paths.length ? " in scope" : ""} (${pct}%).`,
  );
  if (c.unreadByFileOrByteCap > 0)
    lines.push(
      `NOT READ because of the ${n(500)}-file / size cap (files are taken in path order): ${n(c.unreadByFileOrByteCap)} source files, in ${unread
        .slice(0, 8)
        .map(([d, k]) => `${d} (${n(k)})`)
        .join(
          ", ",
        )}${unread.length > 8 ? `, and ${unread.length - 8} more directories` : ""}. Narrow with --paths so each scan stays under the cap.`,
    );
  if (extra.unindexed?.files > 0)
    lines.push(
      `NOT INDEXED because the function index is capped at ${n(extra.functionLimit)} functions (nested functions and tests count): functions in ${n(extra.unindexed.files)} files, in ${extra.unindexed.directories
        .slice(0, 6)
        .map(([d, k]) => `${d} (${n(k)})`)
        .join(", ")}. Use a smaller --paths.`,
    );
  if (extra.unitsNotPacked > 0)
    lines.push(
      `NOT PACKED: ${n(extra.unitsNotPacked)} units are beyond the ${n(extra.unitLimit)}-unit limit and get no answer. Use a smaller --paths.`,
    );
  return lines;
}

function summary(plan) {
  const e = plan.estimates,
    counts = plan.files.reduce(
      (m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m),
      {},
    ),
    conservative = e.USDOneBytePerTokenSensitivity + reservationUSD;
  return {
    planHash: plan.planHash,
    signals: plan.enabledSignals,
    files: counts,
    units: plan.coverage.functionUnits + plan.coverage.pairUnits,
    functionUnits: plan.coverage.functionUnits,
    pairUnits: plan.coverage.pairUnits,
    coverage: plan.coverage.sourceFiles ?? null,
    paths: plan.scope?.paths ?? [],
    unread: unreadByDirectory(plan),
    unindexed: unindexedByDirectory(plan),
    unitsNotPacked: plan.coverage.unitsNotPacked ?? 0,
    functionLimit: plan.limits.maxFunctions,
    unitLimit: plan.limits.maxCandidates,
    requests: e.requests,
    questions: e.questions,
    requestBytes: e.serializedRequestBytes,
    estimatedUSD: e.heuristicUSDBytesDiv3,
    conservativeUSD: conservative,
  };
}

function printSummary(plan, s) {
  console.log(
    [
      `Plan ${s.planHash.slice(0, 12)}… · model ${POLICY.model} at US$${POLICY.inputUSDPerMillion}/M input tokens`,
      `Signals: ${s.signals.join(", ")}`,
      `Files: ${s.files.read ?? 0} read, ${
        Object.entries(s.files)
          .filter(([k]) => k !== "read" && k !== "non_source")
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "none skipped"
      }`,
      ...coverageLines(s.coverage, s.paths, s.unread, s),
      `Units: ${s.functionUnits} functions, ${s.pairUnits} similar pairs`,
      `Requests: ${s.requests} (${s.questions} questions, ${(s.requestBytes / 1e6).toFixed(2)} MB of request text)`,
      `Estimated cost: ${usd(s.estimatedUSD)} (bytes ÷ 3 per token); worst case ${usd(s.conservativeUSD)} (one token per byte, plus one reservation)`,
      "Costs are calculated from the documented tariff, not an invoice.",
    ].join("\n"),
  );
}

function filesToSend(plan) {
  return [
    ...new Set(
      plan.requests.flatMap((r) => r.request.state.sections.map((s) => s.path)),
    ),
  ].sort();
}

function writeReport(plan, events, out, extra = {}) {
  const report = buildReport(plan, events, {
    thresholds: extra.thresholds ?? {},
  });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeNew(join(out, "report.json"), report);
  writeNew(join(out, "report.md"), reportMarkdown(report, extra.accounting));
  writeNew(join(out, "queue.md"), queueMarkdown(report));
  if (extra.runs) writeNew(join(out, "runs.json"), extra.runs);
  return report;
}

async function execute(plan, values, deps) {
  const cap = Number(values["cap-usd"]);
  if (!values.yes || !Number.isFinite(cap) || cap <= 0)
    throw Error(
      "A live run needs --yes (consent to send source excerpts to the Jev API) and a positive --cap-usd",
    );
  const concurrency =
    values.concurrency === undefined
      ? DEFAULT_CONCURRENCY
      : Number(values.concurrency);
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENCY
  )
    throw Error(
      `--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`,
    );
  const s = summary(plan);
  if (s.conservativeUSD > cap)
    throw Error(
      `Worst-case cost ${usd(s.conservativeUSD)} exceeds --cap-usd ${cap}. Lower the scope with --exclude or --signals, or raise the cap.`,
    );
  const apiKey = deps.client ? null : resolveApiKey(deps.env);
  if (!deps.client && !apiKey)
    throw Error(
      "No TypeSafe API key. Run jr auth, or set TYPESAFE_API_KEY in the environment (never pass it as an option)",
    );
  const out = outside(plan.root, values.out ?? "jev-scan-out");
  const captured = join(out, "plan.json");
  if (existsSync(join(out, "report.json")))
    throw Error(
      `${out} already holds a finished report; choose a new --out to run again`,
    );
  if (existsSync(out)) {
    if (
      !existsSync(captured) ||
      verifyPlan(JSON.parse(readFileSync(captured))).planHash !== plan.planHash
    )
      throw Error("Output directory exists and does not hold this plan");
  } else mkdirSync(out, { recursive: true, mode: 0o700 });
  if (!existsSync(captured)) writeNew(captured, plan);
  const runDir = join(out, "run");
  const result = await runPlan({
    plan,
    directory: runDir,
    client: deps.client ?? makeClient({ apiKey }),
    mode: "live",
    capUSD: cap,
    concurrency,
  });
  const events = readJournal(runDir, plan);
  const report = writeReport(plan, events, out, {
    thresholds: thresholds(values, plan),
    accounting: result,
  });
  console.log(
    `${result.complete ? "Complete" : "STOPPED (" + result.stoppedReason + ")"}: ${result.succeeded}/${result.plannedRequests} requests answered, ${usd(result.knownEstimatedUSD)} calculated cost${result.wallClockMs ? `, ${(result.wallClockMs / 1000).toFixed(0)} s wall-clock with concurrency ${result.concurrency}` : ""}, ${report.findings.length} candidates. Read ${join(out, "queue.md")}`,
  );
  if (!result.complete) process.exitCode = 2;
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const { command, values, positionals } = parseArgs(args);
  if (command === "help") return console.log(HELP);
  if (command === "auth") {
    if (positionals.length)
      throw Error(
        "Never pass the key as an argument; run jr auth and type it when asked",
      );
    if (values.remove) {
      const { file, existed } = removeApiKey(deps.env);
      return console.log(
        existed ? `Removed ${file}` : `No saved key at ${file}`,
      );
    }
    const key = await (deps.readSecret ?? readSecret)(
      "TypeSafe API key (input hidden): ",
    );
    const file = saveApiKey(key, deps.env);
    return console.log(
      `Saved to ${file} (owner-only). TYPESAFE_API_KEY in the environment overrides it.`,
    );
  }
  if (command === "skill") {
    const args = [
      "--yes",
      "skills",
      "add",
      SKILL_SOURCE,
      "--skill",
      "jev-refactor",
    ];
    if (values.global) args.push("--global");
    if (values.yes) args.push("--yes");
    if (deps.skillArgs) return deps.skillArgs(args);
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn("npx", args, { stdio: "inherit" });
      child.on("error", (e) =>
        reject(
          e.code === "ENOENT"
            ? Error(
                "Skill installation needs npx. Install npm, then run jr skill again.",
              )
            : e,
        ),
      );
      child.on("exit", resolveExit);
    });
    if (code !== 0) throw Error(`npx skills exited with code ${code}`);
    return;
  }
  if (command === "signals") {
    for (const s of allSignals) {
      const e = s.evidence[0];
      console.log(
        `${s.id}@${s.version}  [${s.status}]  ${e.actionableAboveCut}/${e.reviewedAboveCut} actionable above the cut (${e.corpus.split(" (")[0]})`,
      );
    }
    return;
  }
  if (command === "scan") {
    if (positionals.length !== 1) throw Error("scan needs one PATH");
    const plan = buildPlan(positionals[0], {
      signals: signalSelection(values),
      excluded: values.exclude ? values.exclude.split(",").filter(Boolean) : [],
      paths: values.paths ? values.paths.split(",").filter(Boolean) : [],
      externalConfigs: values["external-configs"]
        ? JSON.parse(readFileSync(resolve(values["external-configs"]), "utf8"))
        : [],
      retrieval: { includeTests: !!values["include-tests"] },
    });
    verifyPlan(plan);
    thresholds(values, plan);
    printSummary(plan, summary(plan));
    if (values["list-files"])
      console.log(
        `\nFiles whose source would be sent:\n${filesToSend(plan).join("\n")}`,
      );
    if (!values.run) {
      console.log(
        "\nDry run: nothing was sent and nothing was written. Add --run --yes --cap-usd N to run.",
      );
      return;
    }
    return execute(plan, values, deps);
  }
  if (command === "run") {
    if (!values.plan) throw Error("--plan required");
    return execute(
      verifyPlan(JSON.parse(readFileSync(resolve(values.plan), "utf8"))),
      values,
      deps,
    );
  }
  if (command === "continue") {
    if (!values.plan || !values["run-dir"] || !values.out)
      throw Error("--plan, --run-dir and --out required");
    const plan = verifyPlan(
      JSON.parse(readFileSync(resolve(values.plan), "utf8")),
    );
    const next = continuationPlan(plan, [
      { plan, events: readJournal(resolve(values["run-dir"]), plan) },
    ]);
    writeNew(outside(plan.root, values.out), next);
    printSummary(next, summary(next));
    return;
  }
  if (command === "report") {
    if (!values.plan || !values.out) throw Error("--plan and --out required");
    const plan = verifyPlan(
      JSON.parse(readFileSync(resolve(values.plan), "utf8")),
    );
    if (plan.continuationOf)
      throw Error("Report a continuation through its base plan");
    let events = values["run-dir"]
      ? readJournal(resolve(values["run-dir"]), plan)
      : [];
    if (values["run-dir"] && !events.length) throw Error("No recorded run");
    let runs = null,
      accounting = values["run-dir"] ? summarize(events, plan) : null;
    if (values["continuation-plan"] || values["continuation-run"]) {
      if (
        !values["run-dir"] ||
        !values["continuation-plan"] ||
        !values["continuation-run"]
      )
        throw Error("Continuation needs the base run, its plan and its run");
      const next = verifyPlan(
        JSON.parse(readFileSync(resolve(values["continuation-plan"]), "utf8")),
      );
      ({ events, accounting: runs } = combineRuns(plan, [
        { plan, events },
        {
          plan: next,
          events: readJournal(resolve(values["continuation-run"]), next),
        },
      ]));
      accounting = runs;
    }
    const out = outside(plan.root, values.out);
    if (existsSync(out)) throw Error("Output must be new");
    const report = writeReport(plan, events, out, {
      thresholds: thresholds(values, plan),
      accounting,
      runs,
    });
    console.log(
      `${report.provenance}: ${report.cells} cells, ${report.findings.length} candidates. Read ${join(out, "queue.md")}`,
    );
    return;
  }
  throw Error("Unknown command; run with --help");
}

function isEntryPoint() {
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isEntryPoint())
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
