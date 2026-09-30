import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  readFileSync,
  mkdirSync,
  openSync,
  appendFileSync,
  fsyncSync,
  closeSync,
  unlinkSync,
  fstatSync,
  constants,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { hash, POLICY, outside, syncDirectory, writeNew } from "./core.mjs";
import { verifyPlan } from "./plan.mjs";
import {
  knownUsage,
  validateResponse,
  ResponseValidationError,
} from "./validation.mjs";
export { knownUsage, validateResponse } from "./validation.mjs";

export const reservationUSD =
  (POLICY.maxInputTokens * POLICY.inputUSDPerMillion) / 1e6;

export function makeClient({ fetch, apiKey } = {}) {
  const client = new TypeSafeClient({
    apiKey: fetch ? "SYNTHETIC-OFFLINE-NOT-A-KEY" : apiKey,
    baseURL: "https://api.typesafe.ai",
    defaultModel: POLICY.model,
    timeout: POLICY.timeoutMs,
    retry: { maxRetries: 0 },
    logLevel: "off",
    ...(fetch ? { fetch } : {}),
  });
  if (
    client.retry.maxRetries !== 0 ||
    client.logLevel !== "off" ||
    client.baseURL !== "https://api.typesafe.ai"
  )
    throw Error("Unsafe SDK configuration");
  return client;
}

export function readJournal(directory, plan, descriptor) {
  const path = join(directory, "journal.jsonl");
  let fd = descriptor,
    text;
  try {
    if (fd === undefined) {
      try {
        lstatSync(path);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    }
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1)
      throw Error("WAL must be a single-link regular file");
    text = readFileSync(fd, "utf8");
  } finally {
    if (descriptor === undefined && fd !== undefined) closeSync(fd);
  }
  if (!text.length) return [];
  if (!text.endsWith("\n")) throw Error("Incomplete WAL tail; refuse resume");
  let previousHash = null;
  const events = text
    .trim()
    .split("\n")
    .map((line, seq) => {
      const event = JSON.parse(line),
        { eventHash, ...body } = event;
      if (
        body.seq !== seq ||
        body.previousHash !== previousHash ||
        eventHash !== hash(body)
      )
        throw Error("WAL integrity failure");
      previousHash = eventHash;
      return event;
    });
  if (
    !["live", "synthetic"].includes(events[0]?.mode) ||
    events[0].type !== "initialized" ||
    events[0].planHash !== plan.planHash
  )
    throw Error("WAL plan/mode mismatch");
  const requests = new Map(plan.requests.map((r) => [r.unitId, r]));
  const reserved = new Set(),
    finished = new Set();
  let pending = null,
    terminal = false;
  for (const event of events.slice(1)) {
    if (terminal) throw Error("Events after terminal WAL state");
    if (event.type === "reserved") {
      if (
        pending ||
        reserved.has(event.unitId) ||
        event.requestHash !== requests.get(event.unitId)?.requestHash ||
        event.clientRequestId !== hash([plan.planHash, event.unitId]) ||
        event.reservedUSD !== reservationUSD
      )
        throw Error("Invalid WAL reservation");
      reserved.add(event.unitId);
      pending = event.unitId;
    } else if (event.type === "finished") {
      if (
        pending !== event.unitId ||
        finished.has(event.unitId) ||
        !["succeeded", "failed"].includes(event.status)
      )
        throw Error("Invalid WAL completion");
      if (event.status === "succeeded") {
        validateResponse(requests.get(event.unitId).request, event.response);
        if (hash(event.usage) !== hash(knownUsage(event.response)))
          throw Error("WAL usage mismatch");
      }
      finished.add(event.unitId);
      pending = null;
    } else if (event.type === "stopped") terminal = true;
    else if (
      event.type === "complete" &&
      !pending &&
      finished.size === plan.requests.length
    )
      terminal = true;
    else throw Error("Unexpected WAL event");
  }
  return events;
}

export function summarize(events, plan) {
  const attempts = events.filter((e) => e.type === "reserved"),
    finished = events.filter((e) => e.type === "finished");
  const succeeded = finished.filter((e) => e.status === "succeeded").length;
  const unknownAttempts =
    attempts.length - finished.filter((e) => e.usage !== null).length;
  const knownInputTokens = finished.reduce(
    (n, e) => n + (e.usage?.input_tokens ?? 0),
    0,
  );
  const knownOutputTokens = finished.reduce(
    (n, e) => n + (e.usage?.output_tokens ?? 0),
    0,
  );
  const knownEstimatedUSD =
    (knownInputTokens * POLICY.inputUSDPerMillion) / 1e6;
  return {
    mode: events[0]?.mode ?? "not_run",
    usageProvenance: !events.length
      ? "No inference or provider usage; all request outcomes are pending."
      : events[0]?.mode === "synthetic"
        ? "Scripted fake usage; financial amounts below only exercise budget arithmetic. Real API requests and paid inference cost are zero."
        : "Provider-returned usage at configured tariff; not an invoice",
    realAPIRequests: events[0]?.mode === "live" ? null : 0,
    networkCountMeaning:
      "A reservation may precede a crash before dispatch. SDK errors may occur before sending. Exact network count is not asserted for live runs.",
    plannedRequests: plan.requests.length,
    reservedAttempts: attempts.length,
    dispatchesWithRecordedOutcome: finished.length,
    unresolvedReservations: attempts.length - finished.length,
    succeeded,
    failed: finished.length - succeeded,
    unknownAttempts,
    unattempted: plan.requests.length - attempts.length,
    complete: succeeded === plan.requests.length && unknownAttempts === 0,
    knownInputTokens,
    knownOutputTokens,
    knownEstimatedUSD,
    estimatedTotalUSD: unknownAttempts ? null : knownEstimatedUSD,
    invoiceVerified: false,
    reservedUnknownUSD: unknownAttempts * reservationUSD,
    budgetAccountedUSD: knownEstimatedUSD + unknownAttempts * reservationUSD,
    stoppedReason: events.find((e) => e.type === "stopped")?.reason ?? null,
    elapsedRequestMs: finished.reduce((n, e) => n + e.latencyMs, 0),
    concurrency: 1,
    sdkRetries: 0,
  };
}

