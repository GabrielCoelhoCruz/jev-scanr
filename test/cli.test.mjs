import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { HELP, defaultOutDir, main, parseArgs } from "../src/cli.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { readJournal } from "../src/runner.mjs";
import { verifyPlan } from "../src/plan.mjs";
import {
  clone,
  project,
  scratch,
  fake,
  response,
  positive,
  twoFiles,
} from "./helpers.mjs";

const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
const env = { PATH: process.env.PATH };
const spawn = (args, cwd, extra = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...env, ...extra },
    encoding: "utf8",
  });

const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.after(() => {
    process.exitCode = 0;
  });
};

test("argument parsing rejects unknown options and prints help", () => {
  assert.equal(parseArgs([]).command, "help");
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.throws(() => parseArgs(["scan", "x", "--nope"]));
  assert.throws(() => parseArgs(["scan", "x", "--cap-usd"]));
  assert.throws(() => parseArgs(["report", "--run", "x"]));
});

test("a scan is a dry run by default: it prints the estimate, needs no key and writes nothing", (t) => {
  const root = project(t, twoFiles),
    cwd = scratch(t);
  const result = spawn(["scan", root], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Requests: \d+/);
  assert.match(result.stdout, /Estimated cost: US\$/);
  assert.match(result.stdout, /worst case US\$/);
  assert.match(
    result.stdout,
    /Dry run: nothing was sent and nothing was written/,
  );
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(readdirSync(root).sort(), ["a.ts", "b.ts"]);
  const listed = spawn(["scan", root, "--list-files"], cwd);
  assert.match(
    listed.stdout,
    /Files whose source would be sent:\na\.ts\nb\.ts/,
  );
});

test("a live run needs consent, a cap, a credential and a worst case that fits the cap", (t) => {
  const root = project(t, twoFiles),
    cwd = scratch(t);
  for (const [args, extra, message] of [
    [
      ["scan", root, "--run", "--cap-usd", "1"],
      { TYPESAFE_API_KEY: "k" },
      /--yes/,
    ],
    [["scan", root, "--run", "--yes"], { TYPESAFE_API_KEY: "k" }, /--cap-usd/],
    [
      ["scan", root, "--run", "--yes", "--cap-usd", "1"],
      {},
      /TYPESAFE_API_KEY/,
    ],
    [
      ["scan", root, "--run", "--yes", "--cap-usd", "0.0001"],
      { TYPESAFE_API_KEY: "k" },
      /exceeds --cap-usd/,
    ],
  ]) {
    const result = spawn(args, cwd, extra);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.ok(!result.stderr.includes("k\n"), "the credential is never echoed");
  }
  assert.deepEqual(readdirSync(cwd), []);
  assert.throws(() => parseArgs(["scan", root, "--api-key", "x"]));
});

