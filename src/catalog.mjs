import { readFileSync, readdirSync } from "node:fs";
import { hash } from "./core.mjs";

const { optIn, ...meta } = JSON.parse(
  readFileSync(new URL("../catalog.json", import.meta.url)),
);
const ordered = [...meta.order, ...optIn];
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
  hash([...loaded.keys()].sort()) !== hash([...ordered].sort()) ||
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
export const allSignals = ordered.map((id) => loaded.get(id));
export const fullCatalog = { ...meta, optIn, signals: allSignals };
export const defaultSignalIds = allSignals
  .filter((s) => s.status === "default")
  .map((s) => s.id);
export const optInSignalIds = optIn;

export const catalogHashFor = (enabled) =>
  hash({
    ...meta,
    signals: ordered
      .filter(
        (id) =>
          !optIn.includes(id) ||
          (Array.isArray(enabled) && enabled.includes(id)),
      )
      .map((id) => loaded.get(id)),
  });

export const catalog = { ...meta, signals: [] };

export function selectSignals(ids = defaultSignalIds) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !loaded.has(id))
  )
    throw Error("Unknown or duplicate signal selection");
  catalog.signals = ordered
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
