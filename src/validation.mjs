import { POLICY } from "./core.mjs";

export const VALIDATION_POLICY = Object.freeze({
  sumTolerance: 0.02,
  winnerEpsilon: 1e-9,
  winnerTolerance: 0.01,
});
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function excerpt(value, allowed = []) {
  if (value === undefined) return { type: "missing" };
  if (value === null) return { type: "null" };
  if (typeof value === "number")
    return Number.isFinite(value) && Math.abs(value) <= 2
      ? { type: "number", value }
      : { type: "number", finite: Number.isFinite(value), valueRedacted: true };
  if (typeof value === "string")
    return allowed.includes(value)
      ? { type: "enum", value }
      : { type: "string", length: value.length, valueRedacted: true };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  return { type: typeof value, valueRedacted: true };
}

export class ResponseValidationError extends Error {
  constructor(code, signalId, jsonPath, expected, observed) {
    super(code);
    this.name = "ResponseValidationError";
    this.diagnostic = { code, signalId, jsonPath, expected, observed };
  }
}

export function knownUsage(data) {
  const u = data?.usage;
  return Number.isSafeInteger(u?.input_tokens) &&
    u.input_tokens >= 0 &&
    u.input_tokens <= POLICY.maxInputTokens &&
    Number.isSafeInteger(u.output_tokens) &&
    u.output_tokens >= 0
    ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens }
    : null;
}

export function validateResponse(request, data) {
  const fail = (code, signal, path, expected, value, allowed) => {
    throw new ResponseValidationError(
      code,
      signal,
      path,
      expected,
      excerpt(value, allowed),
    );
  };
  if (!object(data))
    fail("response_object_required", null, "$", "object", data);
  if (!own(data, "model"))
    fail("model_required", null, "$.model", POLICY.model, undefined);
  if (data.model !== POLICY.model)
    fail("unexpected_model", null, "$.model", POLICY.model, data.model);
  if (!object(data.usage))
    fail(
      "usage_object_required",
      null,
      "$.usage",
      "input_tokens and output_tokens object",
      data.usage,
    );
  for (const key of ["input_tokens", "output_tokens"]) {
    if (!own(data.usage, key))
      fail(
        "usage_field_required",
        null,
        `$.usage.${key}`,
        "nonnegative safe integer",
        undefined,
      );
    const value = data.usage[key];
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (key === "input_tokens" && value > POLICY.maxInputTokens)
    )
      fail(
        "usage_value_invalid",
        null,
        `$.usage.${key}`,
        key === "input_tokens"
          ? `integer 0..${POLICY.maxInputTokens}`
          : "nonnegative safe integer",
        value,
      );
  }
  if (!object(data.answers))
    fail(
      "answers_object_required",
      null,
      "$.answers",
      "object keyed by requested signal IDs",
      data.answers,
    );
  const requested = Object.keys(request.questions);
  const missing = requested.filter((id) => !own(data.answers, id));
  const unexpectedCount = Object.keys(data.answers).filter(
    (id) => !requested.includes(id),
  ).length;
  if (missing.length || unexpectedCount)
    throw new ResponseValidationError(
      "answer_set_mismatch",
      missing[0] ?? null,
      "$.answers",
      "exact requested signal set",
      { missingRequestedSignals: missing, unexpectedKeyCount: unexpectedCount },
    );
  for (const [id, q] of Object.entries(request.questions)) {
    const a = data.answers[id],
      base = `$.answers[${JSON.stringify(id)}]`,
      keys = Object.keys(q.criteria);
    if (!object(a))
      fail("choice_object_required", id, base, "Choice answer object", a);
    for (const key of ["type", "choice", "confidence", "probabilities"])
      if (!own(a, key))
        fail(
          "choice_field_required",
          id,
          `${base}.${key}`,
          "required field",
          undefined,
        );
    if (a.type !== "choice")
      fail("choice_type_invalid", id, `${base}.type`, "choice", a.type, [
        "choice",
      ]);
    if (!keys.includes(a.choice))
      fail("choice_enum_invalid", id, `${base}.choice`, keys, a.choice, keys);
    if (typeof a.confidence !== "number" || !Number.isFinite(a.confidence))
      fail(
        "choice_confidence_type",
        id,
        `${base}.confidence`,
        "finite number",
        a.confidence,
      );
    if (a.confidence < 0 || a.confidence > 1)
      fail(
        "choice_confidence_range",
        id,
        `${base}.confidence`,
        "0..1",
        a.confidence,
      );
    const p = a.probabilities;
    if (!object(p))
      fail(
        "choice_distribution_type",
        id,
        `${base}.probabilities`,
        "object with every criterion",
        p,
      );
    const missingKeys = keys.filter((k) => !own(p, k));
    const extra = Object.keys(p).filter((k) => !keys.includes(k)).length;
    if (missingKeys.length || extra)
      throw new ResponseValidationError(
        "choice_distribution_keys",
        id,
        `${base}.probabilities`,
        keys,
        { missingCriteria: missingKeys, unexpectedKeyCount: extra },
      );
    for (const key of keys) {
      if (typeof p[key] !== "number" || !Number.isFinite(p[key]))
        fail(
          "choice_probability_type",
          id,
          `${base}.probabilities[${JSON.stringify(key)}]`,
          "finite number",
          p[key],
        );
      if (p[key] < 0 || p[key] > 1)
        fail(
          "choice_probability_range",
          id,
          `${base}.probabilities[${JSON.stringify(key)}]`,
          "0..1",
          p[key],
        );
    }
    const sum = keys.reduce((n, k) => n + p[k], 0);
    if (Math.abs(sum - 1) > VALIDATION_POLICY.sumTolerance)
      throw new ResponseValidationError(
        "choice_distribution_sum",
        id,
        `${base}.probabilities`,
        { sum: 1, tolerance: VALIDATION_POLICY.sumTolerance },
        { sum },
      );
    const maximum = Math.max(...keys.map((k) => p[k]));
    if (
      p[a.choice] <
      maximum -
        VALIDATION_POLICY.winnerTolerance -
        VALIDATION_POLICY.winnerEpsilon
    )
      throw new ResponseValidationError(
        "choice_winner_mismatch",
        id,
        `${base}.choice`,
        "one of the maximum probability options",
        {
          choice: a.choice,
          choiceProbability: p[a.choice],
          maximumProbability: maximum,
          winnerEpsilon: VALIDATION_POLICY.winnerEpsilon,
          winnerTolerance: VALIDATION_POLICY.winnerTolerance,
        },
      );
  }
}
