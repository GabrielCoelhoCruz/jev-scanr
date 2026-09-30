import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createLimiter } from "../src/limiter.mjs";
import {
  readJournal,
  reservationUSD,
  runPlan,
  DEFAULT_CONCURRENCY,
} from "../src/runner.mjs";
import { buildReport } from "../src/report.mjs";
import { main } from "../src/cli.mjs";
import { POLICY } from "../src/core.mjs";
import {
  plan,
  scratch,
  fake,
  response,
  positive,
  clone,
  project,
} from "./helpers.mjs";

const many = (n) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `f${i}.ts`,
      `export function fn${i}(input: number) {\n  const a${i} = input * ${i + 3};\n  return a${i} + ${i};\n}\n`,
    ]),
  );

const virtual = () => {
  let now = 0;
  const waits = [];
  return {
    clock: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    now: () => now,
    waits,
  };
};

test("the limiter keeps any one-second window at or under the documented request rate", async () => {
  const v = virtual();
  const limiter = createLimiter({
    requestsPerSecond: 10,
    tokensPerSecond: 1e9,
    headroom: 0.8,
    burstSeconds: 0.25,
    clock: v.clock,
    sleep: v.sleep,
  });
  const grants = [];
  for (let i = 0; i < 40; i++) {
    await limiter.acquire(1);
    grants.push(v.now());
  }
  assert.equal(limiter.effective.requestRate, 8);
  assert.equal(limiter.effective.requestCapacity, 2);
  for (let i = 0; i + 10 < grants.length; i++)
    assert.ok(
      grants[i + 10] - grants[i] >= 1000 - 2,
      "no one-second window holds more than 10 grants",
    );
  assert.ok(v.now() >= ((40 - 2) / 8) * 1000 - 5);
});

test("the limiter paces by estimated tokens too, and lets an oversized request through once the bucket is full", async () => {
  const v = virtual();
  const limiter = createLimiter({
    requestsPerSecond: 1000,
    tokensPerSecond: 1000,
    headroom: 1,
    burstSeconds: 0.25,
    clock: v.clock,
    sleep: v.sleep,
  });
  for (let i = 0; i < 5; i++) await limiter.acquire(200);
  assert.equal(limiter.effective.tokenCapacity, 250);
  assert.ok(
    v.now() >= ((5 * 200 - 250) / 1000) * 1000 - 5,
    "5 x 200 tokens at 1000 tokens/s takes about 0.75 s",
  );
  const before = v.now();
  await limiter.acquire(5000);
  await limiter.acquire(1);
  assert.ok(
    v.now() - before >= 5000 - 300,
    "the debt of an oversized request is repaid before the next grant",
  );
});

test("the limiter grants in arrival order, applies headroom and validates its configuration", async () => {
  const v = virtual();
  const limiter = createLimiter({
    requestsPerSecond: 40,
    tokensPerSecond: 100000,
    clock: v.clock,
    sleep: v.sleep,
  });
  assert.equal(limiter.effective.requestRate, 32);
  assert.equal(limiter.effective.tokenRate, 80000);
  const order = [];
  await Promise.all(
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
      limiter.acquire(i % 2 ? 9000 : 100).then(() => order.push(i)),
    ),
  );
  assert.deepEqual(order, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => createLimiter({ requestsPerSecond: 0 }));
  assert.throws(() => createLimiter({ headroom: 1.5 }));
  assert.throws(() => limiter.acquire(0));
  const paced = createLimiter({
    minIntervalMs: 300,
    clock: v.clock,
    sleep: v.sleep,
  });
  const t0 = v.now();
  await paced.acquire(1);
  await paced.acquire(1);
  assert.ok(v.now() - t0 >= 600);
});

