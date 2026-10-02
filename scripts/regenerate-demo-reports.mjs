#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlan } from "../src/build-plan.mjs";
import { verifyPlan } from "../src/plan.mjs";
import { hash } from "../src/core.mjs";
import { summarize } from "../src/runner.mjs";
import { buildReport, queueMarkdown, reportMarkdown } from "../src/report.mjs";

export function regenerateDemoReports() {
  const demo = new URL("../examples/demo-app/", import.meta.url).pathname;
  const expected = join(demo, "expected");
  const plan = buildPlan(demo);
  const events = readFileSync(join(expected, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  const requestHashes = new Map(
    plan.requests.map((r) => [r.unitId, r.requestHash]),
  );
  for (const e of events.filter((e) => e.type === "reserved"))
    if (requestHashes.get(e.unitId) !== e.requestHash)
      throw Error(
        "The recorded journal does not match the current demo requests; re-record instead",
      );

  const recordedPlanHash = events[0].planHash;
  const { reportHash: _unused, ...fresh } = buildReport(plan, events);
  const body = JSON.parse(
    JSON.stringify(fresh).replaceAll(plan.planHash, recordedPlanHash),
  );
  const report = { ...body, reportHash: hash(body) };

  const { planHash: _sealed, ...planBody } = plan;
  const portable = { ...planBody, root: "examples/demo-app" };
  return {
    plan: verifyPlan({ ...portable, planHash: hash(portable) }),
    report,
    reportMarkdown: reportMarkdown(report, summarize(events, plan)),
    queueMarkdown: queueMarkdown(report),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const expected = join(
    new URL("../examples/demo-app/", import.meta.url).pathname,
    "expected",
  );
  const { plan, report, reportMarkdown, queueMarkdown } =
    regenerateDemoReports();
  writeFileSync(join(expected, "plan.json"), JSON.stringify(plan) + "\n");
  writeFileSync(
    join(expected, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(join(expected, "report.md"), reportMarkdown);
  writeFileSync(join(expected, "queue.md"), queueMarkdown);
  console.log(
    `Rewrote examples/demo-app/expected/{plan.json,report.json,report.md,queue.md} from the recorded journal: ${report.findings.length} worth a look, ${report.uncertain.length} uncertain. No API call.`,
  );
}
