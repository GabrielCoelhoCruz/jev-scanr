export const BASELINE_SIGNAL = "function_should_split";

export const BASELINE_LIMITATION =
  "Without labels, this only shows where the two orderings agree or differ. It does not measure the quality of either ranking.";

const scoredCell = (cell) =>
  cell !== null && cell.status === "scored" && Number.isFinite(cell.pPositive)
    ? cell
    : null;

const usable = (location) =>
  typeof location?.path === "string" &&
  Number.isFinite(location.startLine) &&
  Number.isFinite(location.endLine);

export function buildBaseline(report, { top = 5 } = {}) {
  if (!Number.isInteger(top) || top < 1)
    throw Error("--top must be a positive integer");
  if (!report || typeof report !== "object" || !Array.isArray(report.blocks))
    throw Error(
      "The file has no blocks array; it is not a jev-scanr report.json",
    );
  const functions = [];
  const gaps = [];
  let clonePairs = 0;
  let otherBlocks = 0;
  let duplicateUnitIds = 0;
  const seen = new Set();
  for (const [index, block] of report.blocks.entries()) {
    if (
      !block ||
      typeof block !== "object" ||
      typeof block.unitId !== "string" ||
      typeof block.kind !== "string"
    )
      throw Error(
        `Block ${index} of the report is malformed: it needs a string unitId and kind`,
      );
    if (block.kind !== "function") {
      if (block.kind === "clone_pair") clonePairs++;
      else otherBlocks++;
      continue;
    }
    if (seen.has(block.unitId)) {
      duplicateUnitIds++;
      continue;
    }
    seen.add(block.unitId);
    const focus = (Array.isArray(block.location) ? block.location : []).filter(
      (l) => l?.role === "focus",
    );
    const location = focus.length === 1 ? focus[0] : null;
    const cells = (Array.isArray(block.signals) ? block.signals : []).filter(
      (s) => s?.signalId === BASELINE_SIGNAL,
    );
    const cell = cells.length === 1 ? cells[0] : null;
    const scored = scoredCell(cell);
    if (!location || !usable(location)) {
      gaps.push({
        unitId: block.unitId,
        reason: !location
          ? "no single focus location"
          : "focus location without a usable path or line range",
      });
      continue;
    }
    functions.push({
      unitId: block.unitId,
      name: location.name ?? null,
      path: location.path,
      startLine: location.startLine,
      endLine: location.endLine,
      lines: location.endLine - location.startLine + 1,
      p: scored ? scored.pPositive : null,
      band: scored?.band ?? null,
      lengthRank: null,
      jevRank: null,
    });
    if (!scored)
      gaps.push({
        unitId: block.unitId,
        reason:
          cell === null
            ? cells.length === 0
              ? `no ${BASELINE_SIGNAL} cell`
              : `more than one ${BASELINE_SIGNAL} cell`
            : `${BASELINE_SIGNAL} not scored (${cell.status ?? "unknown status"}); no P imputed`,
      });
  }
  if (seen.size === 0)
    throw Error(
      "The report holds no function blocks; there is nothing to compare",
    );
  if (functions.length === 0)
    throw Error(
      "No function block of the report has a single focus location; there is nothing to rank",
    );
  functions.sort(
    (a, b) => b.lines - a.lines || a.unitId.localeCompare(b.unitId),
  );
  functions.forEach((f, i) => (f.lengthRank = i + 1));
  const scoredFunctions = functions.filter((f) => f.p !== null);
  scoredFunctions.sort((a, b) => b.p - a.p || a.unitId.localeCompare(b.unitId));
  scoredFunctions.forEach((f, i) => (f.jevRank = i + 1));
  const lengthTop = functions.slice(0, top);
  const jevTop = scoredFunctions.slice(0, top);
  const jevTopIds = new Set(jevTop.map((f) => f.unitId));
  const overlapUnitIds = lengthTop
    .filter((f) => jevTopIds.has(f.unitId))
    .map((f) => f.unitId);
  return {
    signal: BASELINE_SIGNAL,
    top,
    inputs: {
      reportHash: report.reportHash ?? null,
      planHash: report.planHash ?? null,
      catalogVersion: report.catalogVersion ?? null,
    },
    protocol: {
      universe:
        "function blocks of this report, deduplicated by unitId; clone pairs are counted, not ranked",
      lengthDefinition:
        "endLine - startLine + 1 of the block's focus location, as recorded in the report",
      lengthOrder: "lines descending, ties by unitId ascending",
      jevOrder: `pPositive of ${BASELINE_SIGNAL} descending, ties by unitId ascending; no other signal's P is used`,
      gaps: "a function without a scored cell keeps p null, gets no Jev rank and is listed with the cell's status; P is never imputed",
    },
    census: {
      functionBlocks: seen.size,
      duplicateUnitIds,
      clonePairBlocks: clonePairs,
      otherBlocks,
      located: functions.length,
      scored: scoredFunctions.length,
      gaps,
    },
    lengthTop,
    jevTop,
    overlap: { of: top, count: overlapUnitIds.length, unitIds: overlapUnitIds },
    functions,
    limitation: BASELINE_LIMITATION,
  };
}

