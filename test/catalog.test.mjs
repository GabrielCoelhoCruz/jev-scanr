import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  allSignals,
  catalog,
  defaultSignalIds,
  fullCatalog,
  selectSignals,
  STATUSES,
} from "../src/catalog.mjs";
import { UNIT_KINDS } from "../src/plan.mjs";

const RETIRED = [
  "clone_behavior_difference",
  "clone_variation_context",
  "sibling_failure_contract",
  "sibling_caller_context",
  "recovery_caller_observability",
  "recovery_feedback",
  "recovery_declared_fallback",
  "function_flag_parameter",
  "function_misleading_name",
  "function_inconsistent_returns",
  "comment_narrates_code",
  "comment_contradicts_code",
  "floating_promise",
  "unsafe_type_escape",
];

const passesGate = (e) => {
  const top = e.actionableAboveCut / e.reviewedAboveCut,
    below = e.reviewedBelowCut ? e.actionableBelowCut / e.reviewedBelowCut : 0;
  return e.actionableAboveCut >= 2 && top > below;
};

test("every signal file is a complete, versioned question with an explicit insufficient outcome", () => {
  const files = readdirSync(new URL("../signals/", import.meta.url)).filter(
    (f) => f.endsWith(".json"),
  );
  assert.equal(files.length, allSignals.length);
  for (const s of allSignals) {
    assert.match(s.id, /^[a-z][a-z0-9_]*$/);
    assert.match(s.version, /^\d+\.\d+\.\d+$/);
    assert.ok(STATUSES.includes(s.status), s.id);
    assert.ok(s.kinds.length && s.kinds.every((k) => UNIT_KINDS.includes(k)));
    assert.equal(s.primitive, "choice");
    assert.ok(s.question.includes("?"), s.id);
    assert.ok("insufficient" in s.criteria, s.id);
    assert.ok(s.presence in s.criteria && s.presence !== "insufficient");
    assert.ok(Object.values(s.criteria).every((v) => typeof v === "string"));
    assert.ok(Array.isArray(s.evidence), s.id);
    if (s.status === "default") assert.ok(s.evidence.length, s.id);
  }
});

test("only the signals that reached a default band in the independent test are on by default", () => {
  assert.deepEqual(defaultSignalIds, [
    "clone_same_policy",
    "function_should_split",
    "function_multiple_responsibilities",
  ]);
  assert.deepEqual(
    allSignals.filter((s) => s.status === "experimental").map((s) => s.id),
    [
      "magic_policy_literal",
      "internal_duplication",
      "unused_local_or_parameter",
      "deep_nesting",
      "unreachable_code",
    ],
  );
  assert.deepEqual(
    catalog.signals.map((s) => s.id),
    defaultSignalIds,
  );
});

test("every signal records its independent test, and a default needs at least 8 reviewed cells at 30% or more", () => {
  for (const s of allSignals) {
    const t = s.independentTest;
    assert.ok(t, s.id);
    assert.equal(t.questionVersion, s.version, s.id);
    assert.ok(t.actionableAboveCut <= t.reviewedAboveCut, s.id);
    const ok =
      t.reviewedAboveCut >= 8 &&
      t.actionableAboveCut / t.reviewedAboveCut >= 0.3;
    if (s.status === "default")
      assert.ok(ok, `${s.id} is default below the gate band`);
    else if (s.id !== "unreachable_code" && t.reviewedAboveCut >= 8)
      assert.ok(
        t.actionableAboveCut / t.reviewedAboveCut < 0.3,
        `${s.id} passed the band but is experimental`,
      );
  }
});

test("a signal is on by default only if its recorded evidence passes the gate", () => {
  for (const s of allSignals) {
    const ok = s.evidence.some(passesGate);
    if (s.status === "default")
      assert.ok(ok, `${s.id} is default without passing evidence`);
    for (const e of s.evidence)
      assert.equal(
        e.questionVersion,
        s.version,
        `${s.id}: evidence belongs to another version of the question`,
      );
    for (const e of s.evidence)
      assert.ok(
        e.actionableAboveCut <= e.reviewedAboveCut &&
          e.reviewedAboveCut <= e.aboveCutInFullRun &&
          e.actionableBelowCut <= e.reviewedBelowCut,
        s.id,
      );
  }
  assert.ok(
    !passesGate(
      allSignals.find((s) => s.id === "unreachable_code").evidence[0],
    ),
  );
});

test("retired signals are documented with evidence and absent from the catalog", () => {
  const retired = readFileSync(
    new URL("../signals/retired.md", import.meta.url),
    "utf8",
  );
  for (const id of RETIRED) {
    assert.ok(retired.includes(`\`${id}\``), id);
    assert.ok(!fullCatalog.signals.some((s) => s.id === id), id);
  }
});

test("signal selection is validated and restores the defaults", () => {
  assert.throws(() => selectSignals(["nope"]));
  assert.throws(() => selectSignals([]));
  assert.throws(() => selectSignals(["deep_nesting", "deep_nesting"]));
  assert.deepEqual(selectSignals(["unreachable_code", "deep_nesting"]), [
    "deep_nesting",
    "unreachable_code",
  ]);
  selectSignals();
  assert.deepEqual(
    catalog.signals.map((s) => s.id),
    defaultSignalIds,
  );
});