test("a live run with a fake client writes plan, journal, report.json, report.md and queue.md, and replays without new calls", async (t) => {
  quiet(t);
  const root = project(t, twoFiles),
    out = join(scratch(t), "out");
  let calls = 0;
  const client = fake(async (request) => {
    calls++;
    return response(request, positive(0.9));
  });
  const args = ["scan", root, "--run", "--yes", "--cap-usd", "1", "--out", out];
  await main(args, { client });
  for (const f of [
    "plan.json",
    "report.json",
    "report.md",
    "queue.md",
    "run/journal.jsonl",
  ])
    assert.ok(existsSync(join(out, f)), f);
  const report = JSON.parse(readFileSync(join(out, "report.json")));
  assert.equal(report.provenance, "live");
  assert.ok(report.findings.length > 0);
  assert.match(readFileSync(join(out, "queue.md"), "utf8"), /# Refactor queue/);
  const before = calls;
  assert.ok(before > 0);
  assert.notEqual(process.exitCode, 2);
  await assert.rejects(
    main(args, { client }),
    /already holds a finished report/,
  );
  assert.equal(calls, before);
});

test("the output directory cannot be inside the analyzed project", async (t) => {
  quiet(t);
  const root = project(t, twoFiles);
  await assert.rejects(
    main(
      [
        "scan",
        root,
        "--run",
        "--yes",
        "--cap-usd",
        "1",
        "--out",
        join(root, "out"),
      ],
      { client: fake() },
    ),
    /outside/,
  );
});

test("a stopped run still writes a partial report and exits with code 2", async (t) => {
  quiet(t);
  const root = project(t, twoFiles),
    out = join(scratch(t), "out");
  await main(["scan", root, "--run", "--yes", "--cap-usd", "1", "--out", out], {
    client: fake(async (r) => ({ ...response(r), model: "unexpected" })),
  });
  assert.equal(process.exitCode, 2);
  const report = JSON.parse(readFileSync(join(out, "report.json")));
  assert.equal(report.findings.length, 0);
  assert.ok((report.statusCounts.error ?? 0) > 0);
});

test("--threshold changes only the display cut, and --experimental adds the experimental signal", async (t) => {
  quiet(t);
  const root = project(t, twoFiles),
    out = join(scratch(t), "out");
  await main(
    [
      "scan",
      root,
      "--run",
      "--yes",
      "--cap-usd",
      "1",
      "--out",
      out,
      "--experimental",
      "--threshold",
      "0.95",
    ],
    { client: fake(async (r) => response(r, positive(0.9))) },
  );
  const report = JSON.parse(readFileSync(join(out, "report.json")));
  assert.ok("unreachable_code" in report.views);
  assert.equal(report.findings.length, 0);
  assert.ok(Object.values(report.views).every((v) => v.threshold === 0.95));
  await assert.rejects(main(["scan", root, "--threshold", "2"]), /threshold/);
  await assert.rejects(
    main(["scan", root, "--signals", "deep_nesting", "--experimental"]),
    /either/,
  );
});

test("signals lists each signal with the independent test first and the dev run second", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(["signals"]);
  const text = lines.join("\n");
  assert.match(
    text,
    /clone_same_policy@\S+\s+\[default\]\n\s+independent test: 12\/16 actionable/,
  );
  assert.match(text, /dev run:\s+5\/5 \(daily-tracker/);
  assert.match(
    text,
    /deep_nesting@\S+\s+\[experimental\]\n\s+independent test: no cell above the cut/,
  );
  assert.match(text, /unreachable_code@\S+\s+\[experimental\]/);
  assert.match(text, /No person has labeled|no person has labeled/i);
  assert.ok(text.indexOf("independent test") < text.indexOf("dev run"));
});

test("the help names the flags the parser accepts, and --help works after a command", async (t) => {
  assert.match(HELP, /report --plan PLAN --run-dir RUN/);
  assert.match(HELP, /continue --plan PLAN --run-dir RUN/);
  assert.ok(!/--run RUN/.test(HELP));
  assert.match(HELP, /--cap-usd N/);
  assert.match(HELP, /--yes /);
  for (const args of [
    ["scan", "--help"],
    ["signals", "-h"],
    ["continue", "--help"],
    ["auth", "--help"],
  ]) {
    const lines = [];
    t.mock.method(console, "log", (line) => lines.push(line));
    await main(args);
    assert.match(lines.at(-1), /^jev-scanr \(short alias: jevs\)/);
    t.mock.restoreAll();
  }
});

test("scan refuses a file or a missing directory as PATH, in plain words", async (t) => {
  const dir = project(t, { "a.ts": clone("alpha") });
  await assert.rejects(
    main(["scan", join(dir, "a.ts")]),
    /PATH must be a directory.*--paths/,
  );
  await assert.rejects(
    main(["scan", join(dir, "missing")]),
    /No such directory/,
  );
});

test("the dry run prints a default output folder outside the project, and the live default is the same folder", async (t) => {
  const dir = project(t, { "a.ts": clone("alpha") });
  const cache = scratch(t);
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(["scan", dir], { env: { XDG_CACHE_HOME: cache } });
  const printed = lines.join("\n").match(/Output would go to (\S+)/)[1];
  assert.ok(printed.startsWith(join(cache, "jev-scanr") + "/"));
  assert.ok(!printed.startsWith(dir));
  assert.equal(
    defaultOutDir(buildPlan(dir), { XDG_CACHE_HOME: cache }),
    printed,
  );
  assert.ok(!existsSync(printed), "a dry run writes nothing");
});

test("a live run without --out writes the report to the default folder and resumes nothing it should not", async (t) => {
  const dir = project(t, { "a.ts": clone("alpha") + clone("beta", "20") });
  const cache = scratch(t);
  const env = { XDG_CACHE_HOME: cache };
  const p = buildPlan(dir);
  const client = fake(async (r) => response(r, positive(0.9)));
  await main(["scan", dir, "--run", "--yes", "--cap-usd", "1"], {
    env,
    client,
  });
  const out = defaultOutDir(p, env);
  assert.ok(existsSync(join(out, "queue.md")));
  await assert.rejects(
    main(["scan", dir, "--run", "--yes", "--cap-usd", "1"], { env, client }),
    /already holds a finished report/,
  );
});

test("file statuses are printed in words, and --list-files says which files were skipped and why", async (t) => {
  const dir = project(t, {
    "a.ts": clone("alpha"),
    "secret-keys.ts": "export const x = 1;\n",
    "node_modules/pkg/index.ts": "export const y = 2;\n",
  });
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(["scan", dir, "--list-files"], {
    env: { XDG_CACHE_HOME: scratch(t) },
  });
  const text = lines.join("\n");
  assert.ok(!/excluded_path|potential_secret|outside_paths/.test(text));
  assert.match(text, /excluded by path or policy/);
  assert.match(
    text,
    /Files skipped, and why:\n(?:.*\n)*?secret-keys\.ts {2}\(excluded by path or policy\)/,
  );
  assert.match(text, /1 function, 0 similar pairs/);
});

test("report and continue reject --run with the flag name the help uses", async () => {
  await assert.rejects(
    main(["report", "--plan", "x", "--run", "y", "--out", "z"]),
    /Use --run-dir RUN/,
  );
  await assert.rejects(
    main(["continue", "--plan", "x", "--run", "y", "--out", "z"]),
    /Use --run-dir RUN/,
  );
});

test("a stopped run can be continued, and the combined report accounts for both runs", async (t) => {
  quiet(t);
  const root = project(t, twoFiles),
    work = scratch(t),
    out = join(work, "out");
  let sent = 0;
  await main(["scan", root, "--run", "--yes", "--cap-usd", "1", "--out", out], {
    client: fake(async (r) => {
      sent++;
      return sent === 2
        ? { ...response(r), model: "unexpected" }
        : response(r, positive(0.9));
    }),
  });
  assert.equal(process.exitCode, 2);
  process.exitCode = 0;
  const cont = join(work, "continuation.json");
  await main([
    "continue",
    "--plan",
    join(out, "plan.json"),
    "--run-dir",
    join(out, "run"),
    "--out",
    cont,
  ]);
  const next = verifyPlan(JSON.parse(readFileSync(cont)));
  assert.ok(next.continuationOf);
  const contOut = join(work, "cont-out");
  mkdirSync(contOut);
  await main(
    [
      "run",
      "--plan",
      cont,
      "--yes",
      "--cap-usd",
      "1",
      "--out",
      join(work, "cont-run"),
    ],
    {
      client: fake(async (r) => response(r, positive(0.9))),
    },
  );
  await main([
    "report",
    "--plan",
    join(out, "plan.json"),
    "--run-dir",
    join(out, "run"),
    "--continuation-plan",
    cont,
    "--continuation-run",
    join(work, "cont-run", "run"),
    "--out",
    join(work, "combined"),
  ]);
  const runs = JSON.parse(readFileSync(join(work, "combined", "runs.json")));
  assert.equal(runs.complete, true);
  assert.equal(runs.runs.length, 2);
  assert.equal(runs.supersededFailures.length, 1);
  assert.equal(
    readJournal(join(work, "cont-run", "run"), next).at(-1).type,
    "complete",
  );
  await assert.rejects(
    main(["report", "--plan", cont, "--out", join(work, "bad")]),
    /base plan/,
  );
});

test("the package binary runs under node and prints help", () => {
  const out = execFileSync(process.execPath, [cli, "--help"], {
    env,
    encoding: "utf8",
  });
  assert.match(out, /Usage/);
  assert.match(out, /TYPESAFE_API_KEY/);
});

test("the binary also runs through a symlink, as npm and npx install it", (t) => {
  const link = join(scratch(t), "jev-scanr");
  symlinkSync(cli, link);
  const out = execFileSync(process.execPath, [link, "signals"], {
    env,
    encoding: "utf8",
  });
  assert.match(out, /clone_same_policy@/);
});

test("--version, -V and version print the package version", () => {
  const version = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  ).version;
  for (const flag of ["--version", "-V", "version"]) {
    const out = execFileSync(process.execPath, [cli, flag], {
      env,
      encoding: "utf8",
    });
    assert.equal(out.trim(), `jev-scanr ${version}`);
  }
});

