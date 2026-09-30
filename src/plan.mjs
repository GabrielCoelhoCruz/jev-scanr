import { hash, POLICY, secretLike } from "./core.mjs";
import { catalog, catalogHash, question, selectSignals } from "./catalog.mjs";
import { LIMITS, safeRelative } from "./snapshot.mjs";

export { catalog };
export const UNIT_KINDS = ["function", "function_chunk", "clone_pair"];
export function packSignals(pack) {
  return catalog.signals.filter(
    (s) =>
      s.kinds.includes(pack.kind) &&
      (!pack.signalSubset || pack.signalSubset.includes(s.id)),
  );
}
export function questionEligibility(pack) {
  return Object.fromEntries(
    packSignals(pack).map((signal) => {
      const missingReasons = [
        ...new Set(pack.omitted.filter((o) => o.decisive).map((o) => o.reason)),
      ].sort();
      return [
        signal.id,
        {
          status: missingReasons.length ? "insufficient_context" : "eligible",
          missingReasons,
          provenance: "bounded_static_requirements_not_semantic_certification",
        },
      ];
    }),
  );
}
export function applyQuestionEligibility(pack) {
  pack.questionEligibility = questionEligibility(pack);
  pack.status = Object.values(pack.questionEligibility).some(
    (c) => c.status === "eligible",
  )
    ? "eligible"
    : "insufficient_context";
}
export function requestFor(pack, { includeIneligible = false } = {}) {
  if (pack.status !== "eligible") return null;
  const selectedSignals = packSignals(pack).filter(
    (s) =>
      includeIneligible ||
      !pack.questionEligibility ||
      pack.questionEligibility[s.id]?.status === "eligible",
  );
  if (!selectedSignals.length) return null;
  const reference = ({
    path,
    range,
    role,
    name,
    symbol,
    meaning,
    provenance,
  }) => ({
    path,
    range,
    role,
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(meaning ? { meaning } : {}),
    ...(provenance ? { provenance } : {}),
  });
  const state = {
    path: pack.members[0].path,
    kind: pack.kind,
    members: pack.members.map(reference),
    catchRange: pack.catchRange ?? null,
    sections: pack.sections.map(
      ({ path, range, roles, focusRanges, source }) => ({
        path,
        range,
        roles,
        focusRanges,
        source,
      }),
    ),
    callers: pack.callers.map(reference),
    dependencies: pack.dependencies.map(reference),
    testReferences: pack.testReferences.map(reference),
    evaluationRules: catalog.commonInstructions,
    ...(pack.split ? { unitSplit: pack.split } : {}),
    omitted: pack.omitted.map((o) =>
      pack.questionEligibility && o.decisive
        ? {
            ...o,
            signalsAffected: packSignals(pack)
              .filter((s) =>
                pack.questionEligibility[s.id].missingReasons.includes(
                  o.reason,
                ),
              )
              .map((s) => s.id),
          }
        : o,
    ),
    uncertainties: pack.uncertainties,
  };
  return {
    model: POLICY.model,
    state,
    questions: Object.fromEntries(
      selectedSignals.map((s) => [s.id, question(s)]),
    ),
  };
}
export function packBudget(pack, limits) {
  const request =
      requestFor({ ...pack, status: "eligible" }) ??
      requestFor({ ...pack, status: "eligible" }, { includeIneligible: true }),
    serializedBytes = Buffer.byteLength(JSON.stringify(request));
  return {
    serializedRequestBytes: serializedBytes,
    heuristicInputTokensBytesDiv3: Math.ceil(serializedBytes / 3),
    heuristicTargetTokens: 6000,
    notTokenizer: true,
    hardByteCap: limits.maxHardRequestBytes ?? limits.maxRequestBytes,
    providerInputTokenCap: POLICY.maxInputTokens,
    providerStatePlusLongestQuestionTokenCap: 32768,
    statePlusLongestQuestionBytes:
      Buffer.byteLength(JSON.stringify(request.state)) +
      Math.max(
        ...Object.values(request.questions).map((q) =>
          Buffer.byteLength(JSON.stringify(q)),
        ),
      ),
  };
}
function verifyUnitManifest(plan) {
  const fail = () => {
    throw Error("Unit manifest integrity mismatch");
  };
  if (!Array.isArray(plan.unitManifest)) fail();
  const units = new Map();
  for (const u of plan.unitManifest) {
    const expected = catalog.signals
      .filter((s) => s.kinds.includes(u.kind))
      .map((s) => s.id);
    if (
      units.has(u.unitId) ||
      !["packed", "not_packed_candidate_limit"].includes(u.disposition) ||
      hash(u.signals) !== hash(expected)
    )
      fail();
    units.set(u.unitId, u);
  }
  const byUnit = new Map();
  for (const p of plan.units) {
    const u = units.get(p.unitId);
    if (!u || u.disposition !== "packed") fail();
    if (!byUnit.has(p.unitId)) byUnit.set(p.unitId, []);
    byUnit.get(p.unitId).push(p);
  }
  const ids = (p) => packSignals(p).map((s) => s.id);
  const sameSet = (a, b) =>
    a.length === b.length &&
    new Set(a).size === a.length &&
    a.every((x) => b.includes(x));
  const partition = (list, baseId, allowed) => {
    const n = list[0].split?.questionGroups;
    if (
      !Number.isSafeInteger(n) ||
      list.length !== n ||
      list.some((p) => p.split?.questionGroups !== n)
    )
      fail();
    if (
      hash(list.map((p) => p.split.questionGroup).sort((a, b) => a - b)) !==
      hash([...Array(n).keys()])
    )
      fail();
    for (const p of list)
      if (
        p.id !==
        (n > 1
          ? hash([baseId, "question_group", p.split.questionGroup])
          : baseId)
      )
        fail();
    if (!sameSet(list.flatMap(ids), allowed)) fail();
  };
  const chunkable = catalog.signals
    .filter((s) => s.kinds.includes("function_chunk"))
    .map((s) => s.id);
  for (const u of units.values()) {
    const list = byUnit.get(u.unitId) ?? [];
    if (u.disposition !== "packed") {
      if (list.length || u.parts !== 0) fail();
      continue;
    }
    if (!list.length || list.length !== u.parts) fail();
    if (
      list.some(
        (p) =>
          (p.kind !== u.kind &&
            !(u.kind === "function" && p.kind === "function_chunk")) ||
          (p.split && p.split.unitId !== u.unitId),
      )
    )
      fail();
    const chunks = list.filter((p) => p.kind === "function_chunk"),
      main = list.filter((p) => p.kind !== "function_chunk");
    if (!chunks.length) {
      if (main.length === 1 && !main[0].split) {
        if (
          main[0].id !== u.unitId ||
          main[0].signalSubset !== undefined ||
          !sameSet(ids(main[0]), u.signals)
        )
          fail();
      } else if (main.some((p) => !p.split || p.split.type !== undefined))
        fail();
      else partition(main, u.unitId, u.signals);
      continue;
    }
    const parent = main[0];
    if (
      u.kind !== "function" ||
      main.length !== 1 ||
      parent.id !== u.unitId ||
      parent.split ||
      parent.signalSubset !== undefined ||
      parent.status !== "insufficient_context" ||
      !parent.omitted.some(
        (o) =>
          o.decisive &&
          o.reason === "members_exceed_request_cap_whole_unit_signals_abstain",
      )
    )
      fail();
    const windows = new Map();
    for (const c of chunks) {
      if (
        c.split?.type !== "line_window" ||
        c.split.windows !== chunks[0].split.windows
      )
        fail();
      if (!windows.has(c.split.window)) windows.set(c.split.window, []);
      windows.get(c.split.window).push(c);
    }
    const count = chunks[0].split.windows;
    if (
      hash([...windows.keys()].sort((a, b) => a - b)) !==
      hash([...Array(count).keys()])
    )
      fail();
    let next = parent.members[0].range.startLine;
    for (let w = 0; w < count; w++) {
      const packs = windows.get(w),
        { startLine, endLine } = packs[0].split;
      if (
        packs.some(
          (p) => p.split.startLine !== startLine || p.split.endLine !== endLine,
        ) ||
        startLine !== next ||
        endLine < startLine
      )
        fail();
      next = endLine + 1;
      const base = hash(["function_chunk", u.unitId, startLine, endLine]);
      if (packs.length === 1 && packs[0].split.questionGroup === undefined) {
        if (packs[0].id !== base || !sameSet(ids(packs[0]), chunkable)) fail();
      } else partition(packs, base, chunkable);
    }
    if (next !== parent.members[0].range.endLine + 1) fail();
  }
}
export const PLAN_SCHEMA = "semantic-refactor-scan-plan/1";
export const SCANNER_VERSION = "0.2.1-alpha";
export const COMPATIBLE_PLAN_VERSIONS = [
  "0.1.0-alpha",
  "0.1.1",
  "0.2.0-alpha",
  SCANNER_VERSION,
];

