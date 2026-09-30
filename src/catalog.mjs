import { readFileSync, readdirSync } from "node:fs";
import { hash } from "./core.mjs";

const meta = JSON.parse(
  readFileSync(new URL("../catalog.json", import.meta.url)),
);
const directory = new URL("../signals/", import.meta.url);
const files = readdirSync(directory)
  .filter((f) => f.endsWith(".json"))
  .sort();
const loaded = new Map(
  files.map((f) => {
    const signal = JSON.parse(readFileSync(new URL(f, directory)));
    return [signal.id, signal];
  }),
);
if (
  hash([...loaded.keys()].sort()) !== hash([...meta.order].sort()) ||
  files.some(
    (f) => f !== `${JSON.parse(readFileSync(new URL(f, directory))).id}.json`,
  )
)
  throw Error("signals/*.json must match catalog.json order exactly");

export const STATUSES = ["default", "experimental"];
export const signalStatusLabel = (signal) =>
  signal.status === "default" ? "default (experimental, alpha)" : signal.status;
export const signalCaveat = (signal) =>
  signal.id === "function_multiple_responsibilities"
    ? `the ${signal.independentTest.reviewedAboveCut} reviewed items all came from one repository; the gate asks for two (evals/results/validation-gate-2026-09-30.md)`
    : undefined;
export const allSignals = meta.order.map((id) => loaded.get(id));
export const fullCatalog = { ...meta, signals: allSignals };
export const catalogHash = hash(fullCatalog);
export const defaultSignalIds = allSignals
  .filter((s) => s.status === "default")
  .map((s) => s.id);

export const catalog = { ...meta, signals: [] };

export function selectSignals(ids = defaultSignalIds) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !loaded.has(id))
  )
    throw Error("Unknown or duplicate signal selection");
  catalog.signals = meta.order
    .filter((id) => ids.includes(id))
    .map((id) => loaded.get(id));
  return catalog.signals.map((s) => s.id);
}

export function question(signal) {
  return {
    type: signal.primitive,
    instructions: `${signal.id}@${signal.version}: ${signal.question} Apply state.evaluationRules.`,
    criteria: signal.criteria,
  };
}

selectSignals();