const where = (f) =>
  `\`${f.name ?? "(anonymous)"}\` ${f.path}:${f.startLine}\u2013${f.endLine}`;

export function baselineMarkdown(result) {
  const c = result.census;
  const lines = [];
  const a = lines.push.bind(lines);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  a("# Length baseline against Jev's ranking (offline)");
  a("");
  a(
    `Signal \`${result.signal}\` · top ${result.top} · reportHash \`${result.inputs.reportHash}\` · planHash \`${result.inputs.planHash}\``,
  );
  a("");
  a(
    `Universe: ${plural(c.functionBlocks, "function block")} (${plural(c.clonePairBlocks, "clone pair")}, counted, not ranked${c.duplicateUnitIds ? `, ${c.duplicateUnitIds} duplicate unitId${c.duplicateUnitIds === 1 ? "" : "s"} dropped` : ""}${c.otherBlocks ? `, ${c.otherBlocks} block${c.otherBlocks === 1 ? "" : "s"} of other kinds` : ""}). A single focus location: ${c.located} of ${c.functionBlocks}. A Jev score for the signal: ${c.scored} of ${c.functionBlocks}${c.gaps.length ? `; ${plural(c.gaps.length, "gap")} listed below` : ""}.`,
  );
  a("");
  a(`## Top ${result.top} by length`);
  a("");
  a("| # | function | lines | P | Jev # | band |");
  a("|---:|---|---:|---:|---:|---|");
  for (const f of result.lengthTop)
    a(
      `| ${f.lengthRank} | ${where(f)} | ${f.lines} | ${f.p ?? "no score"} | ${f.jevRank ?? "\u2013"} | ${f.band ?? "none"} |`,
    );
  a("");
  a(`## Top ${result.top} by Jev (${result.signal})`);
  a("");
  if (!result.jevTop.length)
    a(
      `No function has a Jev score for ${result.signal} in this report; only the length ranking is shown.`,
    );
  else {
    a("| # | function | P | lines | length # | band |");
    a("|---:|---|---:|---:|---:|---|");
    for (const f of result.jevTop)
      a(
        `| ${f.jevRank} | ${where(f)} | ${f.p} | ${f.lines} | ${f.lengthRank} | ${f.band ?? "none"} |`,
      );
  }
  a("");
  a(`## Top-${result.top} overlap: ${result.overlap.count} of ${result.top}`);
  a("");
  if (!result.jevTop.length) a("No overlap: one of the rankings is empty.");
  else {
    const jevTopIds = new Set(result.jevTop.map((f) => f.unitId));
    const lengthOnly = result.lengthTop.filter((f) => !jevTopIds.has(f.unitId));
    const jevOnly = result.jevTop.filter(
      (f) => !result.lengthTop.some((g) => g.unitId === f.unitId),
    );
    a(
      `In both: ${result.overlap.count ? result.overlap.unitIds.map((id) => where(result.functions.find((f) => f.unitId === id))).join("; ") : "none"}.`,
    );
    for (const f of lengthOnly)
      a(
        `- Only in length: ${where(f)} (${f.lines} lines, ${f.p === null ? "no Jev score" : `P ${f.p}`}, Jev rank ${f.jevRank ?? "none"}).`,
      );
    for (const f of jevOnly)
      a(
        `- Only in Jev: ${where(f)} (P ${f.p}, ${f.lines} lines, length rank ${f.lengthRank}).`,
      );
  }
  a("");
  if (c.gaps.length) {
    a("## Gaps");
    a("");
    for (const g of c.gaps) a(`- ${g.unitId.slice(0, 12)}\u2026 ${g.reason}`);
    a("");
  }
  a(`Limitation: ${result.limitation}`);
  return lines.join("\n") + "\n";
}
