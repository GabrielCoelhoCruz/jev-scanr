import { hash } from "./core.mjs";
import { VALIDATION_POLICY } from "./validation.mjs";
import { verifyPlan, catalog, packSignals } from "./plan.mjs";
import { defaultCut, defaultFloor } from "./cuts.mjs";

export function resolveThresholds(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw Error("Thresholds must be an object");
  const thresholds = Object.fromEntries(
    catalog.signals.map((s) => [s.id, defaultCut(s.id)]),
  );
  for (const [id, value] of Object.entries(overrides)) {
    if (!(id in thresholds)) throw Error("Unknown signal in thresholds");
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw Error("Threshold must be within [0, 1]");
    thresholds[id] = value;
  }
  return thresholds;
}

export const BAND_MEANING =
  "worth_a_look: P at or above the signal's cut. uncertain: P at or above the floor and below the cut. below: P under the floor, listed in report.json only. Bands sort cells for reading; they are not calibrated probabilities. See docs/BANDS.md.";

export function resolveFloors(thresholds, overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw Error("Floors must be an object");
  const floors = Object.fromEntries(
    Object.entries(thresholds).map(([id, cut]) => [
      id,
      Math.min(defaultFloor(id), cut),
    ]),
  );
  for (const [id, value] of Object.entries(overrides)) {
    if (!(id in floors)) throw Error("Unknown signal in floors");
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw Error("Floor must be within [0, 1]");
    floors[id] = value;
  }
  for (const [id, floor] of Object.entries(floors))
    if (floor > thresholds[id])
      throw Error(
        `Floor ${floor} for ${id} is above its cut ${thresholds[id]}`,
      );
  return floors;
}

const bandOf = (p, cut, floor) =>
  p === null
    ? null
    : p >= cut
      ? "worth_a_look"
      : p >= floor
        ? "uncertain"
        : "below";

function nearTie(answer) {
  if (!answer) return {};
  const maximum = Math.max(...Object.values(answer.probabilities)),
    own = answer.probabilities[answer.choice];
  return own < maximum - VALIDATION_POLICY.winnerEpsilon
    ? { near_tie: true, choiceProbability: own, maximumProbability: maximum }
    : {};
}
const tieFields = ({ near_tie, choiceProbability, maximumProbability }) =>
  near_tie ? { near_tie, choiceProbability, maximumProbability } : {};

const locate = (pack) =>
  pack.members.map((m) => ({
    name: m.name ?? null,
    path: m.path,
    startLine: m.range.startLine,
    endLine: m.range.endLine,
    role: m.role,
  }));

