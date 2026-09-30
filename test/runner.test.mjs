import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  linkSync,
} from "node:fs";
import { join } from "node:path";
import { POLICY } from "../src/core.mjs";
import { makeClient, readJournal, reservationUSD } from "../src/runner.mjs";
import { plan, scratch, fake, fakeFetch, response, run } from "./helpers.mjs";

const setup = (t) => {
  const p = plan(t);
  return { p, dir: join(scratch(t), "run") };
};

test("the reservation is persisted before the network call, and a completed replay makes no calls", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const result = await run(
    p,
    dir,
    fake(async (r) => {
      assert.equal(readJournal(dir, p).at(-1).type, "reserved");
      calls++;
      return response(r);
    }),
  );
  assert.equal(result.succeeded, p.requests.length);
  assert.equal(result.complete, true);
  assert.equal(calls, p.requests.length);
  await run(
    p,
    dir,
    fake(async () => {
      throw Error("must not call");
    }),
  );
  assert.equal(calls, p.requests.length);
});

test("a crash after the reservation and before transport blocks a blind retry", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const client = fake(async (r) => {
    calls++;
    return response(r);
  });
  await assert.rejects(
    run(p, dir, client, {
      afterReserve: () => {
        throw Error("synthetic crash");
      },
    }),
  );
  await assert.rejects(run(p, dir, client));
  assert.equal(calls, 0);
  assert.equal(
    readJournal(dir, p).filter((e) => e.type === "reserved").length,
    1,
  );
});

test("the SDK gets the fixed endpoint and no retries; answers are stored without extra fields", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const client = makeClient({
    fetch: async (url, options) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      calls++;
      const request = JSON.parse(options.body);
      assert.deepEqual(request, p.requests[calls - 1].request);
      const data = response(request);
      for (const a of Object.values(data.answers)) a.reasoning = "SECRET_ECHO";
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "x-typesafe-request-id": "synthetic-id" },
      });
    },
  });
  assert.equal(client.retry.maxRetries, 0);
  assert.equal(client.logLevel, "off");
  assert.equal((await run(p, dir, client)).succeeded, p.requests.length);
  const journal = readFileSync(join(dir, "journal.jsonl"), "utf8");
  assert.ok(!journal.includes("SECRET_ECHO"));
  assert.ok(!journal.includes("synthetic-id"), "request ids are stored hashed");
});

test("a 429 stops on the first attempt and never persists the response body", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const marker = "SYNTHETIC_ERROR_SECRET_MARKER";
  const client = makeClient({
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ error: marker }), { status: 429 });
    },
  });
  const result = await run(p, dir, client);
  assert.equal(calls, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.unknownAttempts, 1);
  assert.equal(result.estimatedTotalUSD, null);
  assert.ok(!readFileSync(join(dir, "journal.jsonl"), "utf8").includes(marker));
  await assert.rejects(run(p, dir, client));
  assert.equal(calls, 1);
});

for (const invalid of [
  "unexpected_model",
  "unknown_usage",
  "answer_set",
  "invalid_choice",
])
  test(`${invalid} stops the run without a second request`, async (t) => {
    const { p, dir } = setup(t);
    let calls = 0;
    const result = await run(
      p,
      dir,
      fake(async (r) => {
        calls++;
        const data = response(r);
        if (invalid === "unexpected_model") data.model = "unexpected";
        if (invalid === "unknown_usage") delete data.usage;
        if (invalid === "answer_set") data.answers = {};
        if (invalid === "invalid_choice")
          Object.values(data.answers)[0].probabilities = { x: 2 };
        return data;
      }),
    );
    assert.equal(calls, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.stoppedReason, "first_error");
    await assert.rejects(run(p, dir));
  });

test("a chosen option 0.01 below the maximum is accepted, 0.02 below is a stop", async (t) => {
  for (const [gap, ok] of [
    [0.01, true],
    [0.02, false],
  ]) {
    const { p, dir } = setup(t);
    const result = await run(
      p,
      dir,
      fake(async (r) =>
        response(r, (id, signal, negative) => ({
          choice: signal.presence,
          probabilities: {
            [signal.presence]: 0.5 - gap / 2,
            [negative]: 0.5 + gap / 2,
          },
        })),
      ),
    );
    assert.equal(result.complete, ok, `gap ${gap}`);
  }
});

