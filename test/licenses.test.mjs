import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("every package in the lockfile has a retained license notice", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const index = JSON.parse(read("licenses/index.json"));
  const key = (name, version) => `${name}@${version}`;
  const covered = new Set(index.map((e) => key(e.package, e.version)));
  const missing = Object.entries(lock.packages)
    .filter(([path]) => path !== "")
    .map(([path, meta]) => [
      path.split("node_modules/").slice(1).join("node_modules/"),
      meta.version,
    ])
    .filter(([name, version]) => !covered.has(key(name, version)));
  assert.deepEqual(missing, [], "add the license text and an index entry");
  for (const e of index) {
    assert.ok(existsSync(new URL(`licenses/${e.file}`, root)), e.file);
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(`licenses/${e.file}`, root)))
        .digest("hex"),
      e.sha256,
      e.file,
    );
  }
  assert.ok(existsSync(new URL("licenses/jev-readonly-pilot-MIT.txt", root)));
});

test("the package is MIT and names the contributors collectively", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.license, "MIT");
  assert.match(
    read("LICENSE"),
    /^MIT License\n\nCopyright \(c\) 2026 the semantic-refactor-scan contributors/,
  );
});