export function buildReport(
  plan,
  events = [],
  { thresholds: overrides = {}, floors: floorOverrides = {} } = {},
) {
  verifyPlan(plan);
  const thresholds = resolveThresholds(overrides);
  const floors = resolveFloors(thresholds, floorOverrides);
  const outcomes = new Map(
    events.filter((e) => e.type === "finished").map((e) => [e.unitId, e]),
  );
  const provenance = events[0]?.mode ?? "not_run";
  const cells = [];
  for (const pack of plan.units)
    for (const signal of packSignals(pack)) {
      const eligibility = pack.questionEligibility[signal.id];
      const event = outcomes.get(pack.id);
      const answer =
        eligibility.status === "eligible" && event?.status === "succeeded"
          ? (event.response.answers[signal.id] ?? null)
          : null;
      const status =
        eligibility.status !== "eligible"
          ? "insufficient_context"
          : !event
            ? "unattempted"
            : event.status === "failed"
              ? "error"
              : !answer
                ? "unanswered"
                : answer.choice === "insufficient"
                  ? "model_insufficient"
                  : "scored";
      const p =
        status === "scored"
          ? (answer.probabilities[signal.presence] ?? null)
          : null;
      cells.push({
        packId: pack.id,
        unitId: pack.unitId,
        kind: pack.kind,
        split: pack.split ?? null,
        signalId: signal.id,
        signalVersion: signal.version,
        signalStatus: signal.status,
        status,
        choice: answer?.choice ?? null,
        ...nearTie(answer),
        confidence: answer?.confidence ?? null,
        positiveOption: signal.presence,
        pPositive: p,
        threshold: thresholds[signal.id],
        floor: floors[signal.id],
        band: bandOf(p, thresholds[signal.id], floors[signal.id]),
        shown: p !== null && p >= thresholds[signal.id],
        missingReasons: eligibility.missingReasons,
      });
    }
  const packById = new Map(plan.units.map((p) => [p.id, p]));
  const unitIds = [...new Set(plan.units.map((p) => p.unitId))];
  const blocks = unitIds.map((unitId) => {
    const packs = plan.units.filter((p) => p.unitId === unitId);
    const primary = packs.find((p) => p.id === unitId) ?? packs[0];
    return {
      unitId,
      kind: primary.kind,
      location: locate(primary),
      catchRange: primary.catchRange ?? null,
      parts: packs.map((p) => ({
        packId: p.id,
        kind: p.kind,
        split: p.split ?? null,
        location: locate(p),
      })),
      signals: cells
        .filter((c) => c.unitId === unitId)
        .map(({ unitId: _u, ...c }) => c),
    };
  });
  const viewEntry = (c) => ({
    packId: c.packId,
    unitId: c.unitId,
    pPositive: c.pPositive,
    confidence: c.confidence,
    choice: c.choice,
    ...tieFields(c),
    location: locate(packById.get(c.packId)),
  });
  const views = Object.fromEntries(
    catalog.signals.map((s) => {
      const scored = cells.filter(
        (c) => c.signalId === s.id && c.status === "scored",
      );
      scored.sort(
        (a, b) => b.pPositive - a.pPositive || a.packId.localeCompare(b.packId),
      );
      return [
        s.id,
        {
          threshold: thresholds[s.id],
          floor: floors[s.id],
          status: s.status,
          version: s.version,
          evidence: s.evidence,
          scored: scored.length,
          shown: scored.filter((c) => c.shown).map(viewEntry),
          uncertain: scored
            .filter((c) => c.band === "uncertain")
            .map(viewEntry),
          ordering:
            "Jev P(positive option) descending; ties by pack id. No deterministic score participates.",
        },
      ];
    }),
  );
  for (const u of plan.unitManifest.filter((m) => m.disposition !== "packed")) {
    blocks.push({
      unitId: u.unitId,
      kind: u.kind,
      location: u.location,
      catchRange: null,
      parts: [],
      signals: u.signals.map((signalId) => ({
        packId: null,
        kind: u.kind,
        split: null,
        signalId,
        status: u.disposition,
        choice: null,
        confidence: null,
        pPositive: null,
        band: null,
        shown: false,
        missingReasons: [u.disposition],
      })),
    });
    for (const signalId of u.signals)
      cells.push({
        packId: null,
        unitId: u.unitId,
        kind: u.kind,
        split: null,
        signalId,
        status: u.disposition,
        missingReasons: [u.disposition],
        pPositive: null,
        band: null,
        shown: false,
      });
  }
  const abstentions = cells
    .filter((c) => c.status !== "scored")
    .map((c) => ({
      packId: c.packId,
      unitId: c.unitId,
      kind: c.kind,
      signalId: c.signalId,
      status: c.status,
      missingReasons: c.missingReasons,
      split: c.split,
    }));
  const toFinding = (c) => {
    const pack = packById.get(c.packId),
      signal = catalog.signals.find((s) => s.id === c.signalId);
    return {
      signalId: c.signalId,
      signalVersion: c.signalVersion,
      signalStatus: c.signalStatus,
      question: signal.question,
      answer: c.choice,
      ...tieFields(c),
      positiveOption: c.positiveOption,
      pPositive: c.pPositive,
      confidence: c.confidence,
      threshold: c.threshold,
      floor: c.floor,
      band: c.band,
      unitId: c.unitId,
      packId: c.packId,
      kind: c.kind,
      split: c.split,
      ...(pack.facts?.retrievalSource
        ? { retrievalSource: pack.facts.retrievalSource }
        : {}),
      location: locate(pack),
      catchRange: pack.catchRange ?? null,
      verificationReads: pack.sections.map((s) => ({
        path: s.path,
        range: s.range,
        fileSHA256: s.fileSHA256,
        sourceSHA256: s.sourceSHA256,
        roles: s.roles,
      })),
      contextOmissions: pack.omitted,
      packRef: {
        planHash: plan.planHash,
        packId: pack.id,
        contentHash: pack.contentHash,
      },
      notAPatchInstruction: true,
    };
  };
  const byP = (a, b) =>
    b.pPositive - a.pPositive ||
    a.signalId.localeCompare(b.signalId) ||
    a.packId.localeCompare(b.packId);
  const findings = cells
    .filter((c) => c.shown)
    .sort(byP)
    .map(toFinding);
  const uncertain = cells
    .filter((c) => c.band === "uncertain")
    .sort(byP)
    .map(toFinding);
  const statusCounts = cells.reduce(
    (a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a),
    {},
  );
  const report = {
    schema: "semantic-refactor-scan-report/1",
    planHash: plan.planHash,
    catalogVersion: plan.catalogVersion,
    provenance,
    thresholds,
    floors,
    thresholdMeaning:
      "Display cut only. Jev probabilities are not bug confidence, impact or permission to edit.",
    coverage: {
      paths: plan.scope?.paths ?? [],
      sourceFiles: plan.coverage.sourceFiles ?? null,
      filesWithUnindexedFunctions: new Set(
        (plan.coverage.parseAndIndexOmissions ?? [])
          .filter((o) => o.reason === "function_limit")
          .map((o) => o.path),
      ).size,
      unitsNotPacked: plan.coverage.unitsNotPacked ?? 0,
      ...(plan.coverage.traversalComplete === false && {
        traversalComplete: false,
        unvisitedEntries: plan.files.reduce(
          (sum, f) =>
            sum + (f.status === "entry_limit" ? f.unvisitedEntries : 0),
          0,
        ),
      }),
    },
    cells: cells.length,
    units: plan.units.length,
    requests: plan.requests.length,
    statusCounts,
    unitsNotPacked: plan.unitManifest.filter((m) => m.disposition !== "packed")
      .length,
    generatorOmissions: plan.coverage.generatorOmissions,
    blocks,
    views,
    abstentions,
    findings,
    uncertain,
    bands: {
      meaning: BAND_MEANING,
      edges: Object.fromEntries(
        Object.keys(thresholds).map((id) => [
          id,
          { floor: floors[id], cut: thresholds[id] },
        ]),
      ),
      counts: Object.fromEntries(
        ["worth_a_look", "uncertain", "below"].map((band) => [
          band,
          cells.filter((c) => c.band === band).length,
        ]),
      ),
    },
  };
  const nearTies = cells
    .filter((c) => c.near_tie)
    .map((c) => ({
      packId: c.packId,
      unitId: c.unitId,
      signalId: c.signalId,
      status: c.status,
      choice: c.choice,
      ...tieFields(c),
      pPositive: c.pPositive,
      shown: c.shown,
    }));
  if (nearTies.length) {
    report.nearTies = nearTies;
    report.nearTieRule = `Jev probabilities are rounded to 2 decimals, so a chosen option within 0.01 of the maximum is accepted and flagged near_tie. Display depends only on the cell's own P(positive) against the cut.`;
  }
  return { ...report, reportHash: hash(report) };
}