export function verifyPlan(plan) {
  const { planHash, ...body } = plan;
  if (
    planHash !== hash(body) ||
    plan.schema !== PLAN_SCHEMA ||
    !COMPATIBLE_PLAN_VERSIONS.includes(plan.scannerVersion) ||
    plan.catalogHash !== catalogHash ||
    hash(plan.policy) !== hash(POLICY)
  )
    throw Error("Plan/version integrity mismatch");
  selectSignals(plan.enabledSignals);
  if (
    plan.scope !== undefined &&
    (!Array.isArray(plan.scope.paths) ||
      plan.scope.paths.some((x) => !safeRelative(x)))
  )
    throw Error("Plan scope invalid");
  if (
    !plan.limits ||
    hash(Object.keys(plan.limits).sort()) !==
      hash(
        Object.keys(LIMITS)
          .filter(
            (k) =>
              k !== "maxHardRequestBytes" ||
              plan.scannerVersion !== "0.1.0-alpha",
          )
          .sort(),
      )
  )
    throw Error("Complete exact limit schema required");
  if (
    !Array.isArray(plan.units) ||
    plan.units.length > plan.limits.maxCandidates
  )
    throw Error("Pack count exceeds limit");
  if (new Set(plan.units.map((p) => p.id)).size !== plan.units.length)
    throw Error("Duplicate pack");
  for (const [key, value] of Object.entries(plan.limits))
    if (
      !(key in LIMITS) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > LIMITS[key]
    )
      throw Error("Invalid plan limit");
  const files = new Map(
    plan.files.filter((f) => f.status === "read").map((f) => [f.path, f]),
  );
  const validPath = (path) =>
    safeRelative(path) &&
    !plan.excluded.some((p) => path === p || path.startsWith(p + "/"));
  const validRange = (r) =>
    r &&
    ["startOffset", "endOffset", "startLine", "endLine"].every((k) =>
      Number.isSafeInteger(r[k]),
    ) &&
    r.startOffset >= 0 &&
    r.endOffset > r.startOffset &&
    r.startLine > 0 &&
    r.endLine >= r.startLine &&
    r.encoding === "UTF-16" &&
    r.endExclusive === true;
  const validReference = (r) =>
    r &&
    validPath(r.path) &&
    validRange(r.range) &&
    r.fileSHA256 === files.get(r.path)?.sha256 &&
    typeof r.role === "string";
  const requests = [];
  for (const pack of plan.units) {
    const { contentHash, ...base } = pack;
    if (contentHash !== hash(base)) throw Error("Pack integrity mismatch");
    if (!UNIT_KINDS.includes(pack.kind)) throw Error("Unknown pack kind");
    if (
      pack.promptFormat !== "shared-rules-v1" ||
      typeof pack.unitId !== "string" ||
      (pack.signalSubset !== undefined &&
        (!Array.isArray(pack.signalSubset) ||
          !pack.signalSubset.length ||
          pack.signalSubset.some(
            (id) =>
              !catalog.signals.some(
                (s) => s.id === id && s.kinds.includes(pack.kind),
              ),
          )))
    )
      throw Error("Unit mode fields invalid");
    if (!["eligible", "insufficient_context"].includes(pack.status))
      throw Error("Unknown pack status");
    if (
      !Array.isArray(pack.members) ||
      !Array.isArray(pack.sections) ||
      !Array.isArray(pack.omitted)
    )
      throw Error("Pack structure missing");
    if (pack.members.length !== (pack.kind === "clone_pair" ? 2 : 1))
      throw Error("Wrong member count");
    if (pack.members.some((r) => !validReference(r)))
      throw Error("Invalid member reference");
    for (const [key, cap] of [
      ["callers", "maxCallers"],
      ["dependencies", "maxImports"],
      ["testReferences", "maxTests"],
    ])
      if (
        !Array.isArray(pack[key]) ||
        pack[key].length > plan.limits[cap] ||
        pack[key].some((r) => !validReference(r))
      )
        throw Error("Invalid bounded reference");
    const trims = pack.omitted.filter(
      (o) => o.reason === "request_byte_budget_trim",
    ).length;
    if (
      pack.omitted.some(
        (o) => o.reason === "import_declaration_cap" && o.decisive !== false,
      ) ||
      pack.facts?.budgetTrim?.trimmedReferences !== trims
    )
      throw Error("Context policy flags disagree with pack omissions");
    const expectedQuestions = questionEligibility(pack);
    const expectedStatus = Object.values(expectedQuestions).some(
      (c) => c.status === "eligible",
    )
      ? "eligible"
      : "insufficient_context";
    if (
      pack.contextVersion !== "0.3.1" ||
      hash(pack.questionEligibility) !== hash(expectedQuestions) ||
      pack.status !== expectedStatus
    )
      throw Error("Question eligibility integrity mismatch");
    for (const section of pack.sections) {
      if (
        !validPath(section.path) ||
        !validRange(section.range) ||
        section.fileSHA256 !== files.get(section.path)?.sha256 ||
        !Array.isArray(section.roles) ||
        !Array.isArray(section.focusRanges)
      )
        throw Error("Invalid source reference");
      if (section.source === undefined) throw Error("Source missing");
      if (
        typeof section.source !== "string" ||
        hash(section.source) !== section.sourceSHA256 ||
        section.source.length !==
          section.range.endOffset - section.range.startOffset ||
        secretLike(section.source)
      )
        throw Error("Unsafe or changed source");
    }
    if (pack.status === "eligible")
      for (const r of [
        ...pack.members,
        ...pack.callers,
        ...pack.dependencies,
        ...pack.testReferences,
      ])
        if (
          !pack.sections.some(
            (s) =>
              s.path === r.path &&
              typeof s.source === "string" &&
              s.range.startOffset <= r.range.startOffset &&
              s.range.endOffset >= r.range.endOffset &&
              s.roles.includes(r.role) &&
              s.focusRanges.some(
                (f) =>
                  f.role === r.role &&
                  f.startOffset === r.range.startOffset &&
                  f.endOffset === r.range.endOffset,
              ),
          )
        )
          throw Error("Uncovered required reference");
    const request = requestFor(base);
    if (!request) continue;
    const serializedBytes = Buffer.byteLength(JSON.stringify(request));
    if (
      serializedBytes >
        (plan.limits.maxHardRequestBytes ?? plan.limits.maxRequestBytes) ||
      serializedBytes > (LIMITS.maxHardRequestBytes ?? LIMITS.maxRequestBytes)
    )
      throw Error("Oversized request");
    requests.push({
      unitId: pack.id,
      requestHash: hash(request),
      serializedBytes,
      request,
    });
  }
  verifyUnitManifest(plan);
  if (hash(requests) !== hash(plan.requests))
    throw Error("Request matrix mismatch");
  return plan;
}
