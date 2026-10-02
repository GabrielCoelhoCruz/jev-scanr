import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { main, HELP } from "../src/cli.mjs";
import {
  baselineMarkdown,
  buildBaseline,
  BASELINE_SIGNAL,
} from "../src/baseline.mjs";
import { scratch } from "./helpers.mjs";

const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
const demoReport = new URL(
  "../examples/demo-app/expected/report.json",
  import.meta.url,
).pathname;
const spawn = (args, cwd) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });

const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.after(() => {
    process.exitCode = 0;
  });
};

const location = (name, path, startLine, endLine) => ({
  name,
  path,
  startLine,
  endLine,
  role: "focus",
});
const scored = (pPositive, band = "below") => ({
  signalId: BASELINE_SIGNAL,
  status: "scored",
  pPositive,
  band,
});
const functionBlock = (unitId, at, signals) => ({
  unitId,
  kind: "function",
  location: [location(...at)],
  signals,
});
const report = (blocks) => ({ blocks });

const fixture = () =>
  report([
    functionBlock(
      "aaaa",
      ["alpha", "src/big.ts", 1, 30],
      [scored(0.9, "worth_a_look")],
    ),
    functionBlock("bbbb", ["beta", "src/tie.ts", 5, 34], [scored(0.8)]),
    functionBlock(
      "cccc",
      ["gamma", "src/short.ts", 1, 10],
      [{ signalId: BASELINE_SIGNAL, status: "unanswered", pPositive: null }],
    ),
    functionBlock("dddd", ["delta", "src/tiny.ts", 1, 8], [scored(0)]),
    { unitId: "eeee", kind: "clone_pair", location: [], signals: [] },
    functionBlock(
      "aaaa",
      ["shadowed duplicate", "src/dup.ts", 1, 99],
      [scored(1)],
    ),
  ]);

test("ranks by length, keeps unscored functions as gaps instead of P 0, and excludes clone pairs", () => {
  const result = buildBaseline(fixture(), { top: 3 });
  assert.deepEqual(
    result.functions.map((f) => [f.unitId, f.lines, f.lengthRank]),
    [
      ["aaaa", 30, 1],
      ["bbbb", 30, 2],
      ["cccc", 10, 3],
      ["dddd", 8, 4],
    ],
  );
  assert.deepEqual(
    result.functions.map((f) => [f.p, f.jevRank]),
    [
      [0.9, 1],
      [0.8, 2],
      [null, null],
      [0, 3],
    ],
  );
  assert.equal(result.census.duplicateUnitIds, 1);
  assert.equal(result.census.functionBlocks, 4);
  assert.equal(result.census.clonePairBlocks, 1);
  assert.equal(result.census.scored, 3);
  assert.deepEqual(result.overlap, {
    of: 3,
    count: 2,
    unitIds: ["aaaa", "bbbb"],
  });
  assert.deepEqual(result.census.gaps, [
    {
      unitId: "cccc",
      reason: "function_should_split not scored (unanswered); no P imputed",
    },
  ]);
});

test("both rankings break ties by unitId, so two runs of the same report are identical", () => {
  const tied = report([
    functionBlock("zzzz", ["late", "src/z.ts", 1, 9], [scored(0.5)]),
    functionBlock("mmmm", ["early", "src/m.ts", 1, 9], [scored(0.5)]),
  ]);
  assert.deepEqual(
    buildBaseline(tied, { top: 2 }).functions.map((f) => f.unitId),
    ["mmmm", "zzzz"],
  );
  assert.deepEqual(
    buildBaseline(tied, { top: 2 }).jevTop.map((f) => f.unitId),
    ["mmmm", "zzzz"],
  );
  assert.deepEqual(
    buildBaseline(tied, { top: 2 }),
    buildBaseline(tied, { top: 2 }),
  );
});

test("a report where nothing was scored shows only the length ranking and the gaps", () => {
  const unscored = report([
    functionBlock(
      "aaaa",
      ["alpha", "src/a.ts", 1, 20],
      [{ signalId: BASELINE_SIGNAL, status: "error", pPositive: null }],
    ),
    functionBlock("bbbb", ["beta", "src/b.ts", 1, 10], []),
  ]);
  const result = buildBaseline(unscored, { top: 2 });
  assert.deepEqual(result.jevTop, []);
  assert.deepEqual(result.overlap, { of: 2, count: 0, unitIds: [] });
  assert.ok(result.functions.every((f) => f.p === null));
  assert.equal(result.census.scored, 0);
  assert.equal(result.census.gaps.length, 2);
  const markdown = baselineMarkdown(result);
  assert.match(markdown, /only the length ranking is shown/);
  assert.match(markdown, /No overlap: one of the rankings is empty/);
});

