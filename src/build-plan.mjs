import { hash, POLICY } from "./core.mjs";
import { readSnapshot } from "./snapshot.mjs";
import { buildIndex } from "./index.mjs";
import { makePack } from "./packs.mjs";
import { testConfigFacts } from "./config-facts.mjs";
import { formUnits, pseudoMember, lineWindows, UNIT_ORDER } from "./units.mjs";
import {
  catalog,
  packSignals,
  requestFor,
  packBudget,
  applyQuestionEligibility,
  questionEligibility,
  verifyPlan,
  PLAN_SCHEMA,
  SCANNER_VERSION,
} from "./plan.mjs";
import { catalogHashFor, selectSignals } from "./catalog.mjs";

const PROMPT = { promptFormat: "shared-rules-v1" };
const MIN_WINDOW_LINES = 5;

export function buildPlan(root, options = {}) {
  const enabledSignals = selectSignals(options.signals);
  const snapshot = readSnapshot(root, options),
    index = buildIndex(snapshot),
    limits = snapshot.limits,
    cap = limits.maxRequestBytes,
    hard = limits.maxHardRequestBytes;
  const generated = formUnits(index, {
    includeTests: !!options.retrieval?.includeTests,
    lowOverlap: options.retrieval?.lowOverlap,
    kinds: UNIT_ORDER.filter((kind) =>
      catalog.signals.some((s) => s.kinds.includes(kind)),
    ),
  });
  const bytes = (pack, subset = pack.signalSubset) => {
    const probe = {
      ...pack,
      status: "eligible",
      signalSubset: subset,
      contextVersion: "0.3.1",
    };
    probe.questionEligibility = questionEligibility(probe);
    return Buffer.byteLength(
      JSON.stringify(requestFor(probe, { includeIneligible: true })),
    );
  };
  const build = (unit, unitId) => ({
    ...makePack(unit, index, {
      budgetTrim: true,
      declarationCapNonDecisive: true,
      fits: (candidate) => bytes({ ...candidate, ...PROMPT }) <= cap,
    }),
    ...PROMPT,
    unitId,
  });
  const packs = [],
    manifest = [],
    omitted = [...generated.omitted],
    splits = {
      questionGroups: 0,
      lineWindows: 0,
      abstainedUnits: 0,
    };
  const finalize = (pack) => {
    pack.contextVersion = "0.3.1";
    applyQuestionEligibility(pack);
    pack.budget = packBudget(pack, limits);
    if (pack.status === "eligible" && pack.budget.serializedRequestBytes > hard)
      throw Error("Internal error: eligible pack exceeds the request cap");
    const { contentHash, ...body } = pack;
    pack.contentHash = hash(body);
    return pack;
  };
  const groupSignals = (pack, extraSplit) => {
    const probe = {
      ...pack,
      split: {
        ...extraSplit,
        questionGroup: 999,
        questionGroups: 999,
        unitId: pack.unitId,
      },
    };
    const ids = packSignals(pack).map((s) => s.id);
    if (ids.some((id) => bytes(probe, [id]) > hard)) return null;
    const groups = [[]];
    for (const id of ids) {
      const next = [...groups.at(-1), id];
      if (bytes(probe, next) <= hard) groups[groups.length - 1] = next;
      else groups.push([id]);
    }
    return groups;
  };
  const grouped = (pack, unitId, extraSplit = {}) => {
    const groups = groupSignals(pack, extraSplit);
    if (!groups) return null;
    return groups.map((signalSubset, i) =>
      finalize({
        ...structuredClone(pack),
        id: groups.length > 1 ? hash([pack.id, "question_group", i]) : pack.id,
        signalSubset,
        split: {
          ...extraSplit,
          questionGroup: i,
          questionGroups: groups.length,
          unitId,
        },
      }),
    );
  };
  const abstained = (pack, reason) => {
    pack.omitted.push({ what: "unit_request", reason, decisive: true });
    return finalize(pack);
  };
  const partsFor = (unit) => {
    let pack = build(unit, unit.id);
    if (bytes(pack) <= hard) return { parts: [finalize(pack)] };
    const groups = grouped(pack, unit.id);
    if (groups) return { parts: groups, groupedUnit: true };
    if (unit.kind !== "function")
      return {
        parts: [
          abstained(
            pack,
            unit.kind === "clone_pair"
              ? "members_exceed_request_cap_relational_not_splittable"
              : "focus_exceeds_request_cap",
          ),
        ],
        abstainedUnit: true,
      };
    const parts = [
      abstained(pack, "members_exceed_request_cap_whole_unit_signals_abstain"),
    ];
    const f = unit.members[0],
      module = index.modules.get(f.path);
    let maxLines = Math.max(MIN_WINDOW_LINES, Math.ceil(f.lines / 2)),
      chunks = null;
    while (!chunks) {
      const windows = lineWindows(module, f, maxLines);
      const candidates = windows.map((w, i) => {
        const id = hash(["function_chunk", unit.id, w.startLine, w.endLine]);
        const member = pseudoMember(module, {
          start: w.start,
          end: w.end,
          id: hash([f.id, "chunk", w.startLine, w.endLine]),
          name: f.name,
          parent: f.id,
        });
        const chunk = build(
          {
            kind: "function_chunk",
            id,
            members: [member],
            facts: {
              parentUnitId: unit.id,
              startLine: w.startLine,
              endLine: w.endLine,
              provenance: "line_window_of_oversized_function",
            },
          },
          unit.id,
        );
        chunk.split = {
          type: "line_window",
          window: i,
          windows: windows.length,
          startLine: w.startLine,
          endLine: w.endLine,
          unitId: unit.id,
        };
        return chunk;
      });
      if (
        candidates.every((c) => bytes(c) <= hard) ||
        maxLines === MIN_WINDOW_LINES
      )
        chunks = candidates;
      else maxLines = Math.max(MIN_WINDOW_LINES, Math.floor(maxLines / 2));
    }
    for (const chunk of chunks) {
      if (bytes(chunk) <= hard) parts.push(finalize(chunk));
      else
        parts.push(
          ...(grouped(chunk, unit.id, chunk.split) ?? [
            abstained(chunk, "line_window_exceeds_request_cap"),
          ]),
        );
    }
    return { parts, lineWindowed: true, abstainedUnit: true };
  };
  const locate = (unit) =>
    unit.members.map((m) => ({
      name: m.name ?? null,
      path: m.path,
      startLine: m.node.loc.start.line,
      endLine: m.node.loc.end.line,
    }));
  for (const o of generated.omitted.filter(
    (o) => o.reason === "candidate_limit" && o.unitId,
  ))
    manifest.push({
      unitId: o.unitId,
      kind: o.kind,
      signals: catalog.signals
        .filter((s) => s.kinds.includes(o.kind))
        .map((s) => s.id),
      disposition: "not_packed_candidate_limit",
      parts: 0,
      location: o.location,
    });
  for (const unit of generated.units) {
    const signals = catalog.signals
      .filter((s) => s.kinds.includes(unit.kind))
      .map((s) => s.id);
    const result = partsFor(unit);
    if (packs.length + result.parts.length > limits.maxCandidates) {
      manifest.push({
        unitId: unit.id,
        kind: unit.kind,
        signals,
        disposition: "not_packed_candidate_limit",
        parts: 0,
        location: locate(unit),
      });
      continue;
    }
    packs.push(...result.parts);
    manifest.push({
      unitId: unit.id,
      kind: unit.kind,
      signals,
      disposition: "packed",
      parts: result.parts.length,
    });
    if (result.groupedUnit) splits.questionGroups++;
    if (result.lineWindowed) splits.lineWindows++;
    if (result.abstainedUnit) splits.abstainedUnits++;
  }
  const requests = packs.flatMap((p) => {
    const { contentHash, ...body } = p;
    const request = requestFor(body);
    return request
      ? [
          {
            unitId: p.id,
            requestHash: hash(request),
            serializedBytes: Buffer.byteLength(JSON.stringify(request)),
            request,
          },
        ]
      : [];
  });
  const total = requests.reduce((n, r) => n + r.serializedBytes, 0);
  const plan = {
    schema: PLAN_SCHEMA,
    scannerVersion: SCANNER_VERSION,
    catalogVersion: catalog.version,
    catalogHash: catalogHashFor(enabledSignals),
    enabledSignals,
    root: snapshot.root,
    policy: POLICY,
    limits,
    excluded: snapshot.excluded,
    scope: { paths: snapshot.paths },
    retrieval: generated.options,
    configurationReading:
      "Bounded JSONC config data and proven static bindings; never require/eval target config",
    snapshot: { fingerprint: hash(snapshot.files), atomic: false },
    files: snapshot.files,
    coverage: {
      ...snapshot.coverage,
      ...generated.stats,
      nonTestHeuristicFunctions: index.functions.filter((f) => !f.test).length,
      parseAndIndexOmissions: index.errors,
      generatorOmissions: omitted,
      unitsNotPacked: manifest.filter((m) => m.disposition !== "packed").length,
      splits,
      packStatuses: Object.fromEntries(
        ["eligible", "insufficient_context"].map((s) => [
          s,
          packs.filter((p) => p.status === s).length,
        ]),
      ),
      meaning:
        "Deterministic code forms units and assembles context only. No deterministic score, rank, filter or fallback candidate exists in this tool.",
    },
    configFacts: {
      aliases: index.config.records,
      unresolved: index.config.unresolved,
      tests: testConfigFacts(index),
    },
    deterministicFacts: [],
    unitManifest: manifest,
    clusters: generated.clusters,
    units: packs,
    requests,
    estimates: {
      requests: requests.length,
      questions: requests.reduce(
        (n, r) => n + Object.keys(r.request.questions).length,
        0,
      ),
      serializedRequestBytes: total,
      heuristicInputTokensBytesDiv3: Math.ceil(total / 3),
      heuristicUSDBytesDiv3:
        (Math.ceil(total / 3) * POLICY.inputUSDPerMillion) / 1e6,
      USDOneBytePerTokenSensitivity: (total * POLICY.inputUSDPerMillion) / 1e6,
      fullProviderReservationUSD:
        (requests.length * POLICY.maxInputTokens * POLICY.inputUSDPerMillion) /
        1e6,
      invoiceVerified: false,
      notTokenizer: true,
    },
  };
  const sealed = { ...plan, planHash: hash(plan) };
  return verifyPlan(sealed);
}
