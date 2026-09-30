import { hash } from "./core.mjs";
import { nodeRange } from "./index.mjs";
import { operandContext } from "./operand-context.mjs";

export function mergeRanges(ranges) {
  const result = [];
  for (const current of [...ranges].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.startOffset - b.startOffset ||
      a.endOffset - b.endOffset,
  )) {
    const last = result.at(-1);
    if (
      last &&
      last.path === current.path &&
      current.startOffset <= last.endOffset
    ) {
      last.endOffset = Math.max(last.endOffset, current.endOffset);
      last.roles = [...new Set([...last.roles, ...current.roles])];
      last.focusRanges.push(...current.focusRanges);
    } else
      result.push({
        ...current,
        roles: [...current.roles],
        focusRanges: [...current.focusRanges],
      });
  }
  return result;
}
function lineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      offsets.push(i + 1);
    } else if (["\n", "\u2028", "\u2029"].includes(text[i]))
      offsets.push(i + 1);
  }
  return offsets;
}
function lineAt(offsets, value) {
  let n = 0;
  while (n + 1 < offsets.length && offsets[n + 1] <= value) n++;
  return n + 1;
}
export const TRIM_ORDER = Object.freeze(["dependency", "test", "caller"]);
export function makePack(
  candidate,
  index,
  { budgetTrim = false, fits, declarationCapNonDecisive = false } = {},
) {
  if (budgetTrim && typeof fits !== "function")
    throw Error("Budget trimming requires a request-size measure");
  const ranges = [],
    omitted = [],
    members = [],
    callers = [],
    dependencies = [],
    testReferences = [];
  const add = (path, node, role, window = false, owner = "member") => {
    const module = index.modules.get(path),
      r = nodeRange(node),
      offsets = lineOffsets(module.source);
    let startOffset = r.startOffset,
      endOffset = r.endOffset;
    if (window) {
      startOffset = offsets[Math.max(0, r.startLine - 16)];
      endOffset =
        offsets[Math.min(offsets.length, r.endLine + 15)] ??
        module.source.length;
    }
    ranges.push({
      path,
      startOffset,
      endOffset,
      roles: [role],
      focusRanges: [{ role, ...r }],
      owner,
    });
    return { path, range: r, fileSHA256: module.sha256, role };
  };
  for (const [i, f] of candidate.members.entries()) {
    const role =
      candidate.kind === "clone_pair" ? `pair.${i ? "b" : "a"}` : "focus";
    members.push({
      ...add(f.path, f.node, role),
      functionId: f.id,
      name: f.name,
    });
    const comments =
      f.node.leadingComments ?? f.ancestors.at(-1)?.leadingComments ?? [];
    for (const comment of comments)
      if (
        comment.end <= f.node.start &&
        f.node.loc.start.line - comment.loc.end.line <= 2
      )
        add(f.path, comment, `${role}.declaration_comment`);
  }
  const allCallers = [
    ...new Map(
      candidate.members
        .flatMap((f) => f.incoming)
        .map((c) => [`${c.path}:${c.range.startOffset}`, c]),
    ).values(),
  ].sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.range.startOffset - b.range.startOffset,
  );
  for (const [i, call] of allCallers
    .slice(0, index.snapshot.limits.maxCallers)
    .entries())
    callers.push({
      ...add(
        call.path,
        call.node,
        call.provenance ? `consumer.${call.provenance.kind}` : "caller",
        true,
        `caller:${i}`,
      ),
      resolvedFunctionId: call.resolved,
      provenance: call.provenance
        ? `${call.provenance.kind}:${call.reason};static_consumer_not_runtime_invocation`
        : "unique_unshadowed_static_binding",
    });
  if (allCallers.length > callers.length)
    omitted.push({
      what: "additional_callers",
      count: allCallers.length - callers.length,
      reason: "caller_cap",
      decisive: false,
    });
  const wanted = new Map(),
    unresolvedImports = new Set();
  const operand = operandContext(candidate, index);
  omitted.push(...operand.omitted);
  for (const reference of operand.references) {
    if (
      candidate.members.some(
        (f) =>
          f.path === reference.path &&
          f.node.start <= reference.node.start &&
          f.node.end >= reference.node.end,
      )
    ) {
      add(reference.path, reference.node, reference.role);
      continue;
    }
    wanted.set(`${reference.path}:${reference.node.start}`, {
      ...reference,
      name: reference.symbol,
      reason: reference.role,
      priority: 0,
      tier: 0,
    });
  }
  for (const f of candidate.members) {
    const module = index.modules.get(f.path);
    for (const { name, node } of f.references) {
      const target = index.resolveSymbol(module, name, node);
      if (
        target.node &&
        !candidate.members.some(
          (x) =>
            x.path === target.path &&
            target.node.start >= x.node.start &&
            target.node.end <= x.node.end,
        )
      ) {
        const key = `${target.path}:${target.node.start}`,
          parent = module.paths.get(node)?.parent,
          tier =
            node.type === "JSXIdentifier" ||
            ([
              "CallExpression",
              "OptionalCallExpression",
              "NewExpression",
            ].includes(parent?.type) &&
              parent.callee === node)
              ? 1
              : 2;
        if (!wanted.has(key))
          wanted.set(key, { ...target, name, priority: 1, tier });
        else if (wanted.get(key).tier > tier) wanted.get(key).tier = tier;
      } else if (module.imports.has(name) && !target.node) {
        const key = `${module.path}:${name}:${target.reason}`;
        if (!unresolvedImports.has(key)) {
          unresolvedImports.add(key);
          omitted.push({
            what: `imported_dependency:${name}`,
            reason: target.reason,
            decisive: false,
          });
        }
      }
    }
  }
  const ordered = [...wanted.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.path.localeCompare(b.path) ||
      a.node.start - b.node.start,
  );
  const dependencyRelevance = [];
  for (const [i, target] of ordered
    .slice(0, index.snapshot.limits.maxImports)
    .entries()) {
    dependencyRelevance.push({
      owner: `dependency:${i}`,
      tier: target.tier,
      bytes: target.node.end - target.node.start,
      index: i,
    });
    dependencies.push({
      ...add(target.path, target.node, target.reason, false, `dependency:${i}`),
      symbol: target.name,
      provenance:
        target.priority === 0
          ? `bounded_static_operand_trace:${target.provenance.interpretation}`
          : "one_hop_static_declaration_not_recursive_resolution",
    });
  }
  if (ordered.length > dependencies.length)
    omitted.push({
      what: "additional_referenced_declarations",
      count: ordered.length - dependencies.length,
      reason: "import_declaration_cap",
      decisive: !declarationCapNonDecisive,
    });
  const tests = [];
  for (const module of index.modules.values())
    if (module.test) {
      for (const call of module.calls)
        if (candidate.members.some((f) => f.id === call.resolved))
          tests.push({
            module,
            node: call.node,
            priority: 0,
            role: "test_static_call_reference",
          });
      for (const imported of module.imports.values()) {
        const target = index.resolveModule(module.path, imported.from);
        if (
          target.path &&
          candidate.members.some((f) => f.path === target.path)
        )
          tests.push({
            module,
            node: imported.node,
            priority: 1,
            role: "test_import_reference",
          });
      }
    }
  tests.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.module.path.localeCompare(b.module.path) ||
      a.node.start - b.node.start,
  );
  const uniqueTests = [...new Set(tests.map((t) => t.module.path))].map(
    (path) => tests.find((t) => t.module.path === path),
  );
  for (const [i, t] of uniqueTests
    .slice(0, index.snapshot.limits.maxTests)
    .entries())
    testReferences.push({
      ...add(t.module.path, t.node, t.role, true, `test:${i}`),
      meaning:
        t.priority === 0
          ? "static call to the exact member; not proof of test discovery, execution or assertion coverage"
          : "module-level static import reference; not an assertion about this member or executed coverage",
    });
  if (uniqueTests.length > testReferences.length)
    omitted.push({
      what: "additional_test_references",
      count: uniqueTests.length - testReferences.length,
      reason: "test_reference_cap",
      decisive: false,
    });
  const referenceLists = {
    caller: callers,
    dependency: dependencies,
    test: testReferences,
  };
  const build = (dropped) => {
    const kept = (kind) =>
      referenceLists[kind].filter((_, i) => !dropped.has(`${kind}:${i}`));
    const trimmed = [...dropped].map((owner) => {
      const [kind, i] = owner.split(":"),
        reference = referenceLists[kind][Number(i)];
      return {
        what: `${kind}:${reference.path}:${reference.range.startLine}${reference.symbol ? `:${reference.symbol}` : ""}`,
        reason: "request_byte_budget_trim",
        decisive: false,
      };
    });
    const packCallers = kept("caller");
    return assemble(
      ranges.filter((r) => !dropped.has(r.owner)),
      packCallers,
      kept("dependency"),
      kept("test"),
      [...omitted, ...trimmed],
      dropped.size,
    );
  };
  const blockedForEveryQuestion = omitted.some((o) => o.decisive);
  if (!budgetTrim || blockedForEveryQuestion) return build(new Set());
  const dropped = new Set();
  let pack = build(dropped);
  const trimOrder = [
    ...[...dependencyRelevance]
      .sort((a, b) => b.tier - a.tier || b.bytes - a.bytes || b.index - a.index)
      .map((d) => d.owner),
    ...TRIM_ORDER.slice(1).flatMap((kind) =>
      referenceLists[kind].map((_, i) => `${kind}:${i}`).reverse(),
    ),
  ];
  for (const owner of trimOrder) {
    if (fits(pack)) break;
    dropped.add(owner);
    pack = build(dropped);
  }
  return pack;
  function assemble(
    selectedRanges,
    packCallers,
    packDependencies,
    packTests,
    packOmitted,
    trimmedCount,
  ) {
    const sections = mergeRanges(selectedRanges).map((r) => {
      const module = index.modules.get(r.path),
        source = module.source.slice(r.startOffset, r.endOffset),
        offsets = lineOffsets(module.source);
      return {
        path: r.path,
        range: {
          startOffset: r.startOffset,
          endOffset: r.endOffset,
          startLine: lineAt(offsets, r.startOffset),
          endLine: lineAt(offsets, r.endOffset),
          encoding: "UTF-16",
          endExclusive: true,
        },
        roles: r.roles,
        focusRanges: r.focusRanges,
        fileSHA256: module.sha256,
        sourceSHA256: hash(source),
        source,
      };
    });
    return {
      schema: "semantic-evidence-pack/3",
      id: candidate.id,
      kind: candidate.kind,
      clusterId: candidate.clusterId ?? null,
      members,
      sections,
      callers: packCallers,
      dependencies: packDependencies,
      testReferences: packTests,
      facts: {
        ...candidate.facts,
        staticFanIn: allCallers.length,
        testReferenceCount: uniqueTests.length,
        operandContext: {
          facts: operand.facts,
          references: operand.references.map(
            ({ path, node, role, symbol, provenance }) => ({
              path,
              range: nodeRange(node),
              role,
              ...(symbol ? { symbol } : {}),
              provenance,
            }),
          ),
        },
        ...(budgetTrim
          ? {
              budgetTrim: {
                trimmedReferences: trimmedCount,
                order: TRIM_ORDER,
                dependencyRelevance:
                  "operand provenance > called/rendered declarations > other declarations; larger first within a tier",
                membersNeverTrimmed: true,
              },
            }
          : {}),
        churn: null,
        churnReason: "not_computed; not a benefit measure",
      },
      omitted: packOmitted,
      uncertainties: [
        "Static references are incomplete for dynamic/aliased/namespace/indirect calls and external consumers.",
        "Caller windows are bounded excerpts, not complete contracts.",
        "JSX uses are not call edges; anonymous callback wrappers and closure-parameter types may be absent.",
        "Imports resolve one hop only; opaque helpers/types may require insufficient.",
        "Connected clone edges do not prove transitive equivalence; variation may be intentional.",
      ],
      status: packOmitted.some((o) => o.decisive)
        ? "insufficient_context"
        : "eligible",
    };
  }
}
