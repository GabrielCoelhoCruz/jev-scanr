import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { hash } from "../src/core.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { verifyPlan, packSignals } from "../src/plan.mjs";
import { catalog } from "../src/catalog.mjs";
import { project, plan, clone, twoFiles, reseal, SEVEN } from "./helpers.mjs";

test("units are functions and similar pairs only, formed without scoring or filtering", (t) => {
  const p = plan(t, {
    ...twoFiles,
    "c.ts":
      "export function outer(){ const inner = () => 1; return inner(); }\nexport function rethrows(){ try { return work() } catch (e) { throw e } }\n// a module comment\nexport const x = 1;\n",
    "tests/a.test.ts": "export function testHelper(){ return 1 }",
  });
  const kinds = p.units.reduce(
    (m, u) => ((m[u.kind] = (m[u.kind] ?? 0) + 1), m),
    {},
  );
  assert.deepEqual(Object.keys(kinds).sort(), ["clone_pair", "function"]);
  assert.equal(kinds.clone_pair, 3);
  assert.deepEqual(
    p.units
      .filter((u) => u.kind === "function")
      .map((u) => u.members[0].name)
      .sort(),
    ["alpha", "beta", "gamma", "outer", "rethrows"],
    "only outermost non-test functions",
  );
  assert.deepEqual(p.enabledSignals, SEVEN);
  for (const r of p.requests)
    for (const id of Object.keys(r.request.questions))
      assert.ok(SEVEN.includes(id));
  assert.ok(
    p.units.every((u) => u.sections.every((s) => typeof s.source === "string")),
  );
  assert.equal(p.estimates.requests, p.requests.length);
  verifyPlan(p);
});

test("planning is deterministic, offline and writes nothing", (t) => {
  const root = project(t, twoFiles);
  const before = readdirSync(root).sort();
  assert.equal(buildPlan(root).planHash, buildPlan(root).planHash);
  assert.deepEqual(readdirSync(root).sort(), before);
});

test("only the pair signal is asked of pairs and only function signals of functions", (t) => {
  const p = plan(t);
  for (const r of p.requests) {
    const ids = Object.keys(r.request.questions);
    if (r.request.state.kind === "clone_pair")
      assert.deepEqual(ids, ["clone_same_policy"]);
    else assert.ok(!ids.includes("clone_same_policy"));
  }
});

test("experimental and explicit signal selections change what is asked and are bound into the plan", (t) => {
  const root = project(t, twoFiles);
  const experimental = buildPlan(root, {
    signals: [...SEVEN, "unreachable_code"],
  });
  assert.ok(experimental.enabledSignals.includes("unreachable_code"));
  assert.ok(
    experimental.requests.some(
      (r) => "unreachable_code" in r.request.questions,
    ),
  );
  const only = buildPlan(root, { signals: ["deep_nesting"] });
  assert.equal(only.units.filter((u) => u.kind === "clone_pair").length, 0);
  assert.deepEqual(
    [
      ...new Set(
        only.requests.flatMap((r) => Object.keys(r.request.questions)),
      ),
    ],
    ["deep_nesting"],
  );
  const forged = structuredClone(only);
  forged.enabledSignals = ["deep_nesting", "function_should_split"];
  const { planHash: _h, ...body } = forged;
  forged.planHash = hash(body);
  assert.throws(() => verifyPlan(forged));
  assert.equal(verifyPlan(only).planHash, only.planHash);
  assert.deepEqual(
    catalog.signals.map((s) => s.id),
    ["deep_nesting"],
    "verifyPlan selects the plan's signals",
  );
  buildPlan(root);
});

test("exclusions, dot-directories, dependencies, generated code and secrets are never read or sent", (t) => {
  const secret = "sk-" + "a1b2c3d4e5f6a7b8c9d0e1f2";
  const p = plan(
    t,
    {
      ...twoFiles,
      "private/notes.ts": clone("privateOne") + "// PRIVATE_MARKER\n",
      "src/keys.ts": `export const token = "${secret}";\n` + clone("leaky"),
      "src/credentials.ts": clone("named"),
      ".hidden/secret.ts": clone("dot"),
      "node_modules/pkg/index.ts": clone("dep"),
      "dist/out.ts": clone("built"),
      "src/gen.ts": "// @generated\n" + clone("gen"),
      "src/data.min.ts": clone("min"),
    },
    { excluded: ["private"] },
  );
  const sent = JSON.stringify(p.requests) + JSON.stringify(p.units);
  for (const marker of ["PRIVATE_MARKER", secret])
    assert.ok(!sent.includes(marker), marker);
  const names = p.units.flatMap((u) => u.members.map((m) => m.name));
  for (const n of [
    "privateOne",
    "leaky",
    "named",
    "dot",
    "dep",
    "built",
    "gen",
    "min",
  ])
    assert.ok(!names.includes(n), n);
  const status = (path) => p.files.find((f) => f.path === path)?.status;
  assert.equal(status("private"), "excluded_path");
  assert.equal(status("src/keys.ts"), "potential_secret_no_content_stored");
  assert.equal(status("src/gen.ts"), "generated");
  assert.equal(status("node_modules"), "excluded_path");
  assert.throws(() => buildPlan(project(t, twoFiles), { excluded: ["../x"] }));
});

test("symlinks are not followed out of the project", (t) => {
  const outside = project(t, { "outside.ts": clone("outsider") });
  const root = project(t, twoFiles);
  symlinkSync(join(outside, "outside.ts"), join(root, "link.ts"));
  symlinkSync(outside, join(root, "linked"));
  const p = buildPlan(root);
  assert.ok(!JSON.stringify(p).includes("outsider"));
  assert.equal(p.files.find((f) => f.path === "link.ts").status, "symlink");
});

test("verifyPlan rejects edited sources, forged hashes and unknown kinds", (t) => {
  const p = plan(t);
  const edit = (fn) => {
    const c = structuredClone(p);
    fn(c);
    return c;
  };
  assert.throws(() =>
    verifyPlan(edit((c) => (c.units[0].sections[0].source += "//"))),
  );
  assert.throws(() =>
    verifyPlan(edit((c) => (c.requests[0].requestHash = "0"))),
  );
  assert.throws(() => verifyPlan(edit((c) => (c.catalogHash = "0"))));
  assert.throws(() =>
    verifyPlan(reseal(edit((c) => (c.units[0].kind = "catch")))),
  );
  assert.throws(() =>
    verifyPlan(
      reseal(edit((c) => (c.units[0].sections[0].source = "// changed\n"))),
    ),
  );
  assert.throws(() =>
    verifyPlan(reseal(edit((c) => (c.units[0].signalSubset = ["nope"])))),
  );
  assert.throws(() => verifyPlan(reseal(edit((c) => c.unitManifest.pop()))));
});

test("packSignals follows the pack kind and any question-group subset", (t) => {
  const p = plan(t);
  const pair = p.units.find((u) => u.kind === "clone_pair");
  assert.deepEqual(
    packSignals(pair).map((s) => s.id),
    ["clone_same_policy"],
  );
  assert.deepEqual(
    packSignals({ kind: "function", signalSubset: ["deep_nesting"] }).map(
      (s) => s.id,
    ),
    ["deep_nesting"],
  );
});

test("a project without TypeScript or JavaScript sources yields an empty plan, not an error", (t) => {
  const p = buildPlan(project(t, { "README.md": "text" }));
  assert.equal(p.requests.length, 0);
  assert.equal(p.estimates.serializedRequestBytes, 0);
  verifyPlan(p);
});