test("demo replays the recorded run offline: no key, nothing written, labeled as a recording", (t) => {
  const cwd = scratch(t);
  const result = spawn(["demo"], cwd, { HOME: cwd });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split("\n");
  assert.equal(
    lines[0],
    "RECORDED RUN. This replays a saved result: nothing is sent, and no key or network is needed.",
  );
  assert.equal(
    lines[1],
    "  Recorded with jev-scanr 0.3.1-alpha on 2026-09-30, model jev-1.13.0, on the synthetic app in examples/demo-app.",
  );
  assert.equal(
    lines[2],
    "  15 of 15 requests answered, 19,754 input tokens, US$0.0008 calculated from the tariff (not an invoice).",
  );
  assert.deepEqual(
    lines.filter((l) => l.startsWith("## ")),
    [
      "## 1. clampPercent src/percent.ts:1–14 ↔ clampVolume src/volume.ts:1–14 · clone_same_policy@3.0.0 · P=0.98",
      "## 2. importOrders src/importer.ts:7–42 · function_should_split@1.0.0 · P=0.90",
      "## 3. importOrders src/importer.ts:7–42 · function_multiple_responsibilities@1.0.0 · P=0.88",
      "## 4. registerUser src/signup.ts:1–27 · function_multiple_responsibilities@1.0.0 · P=0.78",
    ],
  );
  assert.match(result.stdout, /hypotheses from one Jev answer each/);
  assert.match(result.stdout, /jevs scan \.\n$/);
  assert.deepEqual(readdirSync(cwd), []);
});

test("demo takes no arguments and is listed in the help", (t) => {
  const cwd = scratch(t);
  const result = spawn(["demo", "src"], cwd);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /^Error: demo takes no arguments; it replays the recorded run/,
  );
  assert.match(
    HELP,
    /jevs demo {35}replay a recorded run on the bundled demo app: no key, no network/,
  );
  assert.equal(
    spawn(["demo", "--help"], cwd).stdout.includes("jevs demo"),
    true,
  );
});