test("concurrency is bounded, reached, and validated", async (t) => {
  const p = plan(t, many(12));
  const dir = join(scratch(t), "run");
  let active = 0,
    peak = 0;
  const client = fake(async (request) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return response(request, positive(0.9));
  });
  const summary = await runPlan({
    plan: p,
    directory: dir,
    client,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 4,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
  });
  assert.equal(summary.complete, true);
  assert.equal(peak, 4);
  assert.equal(summary.concurrency, 4);
  for (const bad of [0, 33, 1.5, "8"])
    await assert.rejects(
      runPlan({
        plan: p,
        directory: join(scratch(t), "x"),
        client,
        mode: "synthetic",
        capUSD: 1,
        concurrency: bad,
      }),
      /Concurrency must be/,
    );
  assert.equal(DEFAULT_CONCURRENCY, 8);
});

test("the cap reserves before dispatch across in-flight requests", async (t) => {
  const p = plan(t, many(10));
  const dir = join(scratch(t), "run");
  let active = 0,
    peak = 0;
  const client = fake(async (request) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return response(request);
  });
  const summary = await runPlan({
    plan: p,
    directory: dir,
    client,
    mode: "synthetic",
    concurrency: 6,
    capUSD: reservationUSD * 2.5,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
  });
  assert.equal(peak, 2, "only two reservations fit under the cap at once");
  assert.equal(
    summary.complete,
    true,
    "finished requests release their reservation, so the run continues",
  );
  const events = readJournal(dir, p);
  let open = 0,
    max = 0;
  for (const e of events) {
    if (e.type === "reserved") max = Math.max(max, ++open);
    if (e.type === "finished") open--;
  }
  assert.equal(max, 2);
  const tiny = await runPlan({
    plan: p,
    directory: join(scratch(t), "tiny"),
    client,
    mode: "synthetic",
    concurrency: 6,
    capUSD: reservationUSD / 2,
  });
  assert.equal(tiny.reservedAttempts, 0);
});

test("a real spend that leaves no room stops after the in-flight requests are recorded", async (t) => {
  const p = plan(t, many(10));
  const dir = join(scratch(t), "run");
  let calls = 0;
  const summary = await runPlan({
    plan: p,
    directory: dir,
    mode: "synthetic",
    concurrency: 3,
    capUSD: reservationUSD * 3.5,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
    client: fake(async (request) => {
      calls++;
      return {
        ...response(request),
        usage: { input_tokens: POLICY.maxInputTokens, output_tokens: 1 },
      };
    }),
  });
  assert.equal(summary.stoppedReason, "budget_reservation_exceeds_cap");
  assert.ok(summary.reservedAttempts >= 3 && summary.reservedAttempts < 10);
  assert.equal(
    summary.unresolvedReservations,
    0,
    "every dispatched request has its outcome in the journal",
  );
  assert.equal(calls, summary.reservedAttempts);
  assert.ok(
    summary.budgetAccountedUSD <= reservationUSD * 3.5 + reservationUSD,
  );
});

test("the journal stays write-ahead and valid when requests overlap and finish out of order", async (t) => {
  const p = plan(t, many(6));
  const dir = join(scratch(t), "run");
  const held = [];
  let resolveStarted;
  const started = new Promise((r) => (resolveStarted = r));
  const summaryPromise = runPlan({
    plan: p,
    directory: dir,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 3,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
    client: fake(async (request) => {
      if (held.length >= 3) return response(request, positive(0.9));
      await new Promise((release) => {
        held.push({ request, release });
        if (held.length === 3) resolveStarted();
      });
      return response(request, positive(0.9));
    }),
  });
  await started;
  for (const h of [...held].reverse()) {
    h.release();
    await new Promise((r) => setImmediate(r));
  }
  const summary = await summaryPromise;
  assert.equal(summary.complete, true);
  const events = readJournal(dir, p);
  const kinds = events.map((e) => e.type[0]);
  assert.match(
    kinds.join(""),
    /irr/,
    "two reservations are written before the first outcome",
  );
  const reservedAt = new Map(
    events.map((e, i) => [e.type === "reserved" ? e.unitId : null, i]),
  );
  events.forEach((e, i) => {
    if (e.type === "finished")
      assert.ok(reservedAt.get(e.unitId) < i, "reserved before it finished");
  });
  const order = events
    .filter((e) => e.type === "finished")
    .map((e) => e.unitId);
  const unitOf = (request) =>
    p.requests.find((r) => r.request === request).unitId;
  const [first, second, third] = held.map((h) =>
    order.indexOf(unitOf(h.request)),
  );
  assert.ok(
    third < second && second < first,
    "the three overlapping requests finish in the reverse of their start order",
  );
  assert.equal(order[0], unitOf(held[2].request));
  assert.notDeepEqual(
    order,
    p.requests.map((r) => r.unitId),
    "completion order differs from plan order",
  );
});