test("blocks whose focus or signal cells cannot be used become gaps, not NaN rows", () => {
  const forged = report([
    {
      unitId: "ffff",
      kind: "function",
      location: [
        {
          name: "forked",
          path: "src/f.ts",
          startLine: 1,
          endLine: 5,
          role: "focus",
        },
        {
          name: "forked2",
          path: "src/f.ts",
          startLine: 1,
          endLine: 6,
          role: "focus",
        },
      ],
      signals: [scored(0.9)],
    },
    {
      unitId: "gggg",
      kind: "function",
      location: [{ name: "nolines", role: "focus" }],
      signals: [scored(0.9)],
    },
    {
      unitId: "hhhh",
      kind: "function",
      location: [location("twin", "src/h.ts", 1, 4)],
      signals: [scored(0.9), scored(0.8)],
    },
    functionBlock("iiii", ["fine", "src/i.ts", 1, 6], [scored(0.1)]),
  ]);
  const result = buildBaseline(forged, { top: 2 });
  assert.deepEqual(
    result.functions.map((f) => [f.unitId, f.p, f.jevRank]),
    [
      ["iiii", 0.1, 1],
      ["hhhh", null, null],
    ],
  );
  assert.equal(result.census.located, 2);
  assert.deepEqual(result.census.gaps, [
    { unitId: "ffff", reason: "no single focus location" },
    {
      unitId: "gggg",
      reason: "focus location without a usable path or line range",
    },
    { unitId: "hhhh", reason: "more than one function_should_split cell" },
  ]);
  assert.ok(!JSON.stringify(result).includes("NaN"));
});

test("reports that hold nothing to rank are refused with a clear message", () => {
  assert.throws(
    () => buildBaseline({ blocks: 3 }),
    /no blocks array; it is not a jev-scanr report/,
  );
  assert.throws(
    () =>
      buildBaseline(
        report([
          { unitId: "eeee", kind: "clone_pair", location: [], signals: [] },
        ]),
      ),
    /holds no function blocks/,
  );
  assert.throws(
    () => buildBaseline(report([{ kind: "function" }])),
    /malformed: it needs a string unitId and kind/,
  );
  assert.throws(
    () =>
      buildBaseline(
        report([
          { unitId: "aaaa", kind: "function", location: [], signals: [] },
        ]),
      ),
    /No function block of the report has a single focus location/,
  );
  assert.throws(() => buildBaseline(fixture(), { top: 0 }), /positive integer/);
  assert.throws(
    () => buildBaseline(fixture(), { top: 1.5 }),
    /positive integer/,
  );
});

async function run(t, args) {
  quiet(t);
  await main(["baseline", ...args]);
}

test("the command writes both files, stamps the input's sha256 and refuses to overwrite", async (t) => {
  const dir = scratch(t);
  const reportPath = join(dir, "report.json");
  writeFileSync(reportPath, JSON.stringify(fixture()));
  const first = join(dir, "out1");
  await run(t, ["--report", reportPath, "--top", "3", "--out", first]);
  const json = JSON.parse(readFileSync(join(first, "baseline.json")));
  assert.equal(json.overlap.count, 2);
  assert.equal(json.census.scored, 3);
  assert.equal(
    json.inputs.reportSha256,
    createHash("sha256").update(readFileSync(reportPath)).digest("hex"),
  );
  const markdown = readFileSync(join(first, "baseline.md")).toString();
  assert.match(markdown, /Top-3 overlap: 2 of 3/);
  assert.match(markdown, /Only in length: `gamma` src\/short\.ts:1\u201310/);
  assert.match(markdown, /Only in Jev: `delta` src\/tiny\.ts:1\u20138/);
  assert.match(markdown, /cccc… function_should_split not scored/);
  const second = join(dir, "out2");
  await run(t, ["--report", reportPath, "--top", "3", "--out", second]);
  assert.equal(
    readFileSync(join(second, "baseline.json")).toString(),
    readFileSync(join(first, "baseline.json")).toString(),
  );
  assert.equal(
    readFileSync(join(second, "baseline.md")).toString(),
    readFileSync(join(first, "baseline.md")).toString(),
  );
  await assert.rejects(
    run(t, ["--report", reportPath, "--top", "3", "--out", first]),
    /exists; choose a new --out. Nothing was overwritten/,
  );
});

