import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  assert.equal(pkg.name, "jev-scanr");
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["jev-scanr", "jevs"]);
  assert.equal(pkg.bin["jevs"], pkg.bin["jev-scanr"]);
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
  const skill = read("skills/jev-scanr/SKILL.md");
  const front = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front);
  assert.equal(front[1], "jev-scanr");
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

test("no document runs an npm package named jr, jevs or jev-scanr through npx", () => {
  for (const file of walk(root)) {
    if (
      !/\.(md|mjs|json|yml|txt)$/.test(file) ||
      file.endsWith("package-lock.json") ||
      file.endsWith("docs.test.mjs")
    )
      continue;
    const text = readFileSync(file, "utf8");
    for (const [, line] of text.matchAll(
      /^(.*\bnpx\s+(?:--yes\s+|-y\s+)?(?:jr|jevs|jev-scanr|jev-refactor)\b.*)$/gm,
    ))
      assert.ok(
        /\b(never|do not|test fails)\b/i.test(line),
        `${relative(root, file)}: ${line.trim()}`,
      );
  }
  const readme = read("README.md");
  assert.match(readme, /do not run `npx jev-scanr` or `npx jevs`/i);
  assert.match(readme, /never run `npx jr`/i);
  assert.match(readme, /npx github:GabrielCoelhoCruz\/jev-scanr/);
  const skill = read("skills/jev-scanr/SKILL.md");
  assert.match(skill, /never run `npx jev-scanr` or `npx jevs`/);
  assert.match(skill, /never run `npx jr`/);
});

test("the old names survive only as history", () => {
  for (const file of walk(root)) {
    if (
      !/\.(md|json|yml)$/.test(file) ||
      file.endsWith("package-lock.json") ||
      file.endsWith("docs.test.mjs") ||
      file.endsWith("CHANGELOG.md")
    )
      continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (/\bjev-refactor\b/.test(line))
        assert.ok(
          /renamed from|was called|then named|before 0\.3\.0|legacy|old|in 0\.2\.0-alpha/i.test(
            line,
          ),
          `${relative(root, file)}: ${line.trim()}`,
        );
      if (/\bjr\b/.test(line))
        assert.ok(
          /never|alias|unrelated/i.test(line),
          `${relative(root, file)}: ${line.trim()}`,
        );
    }
  }
});

test("the README reports the oh-my-pi pull request as open, not merged", () => {
  const readme = read("README.md");
  assert.ok(!/TODO/.test(readme));
  assert.match(readme, /oh-my-pi#13847/);
  assert.match(readme, /open and not merged/);
  assert.match(
    read("evals/results/showcase-t3code-oh-my-pi-2026-09-30.md"),
    /13847[^\n]*not merged|not merged[^\n]*13847/,
  );
});

test("public documents carry no internal wording", () => {
  const banned =
    /coordinator|evaluation-harness product|handoff pack|narrator control|private files|authorizedOpus|TODO\(/i;
  for (const file of walk(root)) {
    if (
      !/\.(md|mjs|json|yml|txt)$/.test(file) ||
      file.endsWith("package-lock.json") ||
      file.endsWith("docs.test.mjs")
    )
      continue;
    const text = readFileSync(file, "utf8");
    assert.ok(
      !banned.test(text),
      `${relative(root, file)} has internal wording`,
    );
    assert.ok(
      !relative(root, file).startsWith("test/") ||
        !/\b(n\u00e3o|revisor|humano)\b/i.test(text),
      `${relative(root, file)} has a stray non-English fixture`,
    );
  }
});

test("the README leads with the benefit, lists each signal as the catalog does, and credits jevgrep only as related work", () => {
  const readme = read("README.md");
  assert.match(
    readme.split("\n").find((l) => l.startsWith("**")),
    /^\*\*Find the functions in your TypeScript\/JavaScript project most worth refactoring/,
  );
  assert.match(readme, /^## When to use something else$/m);
  assert.match(readme, /^## Related$/m);
  assert.match(
    readme,
    /The `auth` and `skill` commands here were inspired by it/,
  );
  assert.ok(!/^## (Start with a|Source, credentials)/m.test(readme));
  assert.ok(!/jevgrep/i.test(read("NOTICE.md")));
  const rows = [
    ...readme.matchAll(
      /^\| `([a-z_]+)`\s+\|[^|]*\|\s*(default|experimental)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/gm,
    ),
  ];
  assert.equal(rows.length, 8);
  for (const [, id, status, independent, dev] of rows) {
    const s = JSON.parse(read(`signals/${id}.json`));
    assert.equal(status, s.status, id);
    const t = s.independentTest;
    assert.equal(
      independent,
      t.reviewedAboveCut
        ? `${t.actionableAboveCut}/${t.reviewedAboveCut}`
        : "no items",
      id,
    );
    const e = s.evidence[0];
    assert.equal(dev, `${e.actionableAboveCut}/${e.reviewedAboveCut}`, id);
  }
});

test("the npm package ships the tool and its notices, not the evaluation tools or development scripts", () => {
  const out = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: root, encoding: "utf8" },
  );
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  for (const must of [
    "src/cli.mjs",
    "src/credentials.mjs",
    "catalog.json",
    "skills/jev-scanr/SKILL.md",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "examples/demo-app/src/billing.ts",
  ])
    assert.ok(files.includes(must), must);
  for (const f of files)
    assert.ok(
      !/^(evals|scripts|test)\//.test(f) &&
        !f.startsWith("examples/demo-app/expected/"),
      `${f} should not be in the package`,
    );
});
