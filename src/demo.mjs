import { readFileSync } from "node:fs";

const recorded = new URL("../examples/demo-app/expected/", import.meta.url);
const read = (name) => readFileSync(new URL(name, recorded), "utf8");

export function recordedRun() {
  return {
    queue: read("queue.md"),
    receipt: JSON.parse(read("RECEIPT.json")),
    result: JSON.parse(read("RESULT.json")),
  };
}

export function demoBanner({ receipt, result }) {
  const count = (n) => n.toLocaleString("en-US");
  return [
    "RECORDED RUN. This replays a saved result: nothing is sent, and no key or network is needed.",
    `  Recorded with jev-scanr ${receipt.scanner.version} on ${result.finishedAtUTC.slice(0, 10)}, model ${receipt.model}, on the synthetic app in examples/demo-app.`,
    `  ${result.succeeded} of ${result.requests} requests answered, ${count(result.inputTokens)} input tokens, US$${result.calculatedUSD.toFixed(4)} calculated from the tariff (not an invoice).`,
    "  Jev's probabilities change from call to call, so a live run will not match this exactly.",
  ].join("\n");
}

export const DEMO_FOOTER = [
  "End of the replay. The items above are hypotheses from one Jev answer each, not confirmed bugs.",
  "Try your own code with a free dry run that sends nothing: jevs scan .",
].join("\n");

export function demoText() {
  const run = recordedRun();
  return `${demoBanner(run)}\n\n${run.queue.trimEnd()}\n\n${DEMO_FOOTER}`;
}
