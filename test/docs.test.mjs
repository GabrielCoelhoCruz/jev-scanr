import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNER_VERSION } from "../src/plan.mjs";
import { HELP } from "../src/cli.mjs";
import {
  allSignals,
  optInSignalIds,
  signalStatusLabel,
} from "../src/catalog.mjs";

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

test("the agent skill is named like its folder, and every jevs flag it or the docs show exists in the CLI", () => {
  const skill = read("skills/jev-scanr/SKILL.md");
  const front = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front);
  assert.equal(front[1], "jev-scanr");
  assert.ok(front[2].length > 80);
  for (const doc of ["skills/jev-scanr/SKILL.md", "README.md", "docs/BANDS.md"])
    for (const line of read(doc)
      .split("\n")
      .filter((l) => /\bjevs /.test(l)))
      for (const [flag] of line.matchAll(/--[a-z][a-z-]*/g))
        assert.ok(
          HELP.includes(flag),
          `${doc} shows ${flag}, which jevs --help does not list`,
        );
});

test("the publish workflow cannot run until publishing is enabled, and the release guide names the switch", () => {
  const wf = read(".github/workflows/publish.yml");
  assert.match(wf, /if: \$\{\{ vars\.NPM_PUBLISH_ENABLED == 'true' \}\}/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.match(read("docs/RELEASING.md"), /NPM_PUBLISH_ENABLED/);
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
  assert.match(read("README.md"), /npx github:GabrielCoelhoCruz\/jev-scanr/);
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

test("every mention of the oh-my-pi pull request says it is not merged, and the README links it", () => {
  const url = "https://github.com/can1357/oh-my-pi/pull/13847";
  assert.ok(read("README.md").includes(url));
  assert.ok(!/TODO/.test(read("README.md")));
  for (const doc of [
    "README.md",
    "EVIDENCE.md",
    "evals/results/showcase-t3code-oh-my-pi-2026-09-30.md",
  ])
    for (const line of read(doc)
      .split("\n")
      .filter((l) => /13847/.test(l)))
      assert.ok(
        !/(?<!not )(?<!un)merged/i.test(line),
        `${doc}: ${line.slice(0, 80)}`,
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

test("the README has its required sections, a lead before them, related work as a link, and a signal table that matches the catalog", () => {
  const readme = read("README.md");
  for (const heading of [
    "Try it without a key",
    "Quickstart",
    "Signals",
    "Bands and re-cutting a run",
    "When to use something else",
    "What we measured",
    "Privacy and cost",
    "Development",
    "Related",
  ])
    assert.match(readme, new RegExp(`^## ${heading}$`, "m"), heading);
  assert.ok(
    readme.indexOf("\n**") < readme.indexOf("\n## "),
    "a bold lead comes before the first section",
  );
  assert.ok(!/^## (Start with a|Source, credentials)/m.test(readme));
  assert.match(
    readme.split("\n## Related\n")[1],
    /\]\(https:\/\/github\.com\/dzhng\/jevgrep\)/,
  );
  assert.ok(!/jevgrep/i.test(read("NOTICE.md")));
  const rows = [
    ...readme.matchAll(
      /^\| `([a-z_]+)`\s+\|[^|]*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/gm,
    ),
  ];
  assert.deepEqual(
    rows.map((r) => r[1]).sort(),
    allSignals
      .map((s) => s.id)
      .filter((id) => !optInSignalIds.includes(id))
      .sort(),
  );
  for (const [, id, status, independent, dev] of rows) {
    const s = JSON.parse(read(`signals/${id}.json`));
    assert.equal(status, signalStatusLabel(s), id);
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
    "examples/demo-app/expected/queue.md",
    "examples/demo-app/expected/RECEIPT.json",
    "examples/demo-app/expected/RESULT.json",
    "examples/demo-app/expected/journal.jsonl",
    "examples/demo-app/expected/plan.json",
  ])
    assert.ok(files.includes(must), must);
  for (const f of files)
    assert.ok(
      !/^(evals|scripts|test)\//.test(f),
      `${f} should not be in the package`,
    );
  assert.deepEqual(
    files.filter((f) => f.startsWith("examples/demo-app/expected/")).sort(),
    [
      "examples/demo-app/expected/RECEIPT.json",
      "examples/demo-app/expected/RESULT.json",
      "examples/demo-app/expected/journal.jsonl",
      "examples/demo-app/expected/plan.json",
      "examples/demo-app/expected/queue.md",
    ],
  );
});

test("the README quotes the recorded run's own figures, offers the no-key demo before the install, and keeps its comparison table's shape", () => {
  const readme = read("README.md");
  const result = JSON.parse(read("examples/demo-app/expected/RESULT.json"));
  const receipt = JSON.parse(read("examples/demo-app/expected/RECEIPT.json"));
  const top = readme.split("\n## How it compares\n")[0];
  for (const figure of [
    receipt.model,
    result.finishedAtUTC.slice(0, 10),
    `${result.requests} requests`,
    result.inputTokens.toLocaleString("en-US"),
    `US$${result.calculatedUSD.toFixed(4)}`,
  ])
    assert.ok(top.includes(figure), `README top lacks ${figure}`);
  assert.ok(
    readme.indexOf("npx github:GabrielCoelhoCruz/jev-scanr demo") <
      readme.indexOf("## Quickstart"),
  );
  assert.ok(
    readme.indexOf("## Try it without a key") < readme.indexOf("## Quickstart"),
  );
  const table = readme
    .split("## How it compares\n")[1]
    .split("\n\n")[0]
    .trim()
    .split("\n")
    .map((row) =>
      row
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  assert.ok(table.every((row) => row.length === 5));
  assert.equal(table[0][0], "");
  assert.equal(table[0][4], "**jev-scanr**");
  const labels = table.slice(2).map((row) => row[0]);
  for (const label of [
    "Cost",
    "Edits code",
    "Measured head to head on the same code",
  ])
    assert.ok(labels.includes(label), label);
  assert.ok(table[2][4].includes(`US$${result.calculatedUSD.toFixed(4)}`));
  assert.ok(
    table[2][4].includes("(examples/demo-app/expected/RECORDED-RUN.md)"),
  );
  const baseline = read("docs/BASELINE.md");
  const measured = table.at(-1)[4];
  const numbers = measured.match(/\b[01]\.\d\d\b/g);
  assert.ok(numbers.length >= 6);
  for (const number of numbers)
    assert.ok(
      baseline.includes(number),
      `${number} is not in docs/BASELINE.md`,
    );
});
