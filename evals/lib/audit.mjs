import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY } from "../../src/core.mjs";
import { allSignals } from "../../src/catalog.mjs";
import { runEval, expectedOf, readFlows } from "./eval-run.mjs";

const signalOf = (id) => allSignals.find((s) => s.id === id);

export function answerFor(
  request,
  positiveP,
  { choice, model = POLICY.model } = {},
) {
  const answers = {};
  for (const [id, q] of Object.entries(request.questions)) {
    const signal = signalOf(id),
      keys = Object.keys(q.criteria),
      negative = keys.find(
        (k) => k !== signal.presence && k !== "insufficient",
      );
    const picked = choice ?? (positiveP >= 0.5 ? signal.presence : negative);
    answers[id] = {
      type: "choice",
      choice: picked,
      confidence: 0.8,
      probabilities: Object.fromEntries(
        keys.map((k) => [
          k,
          picked === "insufficient"
            ? Number(k === "insufficient")
            : k === signal.presence
              ? positiveP
              : k === negative
                ? 1 - positiveP
                : 0,
        ]),
      ),
    };
  }
  return { model, answers, usage: { input_tokens: 100, output_tokens: 10 } };
}

export const fakeClient = (respond) => ({
  systemOne: (request) => ({
    withResponse: async () => ({
      data: await respond(request),
      requestId: "synthetic",
    }),
  }),
});

const containsCase = (request, c) =>
  Object.values(c.files).some((text) =>
    request.state.sections.some(
      (s) => s.source.includes(text.trim()) || text.includes(s.source.trim()),
    ),
  );

export async function graderChecks(cases, { cut = 0.7 } = {}) {
  const checks = [];
  const graded = cases.filter((c) => expectedOf(c) !== "excluded");
  const run = async (respond) => {
    const out = mkdtempSync(join(tmpdir(), "jev-scanr-audit-"));
    try {
      const summary = await runEval({
        cases,
        client: fakeClient(respond),
        mode: "synthetic",
        capUSD: 1,
        out,
        cut,
        intervalMs: 0,
      });
      return {
        summary,
        ...readFlows(out, cases),
        out,
        files: (id, f) => join(out, id, "baseline", f),
      };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };
  const total = (summary, key) =>
    Object.values(summary.signals).reduce((n, s) => n + s[key], 0);
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  if (!graded.length)
    return [
      {
        name: "cases",
        pass: false,
        detail: "no graded cases (need actionable or no_action labels)",
      },
    ];

  const oracle = await run((request) => {
    const c = cases.find((k) => containsCase(request, k));
    return answerFor(request, c && expectedOf(c) === "positive" ? 0.95 : 0.05);
  });
  add(
    "oracle: answers copied from the labels score 100%",
    total(oracle.summary, "graded") === graded.length &&
      total(oracle.summary, "tp") + total(oracle.summary, "tn") ===
        graded.length,
    `${total(oracle.summary, "tp") + total(oracle.summary, "tn")} of ${graded.length} correct`,
  );
  const negative = await run((request) => answerFor(request, 0.05));
  const positives = graded.filter((c) => expectedOf(c) === "positive").length;
  add(
    "null: always-negative answers get zero recall and no false alarms",
    total(negative.summary, "tp") === 0 &&
      total(negative.summary, "fp") === 0 &&
      total(negative.summary, "fn") === positives,
    `recall 0 of ${positives}`,
  );
  const positive = await run((request) => answerFor(request, 0.95));
  const negatives = graded.length - positives;
  add(
    "null: always-positive answers get full recall and all false alarms",
    total(positive.summary, "fn") === 0 &&
      total(positive.summary, "fp") === negatives,
    `false positives ${total(positive.summary, "fp")} of ${negatives}`,
  );
  const abstain = await run((request) =>
    answerFor(request, 0, { choice: "insufficient" }),
  );
  add(
    "no answer is not a negative: model 'insufficient' is counted apart, never as tn/fn",
    total(abstain.summary, "graded") === 0 &&
      total(abstain.summary, "tn") + total(abstain.summary, "fn") === 0 &&
      total(abstain.summary, "abstained") === cases.length,
    `${total(abstain.summary, "abstained")} abstained, 0 graded`,
  );
  const broken = await run(() => {
    throw Error("induced API failure");
  });
  add(
    "an API error is an error row, not a zero grade",
    broken.rows.length === 0 &&
      broken.errors.length === 1 &&
      broken.errors[0].failure_class === "serving_error" &&
      broken.summary.stopped !== null,
    `stopped: ${broken.summary.stopped}`,
  );
  const wrong = await run((request) =>
    answerFor(request, 0.9, { model: "some-other-model" }),
  );
  add(
    "a different served model is rejected, not scored",
    wrong.rows.length === 0 &&
      wrong.errors[0]?.failure_class === "served_model_mismatch",
    wrong.errors[0]?.failure_class ?? "no error recorded",
  );
  return checks;
}
