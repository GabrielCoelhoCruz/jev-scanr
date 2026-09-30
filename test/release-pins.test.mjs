import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION, skillSource } from "../src/cli.mjs";
import { SCANNER_VERSION } from "../src/plan.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pins = (text) =>
  [...text.matchAll(/jev-scanr(?:#|\/tree\/)(v\d[^\s/)]*)/g)].map((m) => m[1]);

test("every install and skill pin names the current version", () => {
  assert.equal(VERSION, SCANNER_VERSION);
  assert.equal(
    skillSource(),
    `https://github.com/GabrielCoelhoCruz/jev-scanr/tree/v${VERSION}/skills/jev-scanr`,
  );
  for (const file of ["README.md", "skills/jev-scanr/SKILL.md"]) {
    const found = pins(read(file));
    assert.ok(found.length > 0, `${file} has no pinned install`);
    assert.deepEqual([...new Set(found)], [`v${VERSION}`], file);
  }
});

test("the recorded demo keeps naming the scanner that made it", () => {
  const receipt = JSON.parse(read("examples/demo-app/expected/RECEIPT.json"));
  assert.equal(receipt.scanner.version, "0.3.1-alpha");
  assert.match(
    read("examples/demo-app/expected/RECORDED-RUN.md"),
    /`jev-scanr` 0\.3\.1-alpha/,
  );
});