test("results do not depend on scheduling: a concurrent run gives the same report as a serial one", async (t) => {
  const p = plan(t, many(10));
  const answer = (request) =>
    response(request, (id, signal, negative) =>
      positive(0.3 + ((request.state.path.length * 7) % 60) / 100)(
        id,
        signal,
        negative,
      ),
    );
  const run = async (concurrency, jitter) => {
    const dir = join(scratch(t), `run${concurrency}`);
    await runPlan({
      plan: p,
      directory: dir,
      mode: "synthetic",
      capUSD: 1,
      concurrency,
      rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
      client: fake(async (request) => {
        if (jitter) await new Promise((r) => setTimeout(r, Math.random() * 10));
        return answer(request);
      }),
    });
    return buildReport(p, readJournal(dir, p)).reportHash;
  };
  assert.equal(await run(1, false), await run(8, true));
});

test("a first error stops new dispatch, still records what was in flight, and never retries", async (t) => {
  const p = plan(t, many(12));
  const dir = join(scratch(t), "run");
  let calls = 0;
  let resolveAllStarted, resolveSettled;
  const allStarted = new Promise((r) => (resolveAllStarted = r));
  const settled = new Promise((r) => (resolveSettled = r));
  const summaryPromise = runPlan({
    plan: p,
    directory: dir,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 4,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
    client: fake(async (request) => {
      const mine = ++calls;
      if (mine === 4) resolveAllStarted();
      await allStarted;
      if (mine === 2) throw Object.assign(Error("boom"), { status: 500 });
      await settled;
      return response(request);
    }),
  });
  await allStarted;
  await new Promise((r) => setImmediate(r));
  resolveSettled();
  const summary = await summaryPromise;
  assert.equal(summary.stoppedReason, "first_error");
  assert.equal(summary.unresolvedReservations, 0);
  assert.ok(summary.failed >= 1);
  assert.equal(
    calls,
    4,
    "no request is started after the failure was recorded",
  );
  const events = readJournal(dir, p);
  const firstFail = events.findIndex(
    (e) => e.type === "finished" && e.status === "failed",
  );
  assert.ok(events.slice(firstFail).every((e) => e.type !== "reserved"));
  assert.equal(events.at(-1).type, "stopped");
  await assert.rejects(
    runPlan({
      plan: p,
      directory: dir,
      mode: "synthetic",
      capUSD: 1,
      concurrency: 4,
      client: fake(),
    }),
    /retry refused/,
  );
});

test("a 429 is a stop condition: retry-after is recorded, never obeyed with a retry", async (t) => {
  const p = plan(t, many(4));
  const dir = join(scratch(t), "run");
  let calls = 0;
  const summary = await runPlan({
    plan: p,
    directory: dir,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 2,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
    client: fake(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      throw Object.assign(Error("SECRET_BODY"), {
        status: 429,
        headers: { get: (k) => (k === "retry-after" ? "7" : null) },
      });
    }),
  });
  assert.equal(summary.stoppedReason, "first_error");
  assert.equal(calls, 2, "only the two in-flight requests were sent");
  const failed = readJournal(dir, p).filter((e) => e.status === "failed");
  assert.deepEqual(
    failed.map((e) => [e.failure.httpStatus, e.failure.retryAfterSeconds]),
    [
      [429, 7],
      [429, 7],
    ],
  );
  assert.ok(
    !readFileSync(join(dir, "journal.jsonl"), "utf8").includes("SECRET_BODY"),
  );
});