export async function runPlan({
  plan,
  directory,
  client,
  mode,
  capUSD,
  afterReserve,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock = Date.now,
  intervalMs = POLICY.minIntervalMs,
}) {
  verifyPlan(plan);
  if (
    !["synthetic", "live"].includes(mode) ||
    !Number.isFinite(capUSD) ||
    capUSD <= 0
  )
    throw Error("Explicit mode and positive cap required");
  directory = outside(plan.root, directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "exclusive.lock");
  writeNew(lock, {
    pid: process.pid,
    instruction:
      "Never remove until process is stopped; inspect WAL for unknown attempts first.",
  });
  const path = join(directory, "journal.jsonl");
  let journalFD;
  try {
    journalFD = openSync(
      path,
      constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const events = readJournal(directory, plan, journalFD);
    if (
      events.length &&
      (events[0].mode !== mode || events[0].capUSD !== capUSD)
    )
      throw Error("Run mode/cap is immutable");
    const stats = summarize(events, plan);
    if (
      events.some(
        (e) =>
          e.type === "stopped" ||
          (e.type === "finished" && e.status === "failed"),
      ) ||
      events.filter((e) => e.type === "reserved").length !==
        events.filter((e) => e.type === "finished").length
    )
      throw Error("Unknown or stopped attempt; automatic retry refused");
    if (events.some((e) => e.type === "complete")) return stats;
    const append = (fields) => {
      const body = {
        seq: events.length,
        previousHash: events.at(-1)?.eventHash ?? null,
        ...fields,
      };
      const event = { ...body, eventHash: hash(body) };
      appendFileSync(journalFD, JSON.stringify(event) + "\n");
      fsyncSync(journalFD);
      if (!events.length) syncDirectory(directory);
      events.push(event);
    };
    if (!events.length)
      append({
        type: "initialized",
        planHash: plan.planHash,
        mode,
        capUSD,
        policy: POLICY,
        recordedAt: new Date().toISOString(),
      });
    const done = new Set(
      events.filter((e) => e.type === "finished").map((e) => e.unitId),
    );
    let accounted = stats.budgetAccountedUSD,
      lastStart = clock();
    for (const item of plan.requests) {
      if (done.has(item.unitId)) continue;
      if (accounted + reservationUSD > capUSD) {
        append({ type: "stopped", reason: "budget_reservation_exceeds_cap" });
        break;
      }
      await sleep(Math.max(0, intervalMs - (clock() - lastStart)));
      append({
        type: "reserved",
        unitId: item.unitId,
        requestHash: item.requestHash,
        clientRequestId: hash([plan.planHash, item.unitId]),
        reservedUSD: reservationUSD,
        recordedAt: new Date().toISOString(),
      });
      if (afterReserve) await afterReserve(item);
      lastStart = clock();
      const started = performance.now();
      let data = null,
        response,
        requestId = null,
        failure = null;
      try {
        const result = await client.systemOne(item.request).withResponse();
        data = result.data;
        requestId =
          typeof result.requestId === "string" &&
          result.requestId.length <= 4096
            ? hash(result.requestId)
            : null;
        validateResponse(item.request, data);
        response = {
          model: data.model,
          answers: Object.fromEntries(
            Object.entries(data.answers).map(([id, a]) => [
              id,
              {
                type: a.type,
                choice: a.choice,
                confidence: a.confidence,
                probabilities: a.probabilities,
              },
            ]),
          ),
          usage: knownUsage(data),
        };
      } catch (error) {
        failure = {
          kind:
            error instanceof ResponseValidationError
              ? "response_validation"
              : "transport_error",
          validation:
            error instanceof ResponseValidationError
              ? error.diagnostic.code
              : null,
          diagnostic:
            error instanceof ResponseValidationError ? error.diagnostic : null,
          requestHash: item.requestHash,
          unitId: item.unitId,
          sourcePath: item.request.state.path,
          httpStatus:
            Number.isInteger(error.status) &&
            error.status >= 100 &&
            error.status <= 599
              ? error.status
              : null,
          rawErrorOmitted:
            "Error messages/headers/body may contain secrets; deliberately not persisted",
        };
      }
      const usage = knownUsage(data);
      append({
        type: "finished",
        unitId: item.unitId,
        status: failure ? "failed" : "succeeded",
        serverRequestId: null,
        serverRequestIdHash: requestId,
        latencyMs: performance.now() - started,
        usage,
        response: response ?? null,
        rawResponseHash: data ? hash(data) : null,
        failure,
        rawResultPolicy:
          "Preserves model, raw answer fields and usage; unknown fields and invalid payloads omitted to avoid credential echoes",
      });
      if (failure) {
        append({ type: "stopped", reason: "first_error" });
        break;
      }
      accounted += (usage.input_tokens * POLICY.inputUSDPerMillion) / 1e6;
    }
    const result = summarize(events, plan);
    if (result.complete) append({ type: "complete" });
    return result;
  } finally {
    if (journalFD !== undefined) closeSync(journalFD);
    unlinkSync(lock);
    syncDirectory(directory);
  }
}
