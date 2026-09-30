import test from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "../src/core.mjs";
import {
  validateResponse,
  VALIDATION_POLICY,
  knownUsage,
} from "../src/validation.mjs";
import { plan, response, signalById, other } from "./helpers.mjs";

const request = (t) =>
  plan(t).requests.find((r) => "function_should_split" in r.request.questions)
    .request;

const failure = (req, mutate, code) => {
  const data = response(req);
  mutate(data);
  assert.throws(
    () => validateResponse(req, data),
    (e) => e.diagnostic?.code === code,
    code,
  );
};

const tweak = (req, id, choiceP, maxP, chosenIsPositive = true) => {
  const data = response(req),
    signal = signalById(id),
    keys = Object.keys(req.questions[id].criteria),
    negative = other(signal, keys);
  data.answers[id].choice = chosenIsPositive ? signal.presence : negative;
  data.answers[id].probabilities = Object.fromEntries(
    keys.map((k) => [
      k,
      k === (chosenIsPositive ? signal.presence : negative)
        ? choiceP
        : k === (chosenIsPositive ? negative : signal.presence)
          ? maxP
          : Math.max(0, 1 - choiceP - maxP),
    ]),
  );
  return data;
};

test("validation policy is fixed", () => {
  assert.deepEqual(VALIDATION_POLICY, {
    sumTolerance: 0.02,
    winnerEpsilon: 1e-9,
    winnerTolerance: 0.01,
  });
});

test("a chosen option within 0.01 of the maximum is accepted; further away is not", (t) => {
  const req = request(t),
    id = "function_should_split";
  validateResponse(req, tweak(req, id, 0.5, 0.5));
  validateResponse(req, tweak(req, id, 0.49, 0.5));
  assert.throws(
    () => validateResponse(req, tweak(req, id, 0.48, 0.5)),
    (e) =>
      e.diagnostic.code === "choice_winner_mismatch" &&
      e.diagnostic.observed.winnerTolerance === 0.01,
  );
});

test("structural problems are diagnosed by code without echoing values", (t) => {
  const req = request(t),
    id = "function_should_split";
  failure(req, (d) => delete d.model, "model_required");
  failure(req, (d) => (d.model = "other"), "unexpected_model");
  failure(req, (d) => delete d.usage, "usage_object_required");
  failure(req, (d) => (d.answers = {}), "answer_set_mismatch");
  failure(req, (d) => (d.answers[id].type = "text"), "choice_type_invalid");
  failure(req, (d) => (d.answers[id].choice = "nope"), "choice_enum_invalid");
  failure(
    req,
    (d) => (d.answers[id].confidence = 2),
    "choice_confidence_range",
  );
  failure(
    req,
    (d) => (d.answers[id].probabilities = { split_candidate: 1 }),
    "choice_distribution_keys",
  );
  failure(
    req,
    (d) => {
      const p = d.answers[id].probabilities;
      for (const k of Object.keys(p)) p[k] = 0.5;
    },
    "choice_distribution_sum",
  );
  failure(
    req,
    (d) => (d.answers[id].probabilities.split_candidate = 1.5),
    "choice_probability_range",
  );
  failure(
    req,
    (d) => (d.answers[id].probabilities.split_candidate = "x"),
    "choice_probability_type",
  );
});

test("usage must be finite integers within the provider limit", (t) => {
  const req = request(t);
  for (const count of [NaN, -1, 0.5, POLICY.maxInputTokens + 1])
    assert.throws(() =>
      validateResponse(req, {
        ...response(req),
        usage: { input_tokens: count, output_tokens: 0 },
      }),
    );
  assert.equal(
    knownUsage({ usage: { input_tokens: 5, output_tokens: 1 } }).input_tokens,
    5,
  );
  assert.equal(knownUsage({}), null);
  assert.equal(
    knownUsage({ usage: { input_tokens: -1, output_tokens: 0 } }),
    null,
  );
});
