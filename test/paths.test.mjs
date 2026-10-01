import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPlan } from "../src/build-plan.mjs";
import { verifyPlan, COMPATIBLE_PLAN_VERSIONS } from "../src/plan.mjs";
import { buildReport, reportMarkdown } from "../src/report.mjs";
import {
  coverageLines,
  unreadByDirectory,
  unindexedByDirectory,
} from "../src/cli.mjs";
import { hash } from "../src/core.mjs";
import { project, scratch, clone, reseal } from "./helpers.mjs";

const files = {
  "tsconfig.json": "{}",
  "a/one.ts": clone("aOne"),
  "a/deep/two.ts": clone("aTwo", "20"),
  "b/three.ts": clone("bThree", "30"),
  "root.ts": clone("rootFn", "40"),
};
const cli = new URL("../src/cli.mjs", import.meta.url).pathname;

test("--paths limits units and context to the chosen directories and counts the rest", (t) => {
  const root = project(t, files);
  const all = buildPlan(root);
  const scoped = buildPlan(root, { paths: ["a"] });
  assert.deepEqual(scoped.scope.paths, ["a"]);
  const names = scoped.units.flatMap((u) => u.members.map((m) => m.name));
  assert.ok(names.includes("aOne") && names.includes("aTwo"));
  assert.ok(!names.includes("bThree") && !names.includes("rootFn"));
  const status = (p) => scoped.files.find((f) => f.path === p).status;
  assert.equal(status("b/three.ts"), "outside_paths");
  assert.equal(status("root.ts"), "outside_paths");
  assert.equal(status("a/one.ts"), "read");
  assert.equal(
    status("tsconfig.json"),
    "read",
    "config files are read wherever they are",
  );
  assert.deepEqual(scoped.coverage.sourceFiles, {
    inProject: 4,
    inScope: 2,
    read: 2,
    unreadByFileOrByteCap: 0,
  });
  assert.equal(all.coverage.sourceFiles.inScope, 4);
  assert.notEqual(scoped.planHash, all.planHash);
  assert.equal(verifyPlan(scoped).planHash, scoped.planHash);
  assert.deepEqual(buildPlan(root, { paths: ["a/deep", "a"] }).scope.paths, [
    "a",
    "a/deep",
  ]);
  assert.deepEqual(
    buildPlan(root, { paths: ["root.ts"] })
      .units.map((u) => u.members[0].name)
      .filter((n) => n === "rootFn"),
    ["rootFn"],
  );
});

test("--paths rejects missing, unsafe and symlinked paths and a forged scope", (t) => {
  const root = project(t, files);
  assert.throws(() => buildPlan(root, { paths: ["nope"] }), /does not exist/);
  assert.throws(() => buildPlan(root, { paths: ["../x"] }), /Unsafe scan path/);
  assert.throws(() => buildPlan(root, { paths: ["/etc"] }), /Unsafe scan path/);
  symlinkSync(join(root, "a"), join(root, "link"));
  assert.throws(() => buildPlan(root, { paths: ["link"] }), /symlink/);
  const p = buildPlan(root, { paths: ["a"] });
  const forged = structuredClone(p);
  forged.scope.paths = ["../a"];
  const { planHash: _h, ...body } = forged;
  forged.planHash = hash(body);
  assert.throws(() => verifyPlan(forged), /scope/);
});

test("a plan from the alpha release, without scope or the hard cap, still verifies", (t) => {
  const p = buildPlan(project(t, files));
  const old = structuredClone(p);
  delete old.scope;
  delete old.limits.maxHardRequestBytes;
  old.scannerVersion = "0.1.0-alpha";
  for (const u of old.units) u.budget.hardByteCap = old.limits.maxRequestBytes;
  reseal(old);
  assert.equal(verifyPlan(old).planHash, old.planHash);
  assert.deepEqual(COMPATIBLE_PLAN_VERSIONS, [
    "0.1.0-alpha",
    "0.1.1",
    "0.2.0-alpha",
    "0.3.0-alpha",
    "0.3.1-alpha",
    "0.4.0-alpha",
  ]);
  const wrong = structuredClone(p);
  delete wrong.limits.maxHardRequestBytes;
  assert.throws(() => verifyPlan(reseal(wrong)), /limit schema/);
});

