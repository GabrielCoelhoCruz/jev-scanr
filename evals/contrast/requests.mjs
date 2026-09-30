// Builds the exact requests a live run would send, from the excerpt files, with the scanner's own code
// (snapshot, index, evidence pack, request assembly). Offline. Also prints the live-run receipt.
//
//   node evals/contrast/requests.mjs --project DIR [--units FILE] [--receipt]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hash, POLICY } from "../../src/core.mjs";
import { buildIndex } from "../../src/index.mjs";
import { makePack } from "../../src/packs.mjs";
import {
  applyQuestionEligibility,
  catalog,
  questionEligibility,
  requestFor,
} from "../../src/plan.mjs";
import { allSignals } from "../../src/catalog.mjs";
import { readSnapshot } from "../../src/snapshot.mjs";
import { reservationUSD } from "../../src/runner.mjs";

const CANDIDATE = new URL("./signals/name_vs_behavior.json", import.meta.url);
export const candidateSignals = () => [JSON.parse(readFileSync(CANDIDATE))];
const PROMPT = { promptFormat: "shared-rules-v1" };
export const CAP_USD = 0.5;

function signalFor(meta) {
  const found = [...allSignals, ...candidateSignals()].find(
    (s) => s.id === meta.signal,
  );
  if (!found) throw Error(`Unknown signal ${meta.signal}`);
  return found;
}

export function buildRequests(doc, projectDir) {
  const out = [];
  for (const [setId, meta] of Object.entries(doc.sets)) {
    const units = doc.units.filter((u) => u.set === setId);
    for (const u of units)
      for (const f of u.files) {
        const got = hash(readFileSync(join(projectDir, setId, f.path)));
        if (got !== f.sha256)
          throw Error(`${setId}/${f.path}: sha256 differs from units.json`);
      }
    const signal = signalFor(meta);
    catalog.signals = [signal];
    const snapshot = readSnapshot(join(projectDir, setId));
    const skipped = snapshot.files.filter(
      (f) => f.status !== "read" && f.status !== "non_source",
    );
    if (skipped.length)
      throw Error(`${setId}: ${skipped.length} excerpt files were not read`);
    const index = buildIndex(snapshot);
    if (index.errors.length)
      throw Error(`${setId}: ${JSON.stringify(index.errors[0])}`);
    const limits = snapshot.limits;
    const bytes = (pack) => {
      const probe = { ...pack, status: "eligible", contextVersion: "0.3.1" };
      probe.questionEligibility = questionEligibility(probe);
      return Buffer.byteLength(
        JSON.stringify(requestFor(probe, { includeIneligible: true })),
      );
    };
    const byPath = new Map();
    const nestedIn = new Set([
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
      "ObjectMethod",
      "ClassMethod",
      "ClassPrivateMethod",
    ]);
    for (const f of index.functions) {
      if (f.ancestors.some((a) => nestedIn.has(a.type))) continue;
      if (!byPath.has(f.path)) byPath.set(f.path, []);
      byPath.get(f.path).push(f);
    }
    for (const u of units) {
      const members = u.files.map((f) => {
        const list = byPath.get(f.path) ?? [];
        if (list.length !== 1)
          throw Error(
            `${setId}/${f.path}: ${list.length} functions, expected 1`,
          );
        return list[0];
      });
      const candidate = {
        kind: meta.kind,
        id: hash([meta.kind, members.map((m) => m.id), null]),
        members,
        facts: { provenance: "constructed_contrast_unit" },
      };
      const pack = {
        ...makePack(candidate, index, {
          budgetTrim: true,
          declarationCapNonDecisive: true,
          fits: (c) => bytes({ ...c, ...PROMPT }) <= limits.maxRequestBytes,
        }),
        ...PROMPT,
        unitId: candidate.id,
        contextVersion: "0.3.1",
      };
      applyQuestionEligibility(pack);
      const request = requestFor(pack);
      if (!request)
        throw Error(`${setId}/${u.id}: no request (${pack.status})`);
      const serializedBytes = Buffer.byteLength(JSON.stringify(request));
      if (serializedBytes > limits.maxHardRequestBytes)
        throw Error(`${setId}/${u.id}: request over the byte cap`);
      out.push({
        unitId: u.id,
        set: setId,
        request,
        requestHash: hash(request),
        serializedBytes,
        lines: members.map((m) => m.lines),
      });
    }
  }
  return out;
}

export function receipt(requests, capUSD = CAP_USD) {
  const total = requests.reduce((n, r) => n + r.serializedBytes, 0);
  const estTokens = Math.ceil(total / 3);
  const perSet = Object.fromEntries(
    ["A", "B", "C"].map((s) => {
      const rs = requests.filter((r) => r.set === s);
      return [
        s,
        {
          requests: rs.length,
          bytes: rs.reduce((n, r) => n + r.serializedBytes, 0),
        },
      ];
    }),
  );
  const price = POLICY.inputUSDPerMillion;
  return {
    model: POLICY.model,
    requests: requests.length,
    questionsPerRequest: 1,
    passes: 1,
    retries: 0,
    stopOnFirstError: true,
    perSet,
    serializedBytes: total,
    estimatedInputTokens: estTokens,
    estimatedUSD: (estTokens * price) / 1e6,
    worstCaseUSD: (total * price) / 1e6 + reservationUSD,
    perRequestReservationUSD: reservationUSD,
    capUSD,
    tariffUSDPerMillionInputTokens: price,
    outputUSDPerMillion: POLICY.outputUSDPerMillion,
    fitsCap: (total * price) / 1e6 + reservationUSD <= capUSD,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      units: {
        type: "string",
        default: new URL("./units.json", import.meta.url).pathname,
      },
    },
  });
  if (!values.project) throw Error("Usage: requests.mjs --project DIR");
  const doc = JSON.parse(readFileSync(values.units, "utf8"));
  console.log(
    JSON.stringify(receipt(buildRequests(doc, values.project)), null, 2),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
