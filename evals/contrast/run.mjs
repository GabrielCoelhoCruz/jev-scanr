#!/usr/bin/env node
// Live run of the constructed-contrast requests: one pass, no retries, stop on the first error, hard cap.
// The key comes from TYPESAFE_API_KEY or the file jevs auth wrote, never from argv. Without --run it only
// prints the receipt and sends nothing.
//
//   node evals/contrast/run.mjs --project DIR                       receipt only
//   node evals/contrast/run.mjs --project DIR --run --yes --cap-usd 0.5 --out RUNDIR
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hash, POLICY } from "../../src/core.mjs";
import { resolveApiKey } from "../../src/credentials.mjs";
import {
  knownUsage,
  makeClient,
  reservationUSD,
  validateResponse,
} from "../../src/runner.mjs";
import { ResponseValidationError } from "../../src/validation.mjs";
import { rngFor, shuffle } from "./lib/match.mjs";
import { buildRequests, CAP_USD, receipt } from "./requests.mjs";
import { SEED } from "./build.mjs";

export async function runContrast({
  requests,
  client,
  capUSD,
  outDir,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervalMs = POLICY.minIntervalMs,
}) {
  if (!Number.isFinite(capUSD) || capUSD <= 0 || capUSD > CAP_USD)
    throw Error(`A positive cap of at most US$${CAP_USD} is required`);
  const plan = receipt(requests, capUSD);
  if (!plan.fitsCap)
    throw Error(
      `Worst-case cost US$${plan.worstCaseUSD.toFixed(4)} exceeds the cap US$${capUSD}`,
    );
  const order = shuffle(requests, rngFor(SEED, "order"));
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const fd = openSync(join(outDir, "journal.jsonl"), "wx", 0o600);
  writeFileSync(
    join(outDir, "requests.json"),
    JSON.stringify(
      {
        receipt: plan,
        order: order.map((r) => ({
          unitId: r.unitId,
          set: r.set,
          requestHash: r.requestHash,
          serializedBytes: r.serializedBytes,
        })),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const events = [];
  const append = (fields) => {
    const body = {
      seq: events.length,
      previousHash: events.at(-1)?.eventHash ?? null,
      ...fields,
    };
    const event = { ...body, eventHash: hash(body) };
    appendFileSync(fd, JSON.stringify(event) + "\n");
    fsyncSync(fd);
    events.push(event);
  };
  let accounted = 0,
    stopped = null,
    succeeded = 0,
    inputTokens = 0;
  try {
    append({
      type: "initialized",
      mode: "live",
      capUSD,
      policy: POLICY,
      concurrency: 1,
      requestsHash: hash(order.map((r) => r.requestHash)),
      receipt: plan,
      recordedAt: new Date().toISOString(),
    });
    for (const item of order) {
      if (accounted + reservationUSD > capUSD) {
        stopped = "budget_reservation_exceeds_cap";
        break;
      }
      append({
        type: "reserved",
        unitId: item.unitId,
        requestHash: item.requestHash,
        reservedUSD: reservationUSD,
        recordedAt: new Date().toISOString(),
      });
      const started = performance.now();
      let data = null,
        response = null,
        failure = null,
        requestId = null;
      try {
        const result = await client.systemOne(item.request).withResponse();
        data = result.data;
        requestId =
          typeof result.requestId === "string" &&
          result.requestId.length <= 4096
            ? hash(result.requestId)
            : null;
        validateResponse(item.request, data);
        response = {
          model: data.model,
          answers: Object.fromEntries(
            Object.entries(data.answers).map(([id, a]) => [
              id,
              {
                type: a.type,
                choice: a.choice,
                confidence: a.confidence,
                probabilities: a.probabilities,
              },
            ]),
          ),
          usage: knownUsage(data),
        };
      } catch (error) {
        const status =
          Number.isInteger(error.status) &&
          error.status >= 100 &&
          error.status <= 599
            ? error.status
            : null;
        failure = {
          kind:
            error instanceof ResponseValidationError
              ? "response_validation"
              : "transport_error",
          diagnostic:
            error instanceof ResponseValidationError ? error.diagnostic : null,
          httpStatus: status,
          rawErrorOmitted:
            "Error messages, headers and bodies may contain secrets; not persisted",
        };
      }
      const usage = knownUsage(data);
      append({
        type: "finished",
        unitId: item.unitId,
        status: failure ? "failed" : "succeeded",
        serverRequestIdHash: requestId,
        latencyMs: performance.now() - started,
        usage,
        response,
        failure,
        recordedAt: new Date().toISOString(),
      });
      if (failure) {
        stopped = "first_error";
        break;
      }
      succeeded++;
      inputTokens += usage.input_tokens;
      accounted += (usage.input_tokens * POLICY.inputUSDPerMillion) / 1e6;
      await sleep(intervalMs);
    }
    append(
      stopped ? { type: "stopped", reason: stopped } : { type: "complete" },
    );
  } finally {
    closeSync(fd);
  }
  return {
    planned: requests.length,
    succeeded,
    stopped,
    complete: !stopped && succeeded === requests.length,
    inputTokens,
    calculatedUSD: accounted,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      units: {
        type: "string",
        default: new URL("./units.json", import.meta.url).pathname,
      },
      run: { type: "boolean" },
      yes: { type: "boolean" },
      "cap-usd": { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.project) throw Error("--project DIR required");
  const doc = JSON.parse(readFileSync(values.units, "utf8"));
  const requests = buildRequests(doc, values.project);
  const plan = receipt(
    requests,
    values["cap-usd"] ? Number(values["cap-usd"]) : CAP_USD,
  );
  console.log(JSON.stringify(plan, null, 2));
  if (!values.run) return console.log("Receipt only: nothing was sent.");
  if (!values.yes || !values["cap-usd"] || !values.out)
    throw Error("A live run needs --yes, --cap-usd N and --out DIR");
  const apiKey = resolveApiKey(process.env);
  if (!apiKey) throw Error("No API key: set TYPESAFE_API_KEY or run jevs auth");
  const result = await runContrast({
    requests,
    client: makeClient({ apiKey }),
    capUSD: Number(values["cap-usd"]),
    outDir: values.out,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.complete) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