const display = (v) => String(v).replace(/[`<>\r\n\u2028\u2029]/g, " ");
const where = (loc) =>
  loc
    .map(
      (l) =>
        `${display(l.name ?? "anonymous")} ${display(l.path)}:${l.startLine}–${l.endLine}`,
    )
    .join(" ↔ ");
const isFocus = (read) =>
  read.roles.some((r) => r === "focus" || r.startsWith("pair."));
const tie = (x) =>
  x.near_tie
    ? ` (near tie: chosen ${x.choiceProbability.toFixed(2)} vs max ${x.maximumProbability.toFixed(2)})`
    : "";
const evidenceLine = (view) => {
  const e = view.evidence?.[0];
  return e
    ? `${e.actionableAboveCut}/${e.reviewedAboveCut} actionable above the cut (${e.corpus.split(" (")[0]}, LLM reviewer)`
    : "no evidence recorded";
};

export function queueMarkdown(report) {
  const uncertain = report.uncertain ?? [];
  const below = report.bands?.counts.below ?? 0;
  const lines = [
    "# Refactor queue",
    "",
    `${report.findings.length} worth a look, ${uncertain.length} uncertain (check), ${below} below the band. Each item is a hypothesis from one Jev answer about one narrow question. It is not a bug report, and P is not the chance that a change is worth making.`,
    "",
    "**How to use this file.** Hand it to a person or a coding agent. For each item, read the listed lines, answer the question yourself, and change nothing if it does not hold. `no change` is a valid outcome. Verify before editing. Signals marked *experimental* have too little evidence to trust; see EVIDENCE.md.",
    "",
    `**Worth a look (${report.findings.length}).** Candidates at or above each signal's cut, ordered by Jev's probability for the positive option (highest first).`,
    "",
  ];
  const item = (f, i, level, label = "") =>
    lines.push(
      `${level} ${i + 1}. ${where(f.location)} · ${f.signalId}@${f.signalVersion}${f.signalStatus === "experimental" ? " (experimental)" : ""} · P=${f.pPositive.toFixed(2)}${label}`,
      "",
      `- **Question:** ${display(f.question)}`,
      `- **Jev answer:** ${f.answer}${tie(f)}${f.split?.type === "line_window" ? `; judged on lines ${f.split.startLine}–${f.split.endLine} only` : ""}.`,
      `- **Read first:** ${[...f.verificationReads]
        .sort((x, y) => Number(isFocus(y)) - Number(isFocus(x)))
        .slice(0, 6)
        .map(
          (r) => `${display(r.path)}:${r.range.startLine}–${r.range.endLine}`,
        )
        .join(
          "; ",
        )}${f.verificationReads.length > 6 ? "; more in report.json" : ""}.`,
      f.contextOmissions.length
        ? `- **Context Jev did not get:** ${f.contextOmissions.map((o) => display(o.reason)).join(", ")}.`
        : "- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.",
      "",
    );
  if (!report.findings.length) lines.push("None.", "");
  report.findings.forEach((f, i) => item(f, i, "##"));
  lines.push(
    "---",
    "",
    `**Uncertain, check (${uncertain.length}).** P is at or above the signal's floor and under its cut: Jev leaned toward the positive option, not enough to rank with the list above. Read these after the first list, and expect more \`no change\` outcomes. In the evaluation samples an LLM reviewer judged some cells just under the cut worth a change, at a lower rate than above it (docs/BANDS.md).`,
    "",
  );
  if (!uncertain.length) lines.push("None.", "");
  uncertain.forEach((f, i) =>
    item(f, report.findings.length + i, "###", " · uncertain"),
  );
  lines.push(
    "---",
    "",
    below
      ? `**Below the band (${below}).** ${below} scored cells are under their signal's floor. They are not listed here. Each one is in report.json (\`blocks[].signals[]\` with \`band: "below"\`).`
      : "**Below the band (0).** No scored cell is under its signal's floor.",
    "",
  );
  return lines.join("\n");
}

