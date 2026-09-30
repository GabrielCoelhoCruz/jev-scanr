import { walk } from "./index.mjs";

const MAX_HOPS = 2;
const MAX_REFERENCES = 4;
const MAX_FACTS = 24;
const MAX_STEPS = 64;
const members = new Set(["MemberExpression", "OptionalMemberExpression"]);
const wrappers = new Set([
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "ParenthesizedExpression",
  "TSSatisfiesExpression",
]);
const location = (path, node) => ({
  path,
  startOffset: node.start,
  endOffset: node.end,
});
const keyOf = (node, computed) =>
  !computed && node.type === "Identifier"
    ? node.name
    : ["StringLiteral", "NumericLiteral"].includes(node.type)
      ? String(node.value)
      : null;

export function operandContext(candidate, index) {
  const references = [],
    facts = [],
    omitted = [];
  const referenceKeys = new Set(),
    omissionKeys = new Set();
  let steps = 0;
  const omit = (what, reason) => {
    const key = `${what}:${reason}`;
    if (omissionKeys.has(key) || omitted.length >= MAX_FACTS) return;
    omissionKeys.add(key);
    omitted.push({ what, reason, decisive: false });
  };
  const fact = (value) => {
    if (facts.length < MAX_FACTS) facts.push(value);
    else omit("operand_context", "fact_cap");
  };
  const add = (module, node, role, symbol, provenance) => {
    if (!module.paths.has(node) || !index.snapshot.admissible(module.path)) {
      omit(role, "excluded_or_unindexed_node");
      return false;
    }
    const key = `${module.path}:${node.start}:${node.end}`;
    if (referenceKeys.has(key)) return true;
    if (references.length >= MAX_REFERENCES) {
      omit("operand_context", "reference_cap");
      return false;
    }
    referenceKeys.add(key);
    references.push({
      path: module.path,
      node,
      role,
      ...(symbol ? { symbol } : {}),
      provenance,
    });
    return true;
  };
  const objectSafe = (binding, seen = new Set(), depth = 0) => {
    if (
      !binding ||
      !binding.constant ||
      binding.constantViolations.length ||
      depth > MAX_HOPS ||
      seen.has(binding)
    )
      return false;
    seen = new Set([...seen, binding]);
    return binding.referencePaths.every((reference) => {
      if (reference.isExportNamedDeclaration()) return true;
      let current = reference;
      while (wrappers.has(current.parentPath?.node.type))
        current = current.parentPath;
      if (current.parentPath?.isExportSpecifier())
        return binding.kind !== "module";
      if (
        current.parentPath?.isVariableDeclarator() &&
        current.key === "init"
      ) {
        const declaration = current.parentPath;
        return (
          declaration.node.id.type === "Identifier" &&
          declaration.parentPath.node.kind === "const" &&
          objectSafe(
            declaration.scope.getBinding(declaration.node.id.name),
            seen,
            depth + 1,
          )
        );
      }
      if (
        !members.has(current.parentPath?.node.type) ||
        current.key !== "object"
      )
        return false;
      while (
        (members.has(current.parentPath?.node.type) &&
          current.key === "object") ||
        wrappers.has(current.parentPath?.node.type)
      ) {
        current = current.parentPath;
        if (
          members.has(current.node.type) &&
          keyOf(current.node.property, current.node.computed) === null
        )
          return false;
      }
      const parent = current.parentPath;
      if (!parent) return false;
      if (
        (parent.isAssignmentExpression() && current.key === "left") ||
        parent.isUpdateExpression() ||
        parent.isUnaryExpression({ operator: "delete" }) ||
        parent.isForInStatement() ||
        parent.isForOfStatement()
      )
        return false;
      if (
        (parent.isCallExpression() ||
          parent.isOptionalCallExpression() ||
          parent.isNewExpression()) &&
        current.key === "callee"
      )
        return false;
      return (
        ["BinaryExpression", "UnaryExpression"].includes(parent.node.type) ||
        (members.has(parent.node.type) && current.key === "property")
      );
    });
  };
  const objectImportsSafe = (targetModule, symbol) => {
    for (const module of index.modules.values()) {
      if (
        module.ast.program.body.some(
          (node) =>
            ["ExportNamedDeclaration", "ExportAllDeclaration"].includes(
              node.type,
            ) &&
            node.source &&
            index.resolveModule(module.path, node.source.value).path ===
              targetModule.path,
        )
      )
        return false;
      for (const [local, imported] of module.imports) {
        if (
          imported.imported !== "*" &&
          targetModule.exports.get(imported.imported) !== symbol
        )
          continue;
        if (
          index.resolveModule(module.path, imported.from).path !==
          targetModule.path
        )
          continue;
        if (
          imported.imported === "*" ||
          module.dynamicScope ||
          module.mutated.has(local) ||
          !objectSafe(module.bindingFor(local))
        )
          return false;
      }
    }
    return true;
  };
  const trace = (module, node, state, properties = []) => {
    const what = `operand:${state.operand.kind}`;
    if (++steps > MAX_STEPS) return omit("operand_context", "step_cap");
    if (
      !node ||
      !module.paths.has(node) ||
      !index.snapshot.admissible(module.path)
    )
      return omit(what, "excluded_or_unindexed_node");
    const provenance = {
      method: "bounded_static_operand_trace",
      operand: state.operand,
      hops: state.hops,
      interpretation: state.defaultOnly
        ? "possible_default_only"
        : "syntax_only_not_runtime_value",
    };
    if (wrappers.has(node.type))
      return trace(module, node.expression, state, properties);
    if (members.has(node.type)) {
      const key = keyOf(node.property, node.computed);
      if (key === null) return omit(what, "dynamic_property_selector");
      return trace(module, node.object, state, [key, ...properties]);
    }
    if (node.type === "Identifier") {
      const binding = module.bindingFor(node.name, node);
      const key = `${module.path}:${binding?.identifier.start ?? node.start}`;
      if (state.seen.has(key)) return omit(what, "binding_cycle");
      if (
        !binding ||
        !binding.constant ||
        binding.constantViolations.length ||
        module.mutated.has(node.name) ||
        module.dynamicScope
      )
        return omit(what, "unresolved_or_mutated_binding");
      const imported = [
        "ImportSpecifier",
        "ImportDefaultSpecifier",
        "ImportNamespaceSpecifier",
      ].includes(binding.path.node.type);
      if (
        imported &&
        [
          binding.path.node.importKind,
          binding.path.parentPath.node.importKind,
        ].some((kind) => kind === "type" || kind === "typeof")
      )
        return omit(what, "type_only_import_not_runtime_value");
      const cost = imported ? 2 : 1;
      if (state.hops.length + cost > MAX_HOPS)
        return omit(what, "declaration_import_hop_cap");
      let targetModule = module,
        declaration = binding.path.node,
        symbol = node.name;
      let hops = [...state.hops];
      if (imported) {
        const importedSymbol = module.imports.get(node.name);
        const resolvedModule =
          importedSymbol &&
          index.resolveModule(module.path, importedSymbol.from);
        const exportedModule =
          resolvedModule?.path && index.modules.get(resolvedModule.path);
        const explicitValueExport = exportedModule?.ast.program.body.some(
          (statement) => {
            if (statement.type === "ExportDefaultDeclaration")
              return importedSymbol.imported === "default";
            if (
              statement.type !== "ExportNamedDeclaration" ||
              statement.exportKind === "type"
            )
              return false;
            return (
              (statement.declaration?.type === "VariableDeclaration" &&
                !statement.declaration.declare &&
                statement.declaration.declarations.some(
                  (declaration) =>
                    declaration.id.type === "Identifier" &&
                    declaration.id.name === importedSymbol.imported,
                )) ||
              statement.specifiers.some(
                (specifier) =>
                  specifier.exportKind !== "type" &&
                  (specifier.exported.name ?? specifier.exported.value) ===
                    importedSymbol.imported,
              )
            );
          },
        );
        if (
          exportedModule?.ast.program.body.some((statement) => {
            if (statement.type === "ExportAllDeclaration")
              return statement.exportKind === "type" && !explicitValueExport;
            if (statement.type !== "ExportNamedDeclaration") return false;
            return statement.specifiers.some(
              (specifier) =>
                (specifier.exported.name ?? specifier.exported.value) ===
                  importedSymbol.imported &&
                (statement.exportKind === "type" ||
                  specifier.exportKind === "type"),
            );
          })
        )
          return omit(what, "type_only_export_not_runtime_value");
        const target = index.resolveSymbol(module, node.name, node);
        if (!target.node || !index.modules.has(target.path))
          return omit(what, target.reason ?? "unresolved_import");
        targetModule = index.modules.get(target.path);
        declaration = target.node;
        symbol = target.local;
        hops.push({
          ...location(module.path, binding.path.node),
          kind: "import",
          symbol: node.name,
        });
        if (declaration.type === "VariableDeclaration")
          declaration = declaration.declarations.find(
            (d) => d.id.name === symbol,
          );
      }
      if (!declaration) return omit(what, "unsupported_declaration");
      hops.push({
        ...location(targetModule.path, declaration),
        kind: "declaration",
        symbol,
      });
      const next = { ...state, hops, seen: new Set([...state.seen, key]) };
      const nextProvenance = { ...provenance, hops };
      if (
        declaration.type === "VariableDeclarator" &&
        declaration.id.type === "Identifier"
      ) {
        const declarationPath = targetModule.paths.get(declaration);
        const targetBinding = targetModule.bindingFor(symbol, declaration);
        if (
          declarationPath?.parentPath.node.kind !== "const" ||
          !targetBinding?.constant ||
          targetBinding.constantViolations.length ||
          targetModule.mutated.has(symbol) ||
          targetModule.dynamicScope
        )
          return omit(what, "non_const_or_mutated_declaration");
        if (
          properties.length &&
          (!objectSafe(binding) ||
            !objectSafe(targetBinding) ||
            !objectImportsSafe(targetModule, symbol))
        )
          return omit(what, "object_escape_or_unsupported_use");
        if (
          !add(
            targetModule,
            declaration,
            `operand_context.${state.operand.kind}`,
            symbol,
            nextProvenance,
          )
        )
          return;
        if (declaration.id.typeAnnotation)
          fact({
            kind: "type_annotation",
            ...location(targetModule.path, declaration.id.typeAnnotation),
            provenance: nextProvenance,
          });
        return trace(targetModule, declaration.init, next, properties);
      }
      const parameter =
        declaration.type === "AssignmentPattern"
          ? declaration
          : binding.path.parentPath?.node;
      if (!imported && binding.kind === "param") {
        if (properties.length && !objectSafe(binding))
          return omit(what, "object_escape_or_unsupported_use");
        const annotation = binding.identifier.typeAnnotation;
        if (
          annotation &&
          add(
            module,
            annotation,
            "operand_context.type",
            node.name,
            nextProvenance,
          )
        )
          fact({
            kind: "type_annotation",
            ...location(module.path, annotation),
            provenance: nextProvenance,
          });
        if (
          parameter?.type === "AssignmentPattern" &&
          parameter.left === binding.identifier
        ) {
          if (
            !add(module, parameter, "operand_context.default", node.name, {
              ...nextProvenance,
              interpretation: "possible_default_only",
            })
          )
            return;
          fact({
            kind: "default_expression",
            ...location(module.path, parameter.right),
            provenance: {
              ...nextProvenance,
              interpretation: "possible_default_only",
            },
          });
          trace(
            module,
            parameter.right,
            { ...next, defaultOnly: true },
            properties,
          );
          return omit(what, "parameter_runtime_value_unknown");
        }
        return omit(what, "parameter_runtime_value_unknown");
      }
      return omit(what, "unsupported_declaration");
    }
    if (node.type === "ObjectExpression") {
      if (
        node.properties.some(
          (p) =>
            p.type !== "ObjectProperty" ||
            p.computed ||
            keyOf(p.key, false) === "__proto__",
        )
      )
        return omit(what, "spread_computed_or_non_plain_object");
      if (!properties.length) return omit(what, "non_scalar_operand");
      const matches = node.properties.filter(
        (p) => keyOf(p.key, false) === properties[0],
      );
      if (matches.length !== 1)
        return omit(what, "missing_or_duplicate_property");
      fact({
        kind: "plain_object_property",
        key: properties[0].slice(0, 128),
        ...location(module.path, matches[0]),
        provenance,
      });
      return trace(module, matches[0].value, state, properties.slice(1));
    }
    if (properties.length) return omit(what, "unsupported_property_source");
    if (
      [
        "NumericLiteral",
        "StringLiteral",
        "BooleanLiteral",
        "NullLiteral",
      ].includes(node.type)
    ) {
      const value = node.type === "NullLiteral" ? null : node.value;
      if (
        (typeof value === "string" && value.length > 128) ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        return omit(what, "literal_size_or_value_limit");
      return fact({
        kind: "literal",
        value,
        ...location(module.path, node),
        provenance,
      });
    }
    if (node.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
      fact({
        kind: "unary_expression",
        operator: node.operator,
        ...location(module.path, node),
        provenance,
      });
      return trace(module, node.argument, state);
    }
    if (
      node.type === "LogicalExpression" &&
      ["??", "||"].includes(node.operator)
    ) {
      trace(module, node.left, state);
      fact({
        kind: "default_expression",
        ...location(module.path, node.right),
        provenance: { ...provenance, interpretation: "possible_default_only" },
      });
      trace(module, node.right, { ...state, defaultOnly: true });
      return omit(what, "default_selection_runtime_unknown");
    }
    return omit(
      what,
      ["CallExpression", "OptionalCallExpression", "NewExpression"].includes(
        node.type,
      )
        ? "unsupported_call_or_dynamic_store"
        : "unsupported_operand_expression",
    );
  };
  const seenOperands = new Set();
  for (const member of candidate.members) {
    const module = index.modules.get(member.path);
    if (!module || !index.snapshot.admissible(member.path)) {
      omit("operand_context", "excluded_or_unindexed_module");
      continue;
    }
    walk(member.node, (node) => {
      const kind =
        node.type === "BinaryExpression" && node.operator === "/"
          ? "divisor"
          : members.has(node.type) && node.computed
            ? "index"
            : null;
      if (!kind) return;
      const operand = kind === "divisor" ? node.right : node.property;
      const key = `${member.path}:${operand.start}:${kind}`;
      if (seenOperands.has(key)) return;
      seenOperands.add(key);
      trace(module, operand, {
        operand: { ...location(member.path, operand), kind },
        hops: [],
        seen: new Set(),
        defaultOnly: false,
      });
    });
  }
  return { references, facts, omitted };
}
