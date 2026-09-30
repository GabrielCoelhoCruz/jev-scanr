#!/usr/bin/env node
import {
  readFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { resolve, join, basename } from "node:path";
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
import { demoText } from "./demo.mjs";
import {
  credentialsPath,
  readSecret,
  removeApiKey,
  resolveApiKey,
  saveApiKey,
} from "./credentials.mjs";

export const SKILLS_CLI_VERSION = "1.7.0";

export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
).version;

export const skillSource = (version = VERSION) =>
  `https://github.com/GabrielCoelhoCruz/jev-scanr/tree/v${version}/skills/jev-scanr`;

export const HELP = `jev-scanr (short alias: jevs) ${VERSION}

Ranks refactoring candidates in a TypeScript/JavaScript project by asking the Jev model a few narrow questions about each function or similar pair. Deterministic code only cuts the project into units and gathers context. It does not score, rank or filter. Every finding and its order come from Jev's probabilities.

Usage
  jevs --version                              print the version
  jevs demo                                   replay a recorded run on the bundled demo app: no key, no network
  jevs auth [--remove]                        save your TypeSafe API key (owner-only file), or delete it
  jevs skill [--global] [--yes]               install the agent skill for this version, from its release tag (uses npx skills)
  jevs scan PATH [options]         dry run: shows units, requests and estimated cost, sends nothing
  jevs scan PATH --run --yes --cap-usd N [options]
                                                sends source excerpts to the Jev API and writes the report
  jevs report --plan PLAN --run-dir RUN --out DIR [--threshold 0.7] [--floor 0.5]
  jevs rescore RUN [--cut N] [--floor N] [--cut-signal ID=N] [--floor-signal ID=N]
                                                re-cut an existing run folder from its stored answers: no API call, no key;
                                                writes RUN/rescored-<settings>/ (queue.md, report.md, report.json), never overwrites
  jevs continue --plan PLAN --run-dir RUN --out NEWPLAN
                                                plan only the requests without an accepted answer
  jevs run --plan PLAN --out DIR --cap-usd N --yes
                                                run an existing plan
  jevs signals                                list the catalog and its evidence

Options for scan
  --exclude a,b,c     paths (files or directories, relative to PATH) that are never read or sent
  --paths a,b         scan only these directories or files (relative to PATH). Units and their context
                      come only from them. A scan reads at most 500 files, so scan a large project in slices
  --experimental      also ask the experimental signals (off by default; jevs signals shows which are which)
  --signals a,b       ask exactly these signals instead of the defaults
  --include-tests     also analyze test files (off by default)
  --external-configs FILE
                      offline JSON data for tsconfig files that live in packages (for example
                      "extends": "expo/tsconfig.base"). Never downloaded or executed; see docs/EXTERNAL-CONFIGS.md
  --list-files        dry run: list every file whose source would be sent, and the files skipped and why
  --run               send the excerpts to the Jev API instead of a dry run; needs --yes and --cap-usd
  --yes               consent to send source excerpts to the Jev API
  --cap-usd N         refuse to start if the worst-case cost exceeds N US dollars
  --concurrency N     live runs: up to N requests in flight (1 to 32, default 8). A token-bucket limiter keeps the
                      rate under Jev's documented limits (about 40 requests and 100K tokens per second, at 80%).
                      Any error, 429 included, stops the run; there are no automatic retries
  --out DIR           output directory, outside the project (default: a folder under ~/.cache/jev-scanr named after
                      the project and plan, printed by the dry run; rerunning the same plan resumes it)
  --threshold N       display cut for every signal, 0 to 1 (default 0.7): items at or above it are "worth a look"
  --floor N           lower edge of the "uncertain, check" band, 0 to 1 (default 0.5, or the cut if that is lower).
                      Items from the floor up to the cut go in the uncertain band; below it, report.json only
  --help              help (works after any command)
  --version           print the version

Sending source. Every analyzed excerpt goes to the Jev API (https://api.typesafe.ai) under your own key: TYPESAFE_API_KEY in the environment, or the one saved by jevs auth. Files whose path or content looks like a secret are skipped, and dot-directories, node_modules, build output and generated files are never read. That guard is a heuristic. Check --list-files and use --exclude before a live run.
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
  floor: { type: "string" },
  cut: { type: "string" },
  "cut-signal": { type: "string", multiple: true },
  "floor-signal": { type: "string", multiple: true },
  global: { type: "boolean" },
  remove: { type: "boolean" },
  "continuation-plan": { type: "string" },
  "continuation-run": { type: "string" },
};

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (command === "--version" || command === "-V" || command === "version")
    return { command: "version", values: {}, positionals: [] };
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  )
    return { command: "help", values: {}, positionals: [] };
  if (rest.includes("--help") || rest.includes("-h"))
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

function unit(flag, text) {
  const value = Number(text);
  if (text === "" || !Number.isFinite(value) || value < 0 || value > 1)
    throw Error(`${flag} must be within [0, 1]`);
  return value;
}

function perSignal(flag, all, pairs, plan) {
  const result =
    all === undefined
      ? {}
      : Object.fromEntries(
          plan.enabledSignals.map((id) => [id, unit(flag, all)]),
        );
  for (const pair of pairs ?? []) {
    const [id, text] = pair.split("=");
    if (!plan.enabledSignals.includes(id))
      throw Error(`${flag}-signal names ${id}, which this plan did not ask`);
    result[id] = unit(`${flag}-signal`, text ?? "");
  }
  return result;
}

function thresholds(values, plan) {
  if (values.threshold !== undefined && values.cut !== undefined)
    throw Error("Use either --threshold or --cut");
  return perSignal(
    values.cut === undefined ? "--threshold" : "--cut",
    values.cut ?? values.threshold,
    values["cut-signal"],
    plan,
  );
}

function floors(values, plan) {
  return perSignal("--floor", values.floor, values["floor-signal"], plan);
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

export function defaultOutDir(plan, env = process.env) {
  const base = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
  return join(
    base,
    "jev-scanr",
    `${basename(plan.root)}-${plan.planHash.slice(0, 8)}`,
  );
}

const FILE_STATUS = {
  excluded_path: "excluded by path or policy",
  potential_secret_no_content_stored:
    "skipped as possible secrets (content not read)",
  outside_paths: "outside --paths",
  unreadable_directory: "not readable as a directory",
  missing_or_unreadable: "missing or unreadable",
  unreadable: "unreadable",
  file_or_byte_limit: "over the file or size cap",
  file_changed_exceeds_limit: "grew past the size limit while reading",
  generated: "generated",
  path_escape: "outside the project",
  non_regular_or_multilink: "not a regular file",
  symlink: "symlink (never followed)",
  unsupported_config_extension: "unsupported configuration file",
};
const fileStatus = (k) => FILE_STATUS[k] ?? k.replaceAll("_", " ");

function skippedFiles(plan) {
  return plan.files
    .filter(
      (f) =>
        !["read", "non_source", "outside_paths"].includes(f.status) && f.path,
    )
    .map((f) => `${f.path}  (${fileStatus(f.status)})`)
    .sort();
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
      `Files: ${s.files.read ?? 0} read (source and configuration), ${
        Object.entries(s.files)
          .filter(([k]) => k !== "read" && k !== "non_source")
          .map(([k, v]) => `${v} ${fileStatus(k)}`)
          .join(", ") || "none skipped"
      }`,
      ...coverageLines(s.coverage, s.paths, s.unread, s),
      `Units: ${s.functionUnits} function${s.functionUnits === 1 ? "" : "s"}, ${s.pairUnits} similar pair${s.pairUnits === 1 ? "" : "s"}`,
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
    floors: extra.floors ?? {},
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
      "No TypeSafe API key. Run jevs auth, or set TYPESAFE_API_KEY in the environment (never pass it as an option)",
    );
  const out = outside(plan.root, values.out ?? defaultOutDir(plan, deps.env));
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
    floors: floors(values, plan),
    accounting: result,
  });
  console.log(
    `${result.complete ? "Complete" : "STOPPED (" + result.stoppedReason + ")"}: ${result.succeeded}/${result.plannedRequests} requests answered, ${usd(result.knownEstimatedUSD)} calculated cost${result.wallClockMs ? `, ${(result.wallClockMs / 1000).toFixed(0)} s wall-clock with concurrency ${result.concurrency}` : ""}, ${report.findings.length} candidates. Read ${join(out, "queue.md")}`,
  );
  if (!result.complete) process.exitCode = 2;
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const { command, values, positionals } = parseArgs(args);
  if (command === "version") return console.log(`jev-scanr ${VERSION}`);
  if (command === "help") return console.log(HELP);
  if (command === "auth") {
    if (positionals.length)
      throw Error(
        "Never pass the key as an argument; run jevs auth and type it when asked",
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
  if (command === "demo") {
    if (positionals.length)
      throw Error("demo takes no arguments; it replays the recorded run");
    return console.log(demoText());
  }
  if (command === "skill") {
    const args = [
      "--yes",
      `skills@${SKILLS_CLI_VERSION}`,
      "add",
      skillSource(),
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
                "Skill installation needs npx. Install npm, then run jevs skill again.",
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
    for (const sig of allSignals) {
      const t = sig.independentTest,
        d = sig.evidence[0];
      console.log(`${sig.id}@${sig.version}  [${sig.status}]`);
      console.log(
        `  independent test: ${t.reviewedAboveCut ? `${t.actionableAboveCut}/${t.reviewedAboveCut} actionable above the cut (random sample, two repositories)` : "no cell above the cut, nothing reviewed"}`,
      );
      console.log(
        `  dev run:          ${d.actionableAboveCut}/${d.reviewedAboveCut} (${d.corpus.split(" (")[0]}, highest-probability cells: an upper bound)`,
      );
    }
    console.log(
      "\nAll labels come from an LLM reviewer; no person has labeled them. See EVIDENCE.md.",
    );
    return;
  }
  if (command === "scan") {
    if (positionals.length !== 1) throw Error("scan needs one PATH");
    const target = resolve(positionals[0]);
    if (!existsSync(target)) throw Error(`No such directory: ${target}`);
    if (!statSync(target).isDirectory())
      throw Error(
        `PATH must be a directory, but ${target} is a file. To scan one file, pass its directory as PATH and the file with --paths.`,
      );
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
    floors(values, plan);
    if (values.paths && plan.coverage.sourceFiles?.inScope === 0)
      throw Error("--paths matched no source files under PATH");
    printSummary(plan, summary(plan));
    if (values["list-files"]) {
      console.log(
        `\nFiles whose source would be sent:\n${filesToSend(plan).join("\n")}`,
      );
      const skipped = skippedFiles(plan);
      console.log(
        `\nFiles skipped, and why${skipped.length ? `${skipped.length > 200 ? " (first 200)" : ""}:\n${skipped.slice(0, 200).join("\n")}` : ": none"}`,
      );
    }
    if (!values.run) {
      console.log(
        `\nDry run: nothing was sent and nothing was written.\nOutput would go to ${values.out ? outside(plan.root, values.out) : defaultOutDir(plan, deps.env)}\nTo run: jevs scan ${positionals[0]} --run --yes --cap-usd N${values.out ? "" : "   (add --out DIR to choose the folder)"}`,
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
      floors: floors(values, plan),
      accounting,
      runs,
    });
    console.log(
      `${report.provenance}: ${report.cells} cells, ${report.findings.length} candidates. Read ${join(out, "queue.md")}`,
    );
    return;
  }
  if (command === "rescore") {
    if (positionals.length !== 1) throw Error("rescore needs one RUN folder");
    const run = resolve(positionals[0]);
    const planPath = values.plan
      ? resolve(values.plan)
      : join(run, "plan.json");
    if (!existsSync(planPath))
      throw Error(
        `No plan at ${planPath}. rescore reads the plan.json and run/ that a scan wrote, or pass --plan`,
      );
    const plan = verifyPlan(JSON.parse(readFileSync(planPath, "utf8")));
    if (plan.continuationOf)
      throw Error("Rescore a continuation with jevs report and its base plan");
    const journal = existsSync(join(run, "run", "journal.jsonl"))
      ? join(run, "run")
      : run;
    const events = readJournal(journal, plan);
    if (!events.length) throw Error(`No recorded answers in ${journal}`);
    const cuts = thresholds(values, plan),
      lows = floors(values, plan);
    const settings = (label, map) =>
      new Set(Object.values(map)).size === 1 &&
      Object.keys(map).length === plan.enabledSignals.length
        ? [`${label}-${Object.values(map)[0]}`]
        : Object.entries(map).map(([id, v]) => `${label}-${id}-${v}`);
    const name = [...settings("cut", cuts), ...settings("floor", lows)].join(
      "_",
    );
    if (!name)
      throw Error(
        "rescore needs at least one of --cut, --floor, --cut-signal, --floor-signal",
      );
    const out = resolve(values.out ?? join(run, `rescored-${name}`));
    if (existsSync(out))
      throw Error(
        `${out} exists; choose a new --out or remove it. Nothing was overwritten`,
      );
    const report = buildReport(plan, events, {
      thresholds: cuts,
      floors: lows,
    });
    mkdirSync(out, { recursive: true, mode: 0o700 });
    writeNew(join(out, "report.json"), report);
    writeNew(
      join(out, "report.md"),
      reportMarkdown(report, summarize(events, plan)),
    );
    writeNew(join(out, "queue.md"), queueMarkdown(report));
    const b = report.bands.counts;
    console.log(
      `Rescored from stored answers (no API call, no key): ${b.worth_a_look} worth a look, ${b.uncertain} uncertain, ${b.below} below the band. Read ${join(out, "queue.md")}`,
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
