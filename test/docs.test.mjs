import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNER_VERSION } from "../src/plan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (
      ["node_modules", ".git", "licenses", "vendor", "__pycache__"].includes(
        name,
      )
    )
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("package name, bins and versions agree", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "jev-refactor");
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["jev-refactor", "jr"]);
  assert.equal(pkg.bin["jr"], pkg.bin["jev-refactor"]);
  assert.equal(pkg.version, SCANNER_VERSION);
  assert.ok(pkg.files.includes("skills"));
  assert.equal(JSON.parse(read("package-lock.json")).version, pkg.version);
  assert.match(
    read("CHANGELOG.md"),
    new RegExp(`^## ${pkg.version.replaceAll(".", "\\.")}$`, "m"),
  );
});

test("relative links in the documentation resolve to files", () => {
  const docs = [
    "README.md",
    "EVIDENCE.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "NOTICE.md",
    "docs/architecture.md",
    "docs/RELEASING.md",
    ...readdirSync(join(root, "evals/results")).map(
      (f) => `evals/results/${f}`,
    ),
  ];
  for (const doc of docs) {
    const text = read(doc);
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = resolve(root, dirname(doc), target.split("#")[0]);
      assert.ok(existsSync(path), `${doc} links to missing ${target}`);
    }
  }
});

test("the agent skill is named like its folder and says to verify before editing", () => {
  const skill = read("skills/jev-refactor/SKILL.md");
  const front = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front);
  assert.equal(front[1], "jev-refactor");
  assert.ok(front[2].length > 80);
  assert.match(skill, /Verify each item before editing/);
  assert.match(skill, /hypothes/i);
  assert.match(skill, /Never ask for the key in chat/);
});

test("the publish workflow cannot run until publishing is enabled", () => {
  const wf = read(".github/workflows/publish.yml");
  assert.match(wf, /if: \$\{\{ vars\.NPM_PUBLISH_ENABLED == 'true' \}\}/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.match(read("docs/RELEASING.md"), /not been published to npm/);
});

test("no internal ticket ids or machine paths are in tracked text", () => {
  for (const file of walk(root)) {
    if (
      !/\.(md|mjs|json|jsonl|yml|py|ts|tsx|txt)$/.test(file) ||
      file.endsWith("package-lock.json") ||
      file.endsWith("docs.test.mjs")
    )
      continue;
    const text = readFileSync(file, "utf8");
    assert.ok(
      !/\bHOME-\d+\b/.test(text),
      `${relative(root, file)} mentions an internal ticket id`,
    );
    assert.ok(
      !/\/home\/user\b|machine_01[A-Z0-9]{10}/.test(text),
      `${relative(root, file)} mentions a machine path or id`,
    );
  }
});