function bigProject(t) {
  const root = project(t);
  for (let d = 0; d < 3; d++) {
    mkdirSync(join(root, `pkg${d}`), { recursive: true });
    for (let i = 0; i < 200; i++)
      writeFileSync(
        join(root, `pkg${d}`, `m${i}.ts`),
        `export const v${d}_${i} = ${i};\n`,
      );
  }
  return root;
}

test("the dry run states coverage next to the cost and names what the file cap skipped", (t) => {
  const root = bigProject(t);
  const out = spawnSync(process.execPath, [cli, "scan", root], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  }).stdout;
  assert.match(out, /Coverage: read 500 of 600 source files \(83%\)\./);
  assert.match(
    out,
    /NOT READ because of the 500-file \/ size cap \(files are taken in path order\): 100 source files, in pkg2 \(100\)/,
  );
  assert.match(out, /Narrow with --paths/);
  const scoped = spawnSync(
    process.execPath,
    [cli, "scan", root, "--paths", "pkg0,pkg1"],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  ).stdout;
  assert.match(
    scoped,
    /Scope: --paths pkg0,pkg1 covers 400 of 600 source files in the project\./,
  );
  assert.match(
    scoped,
    /Coverage: read 400 of 400 source files in scope \(100%\)\./,
  );
  assert.doesNotMatch(scoped, /NOT READ/);
  const bad = spawnSync(
    process.execPath,
    [cli, "scan", root, "--paths", "missing"],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /does not exist/);
});

test("skipped files are grouped by directory, deeper when a path is given", (t) => {
  const root = bigProject(t);
  const p = buildPlan(root);
  assert.deepEqual(unreadByDirectory(p), [["pkg2", 100]]);
  const lines = coverageLines(p.coverage.sourceFiles, [], unreadByDirectory(p));
  assert.equal(lines.length, 2);
  assert.deepEqual(coverageLines(null, [], []), []);
  const nested = project(t);
  for (const d of ["x/a", "x/b"]) {
    mkdirSync(join(nested, d), { recursive: true });
    for (let i = 0; i < 300; i++)
      writeFileSync(
        join(nested, d, `m${i}.ts`),
        `export const v${i} = ${i};\n`,
      );
  }
  const scoped = buildPlan(nested, { paths: ["x"] });
  assert.deepEqual(unreadByDirectory(scoped), [["x/b", 100]]);
});

test("reports carry the coverage so a partial scan cannot look complete", (t) => {
  const p = buildPlan(bigProject(t));
  const report = buildReport(p, []);
  assert.deepEqual(report.coverage.sourceFiles, p.coverage.sourceFiles);
  assert.match(
    reportMarkdown(report),
    /Coverage: read 500 of 600 source files \(83%\)\. 100 source files were not read because of the file cap\./,
  );
  const scoped = buildReport(buildPlan(bigProject(t), { paths: ["pkg0"] }), []);
  assert.match(
    reportMarkdown(scoped),
    /in scope \(--paths pkg0; 600 in the project\) \(100%\)/,
  );
  void scratch;
  void readFileSync;
});