test("a crash with requests in flight leaves unknown attempts that block a blind resume", async (t) => {
  const p = plan(t, many(8));
  const dir = join(scratch(t), "run");
  let seen = 0;
  const args = {
    plan: p,
    directory: dir,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 3,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
  };
  await assert.rejects(
    runPlan({
      ...args,
      client: fake(async (r) => response(r)),
      afterReserve: async () => {
        if (++seen === 3) throw Error("synthetic crash");
      },
    }),
    /synthetic crash/,
  );
  const events = readJournal(dir, p);
  const reserved = events.filter((e) => e.type === "reserved").length,
    finished = events.filter((e) => e.type === "finished").length;
  assert.ok(reserved > finished, "the crashed request stays reserved");
  let calls = 0;
  await assert.rejects(
    runPlan({ ...args, client: fake(async (r) => (calls++, response(r))) }),
    /retry refused/,
  );
  assert.equal(calls, 0);
});

test("an interruption between requests resumes only the untouched requests, under concurrency", async (t) => {
  const p = plan(t, many(9));
  const dir = join(scratch(t), "run");
  const v = virtual();
  let calls = 0,
    sleeps = 0;
  const client = fake(async (r) => {
    calls++;
    await new Promise((res) => setTimeout(res, 2));
    return response(r);
  });
  const common = {
    plan: p,
    directory: dir,
    mode: "synthetic",
    capUSD: 1,
    concurrency: 3,
    client,
  };
  await assert.rejects(
    runPlan({
      ...common,
      intervalMs: 300,
      clock: v.clock,
      sleep: async (ms) => {
        if (++sleeps === 5) throw Error("interruption");
        v.now;
        await v.sleep(ms);
      },
    }),
    /interruption/,
  );
  const partial = readJournal(dir, p);
  const done = partial.filter((e) => e.type === "finished").length;
  assert.ok(done >= 1 && done < 9);
  assert.equal(
    partial.filter((e) => e.type === "reserved").length,
    done,
    "nothing is left unknown",
  );
  const before = calls;
  const result = await runPlan({
    ...common,
    rateLimits: { requestsPerSecond: 1e6, tokensPerSecond: 1e12 },
  });
  assert.equal(result.complete, true);
  assert.equal(calls, 9, "each request was sent exactly once across both runs");
  assert.equal(calls - before, 9 - done);
});

test("--concurrency is validated, defaults to 8 and is recorded in the journal", async (t) => {
  t.mock.method(console, "log", () => {});
  const root = project(t, many(3));
  const out = join(scratch(t), "out");
  await main(["scan", root, "--run", "--yes", "--cap-usd", "1", "--out", out], {
    client: fake(async (r) => response(r)),
  });
  const first = JSON.parse(
    readFileSync(join(out, "run", "journal.jsonl"), "utf8").split("\n")[0],
  );
  assert.equal(first.concurrency, 8);
  const out2 = join(scratch(t), "out2");
  await main(
    [
      "scan",
      root,
      "--run",
      "--yes",
      "--cap-usd",
      "1",
      "--concurrency",
      "2",
      "--out",
      out2,
    ],
    { client: fake(async (r) => response(r)) },
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(out2, "run", "journal.jsonl"), "utf8").split("\n")[0],
    ).concurrency,
    2,
  );
  await assert.rejects(
    main(
      [
        "scan",
        root,
        "--run",
        "--yes",
        "--cap-usd",
        "1",
        "--concurrency",
        "99",
        "--out",
        join(scratch(t), "o3"),
      ],
      { client: fake() },
    ),
    /--concurrency/,
  );
  assert.match(readFileSync(join(out, "report.md"), "utf8"), /Cost/);
  void clone;
});
