import { hash } from "./core.mjs";
import { generateCandidates } from "./candidates.mjs";
import { nameCue } from "./name-cue.mjs";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);
export const UNIT_ORDER = ["function", "clone_pair"];

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

export function pseudoMember(
  module,
  { start, end, id, name = null, parent = null },
) {
  const starts = lineStarts(module.source);
  const lineOf = (offset) => {
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const endOffset = Math.max(start + 1, end);
  const node = {
    type: "UnitRange",
    start,
    end: endOffset,
    loc: {
      start: { line: lineOf(start), column: start - starts[lineOf(start) - 1] },
      end: {
        line: lineOf(endOffset),
        column: endOffset - starts[lineOf(endOffset) - 1],
      },
    },
  };
  return {
    id,
    path: module.path,
    name,
    node,
    ancestors: [],
    incoming: [],
    references: [],
    calls: [],
    catches: [],
    lines: node.loc.end.line - node.loc.start.line + 1,
    test: module.test,
    parentFunctionId: parent,
  };
}

export function formUnits(
  index,
  {
    includeTests = false,
    kinds = UNIT_ORDER,
    lowOverlap,
    nameCues = false,
  } = {},
) {
  const base = generateCandidates(index, {
    includeTests,
    recordCapped: true,
    lowOverlap,
  });
  const units = [];
  for (const f of kinds.includes("function")
    ? index.functions.filter(
        (f) =>
          (includeTests || !f.test) &&
          !f.ancestors.some((a) => FUNCTION_TYPES.has(a.type)),
      )
    : [])
    units.push({
      kind: "function",
      id: hash(["function", [f.id], null]),
      members: [f],
      facts: {
        lines: f.lines,
        provenance: "outermost_function_unit",
        ...(nameCues ? { nameCue: nameCue(index, f) } : {}),
      },
    });
  if (kinds.includes("clone_pair"))
    for (const c of base.candidates)
      units.push({
        kind: c.kind,
        id: c.id,
        members: c.members,
        clusterId: c.clusterId,
        facts: {
          provenance: c.facts.provenance,
          ...(c.facts.retrievalSource
            ? { retrievalSource: c.facts.retrievalSource }
            : {}),
          unitFormation: "retrieval grouping only; never a score",
        },
      });
  const seen = new Set();
  for (const u of units) {
    if (seen.has(u.id)) throw Error("Duplicate unit identity");
    seen.add(u.id);
  }
  units.sort((a, b) => UNIT_ORDER.indexOf(a.kind) - UNIT_ORDER.indexOf(b.kind));
  const count = (k) => units.filter((u) => u.kind === k).length;
  return {
    units,
    clusters: base.clusters,
    omitted: base.omitted,
    stats: {
      ...base.stats,
      functionUnits: count("function"),
      pairUnits: count("clone_pair"),
    },
    options: base.options,
  };
}

export function lineWindows(module, member, maxLines) {
  const first = member.node.loc.start.line,
    last = member.node.loc.end.line;
  const starts = lineStarts(module.source);
  const windows = [];
  for (let a = first; a <= last; a += maxLines) {
    const b = Math.min(last, a + maxLines - 1);
    const start = Math.max(member.node.start, starts[a - 1]);
    const end = Math.min(
      member.node.end,
      b < starts.length ? starts[b] - 1 : module.source.length,
    );
    if (end > start) windows.push({ start, end, startLine: a, endLine: b });
  }
  return windows;
}
