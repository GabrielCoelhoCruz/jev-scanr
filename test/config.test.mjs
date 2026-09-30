import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/build-plan.mjs";
import { verifyPlan } from "../src/plan.mjs";
import { project } from "./helpers.mjs";

const files = {
  "tsconfig.json": JSON.stringify({
    extends: "pkg/tsconfig.base",
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  }),
  "src/util.ts": "export function helper(n: number) {\n  return n * 2;\n}\n",
  "src/main.ts":
    'import { helper } from "@/util";\nexport function run(n: number) {\n  const a = helper(n);\n  return a + 1;\n}\n',
};
const artifact = {
  specifier: "pkg/tsconfig.base",
  package: "pkg",
  version: "1.2.3",
  integrity: "sha512-" + "A".repeat(86) + "==",
  provenance: "test fixture",
  verifiedByCaller: true,
  entry: "tsconfig.base.json",
  files: { "tsconfig.base.json": '{"compilerOptions":{"strict":true}}' },
};
const run = (plan) => plan.units.find((u) => u.members[0].name === "run");

test("a tsconfig that extends a package is unresolved unless offline config data is supplied", (t) => {
  const root = project(t, files);
  const without = buildPlan(root);
  assert.equal(run(without).dependencies.length, 0);
  assert.ok(
    run(without).omitted.some(
      (o) => o.reason === "alias_base_or_config_graph_unresolved",
    ),
  );
  const withData = buildPlan(root, { externalConfigs: [artifact] });
  assert.ok(run(withData).dependencies.length >= 1);
  assert.equal(verifyPlan(withData).planHash, withData.planHash);
  assert.ok(
    withData.configFacts.aliases.some(
      (a) => a.package === "pkg" && a.version === "1.2.3",
    ),
    "the package config is recorded with its identity",
  );
});

test("offline config data must be attested, well formed and free of secrets", (t) => {
  const root = project(t, files);
  for (const bad of [
    { ...artifact, verifiedByCaller: false },
    { ...artifact, integrity: "md5-abc" },
    { ...artifact, entry: "../x.json" },
    { ...artifact, specifier: "other/tsconfig" },
    {
      ...artifact,
      files: { "tsconfig.base.json": 'password = "abcdefghijklmnop123"' },
    },
  ])
    assert.throws(
      () => buildPlan(root, { externalConfigs: [bad] }),
      undefined,
      JSON.stringify(bad).slice(0, 60),
    );
  assert.throws(() => buildPlan(root, { externalConfigs: "x" }));
});
