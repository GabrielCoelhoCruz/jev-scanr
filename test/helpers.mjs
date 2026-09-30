import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { POLICY, hash } from "../src/core.mjs";
import { allSignals } from "../src/catalog.mjs";
import { buildPlan } from "../src/build-plan.mjs";
import { makeClient, runPlan } from "../src/runner.mjs";

export function project(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "jev-scanr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

export const scratch = (t) => project(t);

export const clone = (name, k = "10") =>
  `export function ${name}(input: number) {\n  const threshold = ${k};\n  if (input > threshold) {\n    return input - threshold;\n  }\n  const fallback = 0;\n  return fallback;\n}\n`;

export const twoFiles = {
  "a.ts": clone("alpha") + clone("beta", "20"),
  "b.ts": clone("gamma"),
};

export const plan = (t, files = twoFiles, options = {}) =>
  buildPlan(project(t, files), options);

export function reseal(p) {
  for (const unit of p.units) {
    const { contentHash, ...body } = unit;
    unit.contentHash = hash(body);
  }
  const { planHash, ...body } = p;
  p.planHash = hash(body);
  return p;
}

export const signalById = (id) => allSignals.find((s) => s.id === id);
export const other = (signal, keys) =>
  keys.find((k) => k !== signal.presence && k !== "insufficient");

export function answers(request, decide = () => null) {
  return Object.fromEntries(
    Object.entries(request.questions).map(([id, q]) => {
      const signal = signalById(id),
        keys = Object.keys(q.criteria),
        negative = other(signal, keys);
      const chosen = decide(id, signal, negative) ?? {
        choice: negative,
        probabilities: { [signal.presence]: 0.1, [negative]: 0.9 },
      };
      return [
        id,
        {
          type: "choice",
          choice: chosen.choice,
          confidence: 0.8,
          probabilities: Object.fromEntries(
            keys.map((k) => [k, chosen.probabilities[k] ?? 0]),
          ),
        },
      ];
    }),
  );
}

export const response = (request, decide) => ({
  model: POLICY.model,
  answers: answers(request, decide),
  usage: { input_tokens: 100, output_tokens: 10 },
});

export const positive =
  (p = 0.9) =>
  (id, signal, negative) => ({
    choice: p >= 0.5 ? signal.presence : negative,
    probabilities: { [signal.presence]: p, [negative]: 1 - p },
  });

export const fake = (fn = async (request) => response(request)) => ({
  systemOne: (request) => ({
    withResponse: async () => ({
      data: await fn(request),
      requestId: "synthetic-test",
    }),
  }),
});

export function fakeFetch(fn) {
  let calls = 0;
  const client = makeClient({
    fetch: async (_url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      const names = request.state.members.map((m) => m.name ?? "").join(",");
      return new Response(JSON.stringify(await fn(request, names)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, calls: () => calls };
}

export const run = (p, directory, client = fake(), more = {}) =>
  runPlan({
    plan: p,
    directory,
    client,
    mode: "synthetic",
    capUSD: 1,
    intervalMs: 0,
    ...more,
  });