export function reportMarkdown(report, accounting = null) {
  const lines = [
    "# Scan report",
    "",
    `Provenance: **${report.provenance}**. Plan \`${report.planHash.slice(0, 12)}…\`, catalog ${report.catalogVersion}, signals: ${Object.keys(report.views).join(", ")}.`,
    `${report.cells} cells (unit × question): ${Object.entries(
      report.statusCounts,
    )
      .map(([k, v]) => `${v} ${k}`)
      .join(
        ", ",
      )}. ${report.findings.length} at or above the display cut. ${report.units} units in ${report.requests} requests.`,
    "",
    "The display cut is a display setting, not a calibration. Jev probabilities are rounded to two decimals, are not reproducible from call to call, and are not the chance of a bug or of a worthwhile change.",
    "",
  ];
  const partial = [
    report.coverage?.filesWithUnindexedFunctions
      ? `functions in ${report.coverage.filesWithUnindexedFunctions.toLocaleString("en-US")} files were not indexed (function cap)`
      : null,
    report.coverage?.unitsNotPacked
      ? `${report.coverage.unitsNotPacked.toLocaleString("en-US")} units were not packed (unit limit)`
      : null,
  ].filter(Boolean);
  if (partial.length)
    lines.push(`Not fully covered: ${partial.join("; ")}.`, "");
  const c = report.coverage?.sourceFiles;
  if (c && report.coverage.traversalComplete === false)
    lines.push(
      `Coverage: read ${c.read.toLocaleString("en-US")} source files${report.coverage.paths.length ? ` in scope (--paths ${report.coverage.paths.join(",")})` : ""}; the total is unknown because the scan stopped at the entry limit${report.coverage.unvisitedEntries ? `, with at least ${report.coverage.unvisitedEntries.toLocaleString("en-US")} entries not visited` : ""}.${c.unreadByFileOrByteCap ? ` ${c.unreadByFileOrByteCap.toLocaleString("en-US")} source files were not read because of the file cap.` : ""}`,
      "",
    );
  else if (c)
    lines.push(
      `Coverage: read ${c.read.toLocaleString("en-US")} of ${c.inScope.toLocaleString("en-US")} source files${report.coverage.paths.length ? ` in scope (--paths ${report.coverage.paths.join(",")}; ${c.inProject.toLocaleString("en-US")} in the project)` : ""} (${c.inScope ? Math.round((c.read / c.inScope) * 100) : 100}%).${c.unreadByFileOrByteCap ? ` ${c.unreadByFileOrByteCap.toLocaleString("en-US")} source files were not read because of the file cap.` : ""}`,
      "",
    );
  if (accounting)
    lines.push(
      `Cost (calculated from provider-returned usage, not an invoice): **US$${accounting.knownEstimatedUSD.toFixed(4)}** for ${accounting.knownInputTokens.toLocaleString("en-US")} input tokens over ${accounting.reservedAttempts} attempts${accounting.wallClockMs ? `, ${(accounting.wallClockMs / 1000).toFixed(0)} s wall-clock at concurrency ${accounting.concurrency}` : ""}.`,
      "",
    );
  lines.push(
    "| Signal | Status | Scored | At or above cut | Uncertain band | Cut | Floor | Model said insufficient | Evidence so far |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const [id, v] of Object.entries(report.views)) {
    const cells = report.blocks
      .flatMap((b) => b.signals)
      .filter((c) => c.signalId === id);
    lines.push(
      `| ${id}@${v.version} | ${v.status} | ${v.scored} | ${v.shown.length} | ${v.uncertain?.length ?? 0} | ${v.threshold} | ${v.floor ?? "n/a"} | ${cells.filter((c) => c.status === "model_insufficient").length} | ${evidenceLine(v)} |`,
    );
  }
  lines.push("");
  const abstained = Object.entries(
    report.abstentions.reduce(
      (m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m),
      {},
    ),
  );
  if (abstained.length)
    lines.push(
      `Cells without a score: ${abstained.map(([k, v]) => `${v} ${k}`).join(", ")}.`,
      "",
    );
  if (report.nearTies)
    lines.push(
      `${report.nearTies.length} answers were near ties (chosen option within 0.01 of the maximum). They are flagged in report.json and queue.md.`,
      "",
    );
  lines.push(
    "Next: open `queue.md`. Every item there is something to verify, not to apply.",
    "",
  );
  return lines.join("\n");
}
