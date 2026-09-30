#!/usr/bin/env node
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { POLICY } from "../src/core.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { makeClient, runPlan, readJournal } from "../src/runner.mjs";
import { buildReport } from "../src/report.mjs";
import { fullCatalog } from "../src/catalog.mjs";

const fixtures = new URL("../test/fixtures/", import.meta.url).pathname;

export async function checkSignal(id, { client, capUSD = 0.05, cut } = {}) {
  const signal = fullCatalog.signals.find((s) => s.id === id);
  if (!signal) throw Error("Unknown signal");
  const threshold = cut ?? fullCatalog.displayThresholdDefault;
  const result = { signalId: id, threshold, variants: {} };
  const scratch = mkdtempSync(join(tmpdir(), "jev-scanr-check-"));
  try {
    for (const variant of ["positive", "negative"]) {
      const plan = buildPlan(join(fixtures, id, variant), { signals: [id] });
      const directory = join(scratch, variant);
      await runPlan({
        plan,
        directory,
        client,
        mode: "live",
        capUSD,
        intervalMs: POLICY.minIntervalMs,
      });
      const report = buildReport(plan, readJournal(directory, plan));
      const cells = report.blocks
        .flatMap((b) => b.signals)
        .filter((c) => c.signalId === id && c.status === "scored");
      result.variants[variant] = cells.map((c) => c.pPositive);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const { positive, negative } = result.variants;
  result.ok =
    positive.length > 0 &&
    negative.length > 0 &&
    Math.max(...positive) >= threshold &&
    Math.max(...negative) < threshold;
  return result;
}

function isEntryPoint() {
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const [id, ...rest] = process.argv.slice(2);
  const capIndex = rest.indexOf("--cap-usd");
  const cap = capIndex >= 0 ? Number(rest[capIndex + 1]) : 0.05;
  if (!id || !rest.includes("--yes") || !Number.isFinite(cap) || cap <= 0)
    throw Error(
      "Usage: node scripts/check-signal.mjs SIGNAL_ID --yes [--cap-usd 0.05]\nThis sends the fixture sources under test/fixtures/SIGNAL_ID to the Jev API with your TYPESAFE_API_KEY.",
    );
  if (!process.env.TYPESAFE_API_KEY)
    throw Error("Set TYPESAFE_API_KEY in the environment");
  const result = await checkSignal(id, {
    client: makeClient({ apiKey: process.env.TYPESAFE_API_KEY }),
    capUSD: cap,
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.ok
      ? "Fixtures behave as expected: positive at or above the cut, negative below it."
      : "Fixtures do NOT separate at the cut. Rework the question or the fixtures before proposing the signal.",
  );
  process.exitCode = result.ok ? 0 : 1;
}
