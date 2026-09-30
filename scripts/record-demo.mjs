#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { POLICY } from "../src/core.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { reservationUSD, readJournal, summarize } from "../src/runner.mjs";
import { catalogHashFor } from "../src/catalog.mjs";
import { main } from "../src/cli.mjs";

const root = new URL("../", import.meta.url).pathname;
const demo = join(root, "examples/demo-app");
const sha = (b) => createHash("sha256").update(b).digest("hex");

function contentHash(dirs) {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      statSync(p).isDirectory() ? walk(p) : files.push(p);
    }
  };
  dirs.forEach((d) => walk(join(root, d)));
  return sha(
    files
      .map((p) => `${p.slice(root.length)}:${sha(readFileSync(p))}`)
      .join("\n"),
  );
}

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const out = resolve(value("--out") ?? "");
const cap = Number(value("--cap-usd"));
const priceChecked = value("--price-checked");
if (
  !args.includes("--yes") ||
  !value("--out") ||
  !Number.isFinite(cap) ||
  cap <= 0 ||
  !priceChecked
)
  throw Error(
    "Usage: node scripts/record-demo.mjs --yes --cap-usd 0.02 --price-checked YYYY-MM-DD --out DIR\nRecords one real Jev pass over examples/demo-app with your TYPESAFE_API_KEY: freeze receipt first, one pass, no retries, stop on the first error.",
  );
if (!process.env.TYPESAFE_API_KEY)
  throw Error("Set TYPESAFE_API_KEY in the environment");
if (existsSync(out)) throw Error("Output directory must be new");

const plan = buildPlan(demo);
const e = plan.estimates;
const conservativeUSD = e.USDOneBytePerTokenSensitivity + reservationUSD;
if (conservativeUSD > cap) throw Error("Worst-case cost exceeds the cap");
mkdirSync(out, { recursive: true, mode: 0o700 });
const receiptPath = join(out, "RECEIPT.json");
writeFileSync(
  receiptPath,
  JSON.stringify(
    {
      schema: "demo-recording-receipt/1",
      frozenAtUTC: new Date().toISOString(),
      purpose:
        "One real recorded Jev pass over the bundled synthetic demo app. Written before any request.",
      scanner: {
        version: JSON.parse(readFileSync(join(root, "package.json"))).version,
        sourceContentSHA256: contentHash(["src", "signals"]),
        catalogHash: catalogHashFor(plan.enabledSignals),
      },
      demoContentSHA256: contentHash(["examples/demo-app/src"]),
      model: POLICY.model,
      tariffUSDPerMillionInput: POLICY.inputUSDPerMillion,
      priceConfirmed: `docs.typesafe.ai/models.md checked ${priceChecked}`,
      signals: plan.enabledSignals,
      requests: e.requests,
      questions: e.questions,
      serializedRequestBytes: e.serializedRequestBytes,
      requestHashesSHA256: sha(
        JSON.stringify(plan.requests.map((r) => r.requestHash)),
      ),
      estimatedUSD: e.heuristicUSDBytesDiv3,
      conservativeUSD,
      capUSD: cap,
      passes: 1,
      sdkRetries: 0,
      stopRule:
        "stop on the first error, 429, unexpected model, unknown usage or invalid answer",
      credentialPresent: true,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o400 },
);
chmodSync(receiptPath, 0o400);

const run = join(out, "run");
await main(
  ["scan", demo, "--run", "--yes", "--cap-usd", String(cap), "--out", run],
  {},
);
const journal = join(run, "run", "journal.jsonl");
const plan2 = JSON.parse(readFileSync(join(run, "plan.json")));
const summary = summarize(readJournal(join(run, "run"), plan2), plan2);
writeFileSync(
  join(out, "RESULT.json"),
  JSON.stringify(
    {
      complete: summary.complete,
      requests: summary.plannedRequests,
      succeeded: summary.succeeded,
      failed: summary.failed,
      unknownAttempts: summary.unknownAttempts,
      inputTokens: summary.knownInputTokens,
      outputTokens: summary.knownOutputTokens,
      calculatedUSD: summary.knownEstimatedUSD,
      invoiceVerified: false,
      finishedAtUTC: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
for (const f of ["report.json", "report.md", "queue.md"])
  copyFileSync(join(run, f), join(out, f));
copyFileSync(journal, join(out, "journal.jsonl"));
console.log(`Recorded to ${out}`);