test("bad input and bad options fail with the reason, and nothing is written", async (t) => {
  const dir = scratch(t);
  const reportPath = join(dir, "report.json");
  writeFileSync(reportPath, "{not json");
  await assert.rejects(
    run(t, ["--report", reportPath, "--out", join(dir, "a")]),
    /is not valid JSON/,
  );
  assert.ok(!existsSync(join(dir, "a")));
  writeFileSync(reportPath, JSON.stringify({ noBlocksHere: true }));
  await assert.rejects(
    run(t, ["--report", reportPath, "--out", join(dir, "b")]),
    /no blocks array/,
  );
  await assert.rejects(
    run(t, ["--report", join(dir, "missing.json"), "--out", join(dir, "c")]),
    /No such report file/,
  );
  await assert.rejects(
    run(t, ["--report", dir, "--out", join(dir, "c2")]),
    /Could not read/,
  );
  await assert.rejects(
    run(t, ["--out", join(dir, "d")]),
    /--report and --out required/,
  );
  await assert.rejects(
    run(t, ["--report", reportPath, "--top", "0", "--out", join(dir, "e")]),
    /--top must be a positive integer/,
  );
  await assert.rejects(
    run(t, ["--report", reportPath, "--top", "1.5", "--out", join(dir, "e2")]),
    /--top must be a positive integer/,
  );
});

test("fields the comparison does not use never reach the output", async (t) => {
  const dir = scratch(t);
  const reportPath = join(dir, "report.json");
  const forged = fixture();
  forged.secretNote = "TYPESAFE_API_KEY=sk-live-secret-value";
  forged.blocks[0].source = "const hidden = 'private source text';";
  forged.blocks[4].requestBody = "send me the whole file";
  writeFileSync(reportPath, JSON.stringify(forged));
  const out = join(dir, "out");
  await run(t, ["--report", reportPath, "--out", out]);
  for (const name of ["baseline.json", "baseline.md"]) {
    const text = readFileSync(join(out, name)).toString();
    if (name === "baseline.json") assert.ok(text.includes("aaaa"), name);
    else assert.ok(text.includes("`alpha`"), name);
    assert.ok(!text.includes("secret"), `${name} leaks the secret field`);
    assert.ok(!text.includes("hidden"), `${name} leaks source text`);
    assert.ok(!text.includes("requestBody"), `${name} leaks request bodies`);
  }
});

test("the recorded demo report runs without a key, byte-identically across processes", (t) => {
  const dir = scratch(t);
  const out = join(dir, "demo-baseline");
  const args = (target) => [
    "baseline",
    "--report",
    demoReport,
    "--top",
    "5",
    "--out",
    target,
  ];
  const result = spawn(args(out));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /14 of 14 function blocks scored/);
  assert.match(result.stdout, /top-5 overlap 4/);
  assert.doesNotMatch(result.stdout, /TYPESAFE/);
  const rerun = join(dir, "demo-baseline-again");
  assert.equal(spawn(args(rerun)).status, 0);
  for (const name of ["baseline.json", "baseline.md"])
    assert.equal(
      readFileSync(join(rerun, name)).toString(),
      readFileSync(join(out, name)).toString(),
      name,
    );
  const json = JSON.parse(readFileSync(join(out, "baseline.json")));
  assert.equal(json.census.functionBlocks, 14);
  assert.equal(json.census.clonePairBlocks, 1);
  assert.equal(json.census.gaps.length, 0);
  assert.equal(json.overlap.count, 4);
  const markdown = readFileSync(join(out, "baseline.md")).toString();
  assert.match(markdown, /Only in length: `clampPercent`/);
  assert.match(markdown, /Only in Jev: `describeTotal`/);
  assert.match(markdown, /It does not measure the quality of either ranking/);
  assert.ok(HELP.includes("jevs baseline --report FILE [--top N] --out DIR"));
});
