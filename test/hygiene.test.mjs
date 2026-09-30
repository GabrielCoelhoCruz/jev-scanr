import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../src/", import.meta.url);

test("no source file names a specific user's private path", () => {
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), "utf8");
    assert.ok(!/\/home\/|C:\\\\Users/.test(text), file);
  }
});

test("the API key never comes from a command-line option", () => {
  const cli = readFileSync(new URL("cli.mjs", dir), "utf8");
  assert.ok(!/api-key|apiKey\s*:\s*values/i.test(cli));
  assert.ok(!/process\.env\.TYPESAFE_API_KEY/.test(cli));
  const credentials = readFileSync(new URL("credentials.mjs", dir), "utf8");
  assert.equal(credentials.match(/env\.TYPESAFE_API_KEY/g).length, 2);
});
