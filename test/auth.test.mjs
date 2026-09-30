import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { main, parseArgs, SKILL_SOURCE } from "../src/cli.mjs";
import {
  credentialsPath,
  removeApiKey,
  resolveApiKey,
  saveApiKey,
} from "../src/credentials.mjs";
import { scratch } from "./helpers.mjs";

const envFor = (t, extra = {}) => ({ XDG_CONFIG_HOME: scratch(t), ...extra });
const quiet = async (fn) => {
  const log = console.log;
  const lines = [];
  console.log = (l) => lines.push(l);
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return lines.join("\n");
};

test("jr auth saves the key in an owner-only file and never prints it", async (t) => {
  const env = envFor(t);
  const out = await quiet(() =>
    main(["auth"], { env, readSecret: async () => "tsk_secretvalue123" }),
  );
  const file = credentialsPath(env);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(file)).mode & 0o077, 0);
  assert.equal(JSON.parse(readFileSync(file)).apiKey, "tsk_secretvalue123");
  assert.ok(!out.includes("tsk_secretvalue123"));
  assert.equal(resolveApiKey(env), "tsk_secretvalue123");
});

test("the environment overrides the saved key, and no key is null", (t) => {
  const env = envFor(t);
  assert.equal(resolveApiKey(env), null);
  saveApiKey("saved-key-123", env);
  assert.equal(resolveApiKey(env), "saved-key-123");
  assert.equal(
    resolveApiKey({ ...env, TYPESAFE_API_KEY: "env-key-123" }),
    "env-key-123",
  );
});

test("a saved key readable by other users is refused", (t) => {
  const env = envFor(t);
  saveApiKey("saved-key-123", env);
  chmodSync(credentialsPath(env), 0o644);
  assert.throws(() => resolveApiKey(env), /readable by other users/);
});

test("jr auth refuses a key passed as an argument, and a malformed key", async (t) => {
  const env = envFor(t);
  await assert.rejects(
    main(["auth", "tsk_abcdefgh"], { env }),
    /Never pass the key/,
  );
  await assert.rejects(
    main(["auth"], { env, readSecret: async () => "has spaces in it" }),
    /does not look like an API key/,
  );
  assert.ok(!existsSync(credentialsPath(env)));
});

test("jr auth --remove deletes the saved key", async (t) => {
  const env = envFor(t);
  saveApiKey("saved-key-123", env);
  const out = await quiet(() => main(["auth", "--remove"], { env }));
  assert.match(out, /Removed/);
  assert.equal(removeApiKey(env).existed, false);
});

test("jr skill installs this repository's skill through npx skills", async () => {
  let args;
  await main(["skill", "--global", "--yes"], { skillArgs: (a) => (args = a) });
  assert.deepEqual(args, [
    "--yes",
    "skills",
    "add",
    SKILL_SOURCE,
    "--skill",
    "jev-refactor",
    "--global",
    "--yes",
  ]);
  assert.equal(parseArgs(["skill"]).command, "skill");
});

test("a live scan without any key says how to get one", async (t) => {
  const env = envFor(t, { TYPESAFE_API_KEY: "" });
  await assert.rejects(
    main(
      [
        "scan",
        "examples/demo-app",
        "--run",
        "--yes",
        "--cap-usd",
        "0.05",
        "--out",
        scratch(t) + "/out",
      ],
      { env },
    ),
    /jr auth/,
  );
});