test("a scan cut by the entry limit marks what it did not visit and never shows a closed percentage", (t) => {
  const root = project(t, {
    "a/one.ts": clone("aOne"),
    "a/three.ts": clone("aThree", "30"),
    "a/two.ts": clone("aTwo", "20"),
    "b/four.ts": clone("bFour", "40"),
    "tsconfig.json": "{}",
    "z.ts": clone("zFn", "50"),
  });
  const p = buildPlan(root, { limits: { maxEntries: 3 } });
  assert.equal(p.coverage.traversalComplete, false);
  assert.equal(p.coverage.entriesVisited, 3);
  assert.deepEqual(
    p.files.filter((f) => f.status === "entry_limit"),
    [
      { path: "a", status: "entry_limit", unvisitedEntries: 1 },
      { path: ".", status: "entry_limit", unvisitedEntries: 3 },
    ],
  );
  const report = buildReport(p, []);
  assert.equal(report.coverage.traversalComplete, false);
  assert.equal(report.coverage.unvisitedEntries, 4);
  const md = reportMarkdown(report);
  assert.match(
    md,
    /Coverage: read 2 source files; the total is unknown because the scan stopped at the entry limit, with at least 4 entries not visited\./,
  );
  assert.doesNotMatch(md, /Coverage: read \d+ of|%\)/);
  const lines = coverageLines(p.coverage.sourceFiles, [], [], {
    traversalComplete: p.coverage.traversalComplete,
    unvisitedEntries: report.coverage.unvisitedEntries,
    entryLimit: 3,
  }).join("\n");
  assert.equal(
    lines,
    "Coverage: read 2 source files; the total is unknown because the scan stopped at the 3-entry limit (at least 4 entries were not visited).",
  );

  const old = structuredClone(p);
  old.files = old.files.filter((f) => f.status !== "entry_limit");
  reseal(old);
  const oldReport = buildReport(old, []);
  assert.equal(oldReport.coverage.unvisitedEntries, 0);
  const oldMd = reportMarkdown(oldReport);
  assert.match(
    oldMd,
    /Coverage: read 2 source files; the total is unknown because the scan stopped at the entry limit\./,
  );
  assert.doesNotMatch(oldMd, /100%/);
  assert.equal(
    coverageLines(old.coverage.sourceFiles, [], [], {
      traversalComplete: false,
      unvisitedEntries: 0,
      entryLimit: 3,
    }).join("\n"),
    "Coverage: read 2 source files; the total is unknown because the scan stopped at the 3-entry limit.",
  );
});

const manyFunctions = (t, n) =>
  project(t, {
    "many.ts":
      Array.from(
        { length: n },
        (_, i) => `export const f${i} = () => ${i};`,
      ).join("\n") + "\n",
  });

test("the function index holds 12,000 functions by default, and a lower cap is reported, not silent", (t) => {
  const root = manyFunctions(t, 3200);
  const full = buildPlan(root);
  assert.equal(
    full.coverage.functionsIndexed,
    3200,
    "3,200 functions are no longer cut at 3,000",
  );
  assert.equal(full.coverage.parseAndIndexOmissions.length, 0);
  const capped = buildPlan(root, { limits: { maxFunctions: 100 } });
  assert.equal(capped.coverage.functionsIndexed, 100);
  const lines = coverageLines(capped.coverage.sourceFiles, [], [], {
    unindexed: unindexedByDirectory(capped),
    functionLimit: 100,
    unitsNotPacked: 0,
  });
  assert.match(
    lines.join("\n"),
    /NOT INDEXED because the function index is capped at 100 functions .*: functions in 1 files, in \. \(1\)/,
  );
  const report = buildReport(capped, []);
  assert.equal(report.coverage.filesWithUnindexedFunctions, 1);
  assert.match(
    reportMarkdown(report),
    /Not fully covered: functions in 1 files were not indexed \(function cap\)/,
  );
  verifyPlan(capped);
});

test("units beyond the unit limit are reported as not packed", (t) => {
  const root = manyFunctions(t, 30);
  const p = buildPlan(root, { limits: { maxCandidates: 10 } });
  assert.ok(p.coverage.unitsNotPacked > 0);
  const lines = coverageLines(p.coverage.sourceFiles, [], [], {
    unindexed: unindexedByDirectory(p),
    unitsNotPacked: p.coverage.unitsNotPacked,
    unitLimit: 10,
  });
  assert.match(
    lines.join("\n"),
    /NOT PACKED: \d+ units are beyond the 10-unit limit/,
  );
  assert.match(
    reportMarkdown(buildReport(p, [])),
    /units were not packed \(unit limit\)/,
  );
});