test("the financial reservation halts the run before a request that could exceed the cap", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const result = await run(
    p,
    dir,
    fake(async (r) => {
      calls++;
      return {
        ...response(r),
        usage: { input_tokens: POLICY.maxInputTokens, output_tokens: 10 },
      };
    }),
    { capUSD: reservationUSD * 1.5 },
  );
  assert.equal(calls, 1);
  assert.equal(result.stoppedReason, "budget_reservation_exceeds_cap");
  assert.ok(result.budgetAccountedUSD <= reservationUSD * 1.5);
});

test("a cap below the first reservation makes zero requests", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0;
  const result = await run(
    p,
    dir,
    fake(async (r) => {
      calls++;
      return response(r);
    }),
    { capUSD: reservationUSD / 2 },
  );
  assert.equal(calls, 0);
  assert.equal(result.unattempted, p.requests.length);
});

test("requests are sequential and paced by the configured interval", async (t) => {
  const { p, dir } = setup(t);
  let now = 0,
    active = 0;
  const starts = [];
  await run(
    p,
    dir,
    fake(async (r) => {
      active++;
      assert.equal(active, 1);
      starts.push(now);
      await Promise.resolve();
      active--;
      return response(r);
    }),
    {
      intervalMs: 300,
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.deepEqual(
    starts,
    p.requests.map((_, i) => (i + 1) * 300),
  );
});

test("a corrupted journal, a tampered event and an existing lock fail closed", async (t) => {
  const { p, dir } = setup(t);
  await run(p, dir);
  const path = join(dir, "journal.jsonl");
  const original = readFileSync(path, "utf8");
  appendFileSync(path, "partial");
  await assert.rejects(run(p, dir));
  writeFileSync(path, original.replace('"latencyMs":', '"latencyMs":1,"x":'));
  assert.throws(() => readJournal(dir, p));
  const g = setup(t);
  mkdirSync(g.dir);
  writeFileSync(join(g.dir, "exclusive.lock"), "stale or active");
  await assert.rejects(run(g.p, g.dir));
});

test("a recorded mode or cap cannot be changed afterwards", async (t) => {
  const { p, dir } = setup(t);
  await run(p, dir);
  await assert.rejects(run(p, dir, fake(), { mode: "live" }));
  await assert.rejects(run(p, dir, fake(), { capUSD: 2 }));
});

test("journal symlinks and hard links cannot be used to overwrite project files", async (t) => {
  for (const link of [symlinkSync, linkSync]) {
    const root = scratch(t),
      p = plan(t),
      dir = join(root, "run");
    mkdirSync(dir);
    const target = join(root, "input.ts");
    writeFileSync(target, "// original\n");
    link(target, join(dir, "journal.jsonl"));
    await assert.rejects(run(p, dir));
    assert.equal(readFileSync(target, "utf8"), "// original\n");
  }
  const root = scratch(t),
    p = plan(t),
    dir = join(root, "run");
  mkdirSync(dir);
  const forbidden = join(root, "injected.js");
  symlinkSync(forbidden, join(dir, "journal.jsonl"));
  await assert.rejects(run(p, dir));
  assert.equal(existsSync(forbidden), false);
});

test("an interruption between completed requests resumes only the untouched suffix", async (t) => {
  const { p, dir } = setup(t);
  let calls = 0,
    sleeps = 0;
  const client = fake(async (request) => {
    calls++;
    return response(request);
  });
  await assert.rejects(
    run(p, dir, client, {
      sleep: async () => {
        if (++sleeps === 2)
          throw Error("interruption before the next reservation");
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(readJournal(dir, p).at(-1).type, "finished");
  const result = await run(p, dir, client);
  assert.equal(result.complete, true);
  assert.equal(calls, p.requests.length);
});

test("the fake-fetch helper answers every planned request once", async (t) => {
  const { p, dir } = setup(t);
  const { client, calls } = fakeFetch(async (r) => response(r));
  await run(p, dir, client);
  assert.equal(calls(), p.requests.length);
});
