import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { posix } from "node:path";
import { hash } from "./core.mjs";
import { sourcePath, testPath, tsconfigFacts } from "./snapshot.mjs";
import { addConsumers } from "./consumers.mjs";

function staticName(node) {
  if (!node) return null;
  if (node.type === "Identifier" || node.type === "JSXIdentifier")
    return node.name;
  if (node.type === "StringLiteral") return node.value;
  if (
    ["MemberExpression", "OptionalMemberExpression"].includes(node.type) &&
    !node.computed
  ) {
    const object = staticName(node.object),
      property = staticName(node.property);
    return object && property ? `${object}.${property}` : null;
  }
  return null;
}

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);
const ignored = new Set([
  "loc",
  "tokens",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
]);
const traverse = traverseModule.default ?? traverseModule;
export function walk(node, fn, ancestors = []) {
  if (!node || typeof node.type !== "string" || node.type.startsWith("Comment"))
    return;
  fn(node, ancestors);
  for (const [key, value] of Object.entries(node))
    if (!ignored.has(key))
      for (const child of Array.isArray(value) ? value : [value])
        if (
          child &&
          typeof child === "object" &&
          typeof child.type === "string"
        )
          walk(child, fn, [...ancestors, node]);
}
export function nodeRange(node) {
  return {
    startOffset: node.start,
    endOffset: node.end,
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    encoding: "UTF-16",
    endExclusive: true,
  };
}
export function ref(file, node, reason) {
  const source = file.source.slice(node.start, node.end);
  return {
    path: file.path,
    range: nodeRange(node),
    fileSHA256: file.sha256,
    sourceSHA256: hash(source),
    source,
    reason,
  };
}
function boundNames(node) {
  if (!node) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "RestElement") return boundNames(node.argument);
  if (node.type === "AssignmentPattern") return boundNames(node.left);
  if (node.type === "TSParameterProperty") return boundNames(node.parameter);
  if (node.type === "ObjectPattern")
    return node.properties.flatMap((p) => boundNames(p.value ?? p.argument));
  if (node.type === "ArrayPattern") return node.elements.flatMap(boundNames);
  return [];
}
export function buildIndex(snapshot) {
  const modules = new Map(),
    functions = [],
    errors = [],
    config = tsconfigFacts(snapshot);
  for (const file of snapshot.sources.values()) {
    if (!sourcePath(file.path)) continue;
    let ast;
    try {
      ast = parse(file.source, {
        sourceType: "unambiguous",
        plugins: [
          ...(/\.[cm]?tsx?$/.test(file.path) ? ["typescript"] : []),
          ...(/\.[jt]sx$/.test(file.path) ? ["jsx"] : []),
        ],
        tokens: true,
      });
    } catch {
      errors.push({ path: file.path, reason: "parse_error" });
      continue;
    }
    const module = {
      ...file,
      ast,
      functions: [],
      imports: new Map(),
      exports: new Map(),
      declarations: new Map(),
      bindings: new Map(),
      mutated: new Set(),
      dynamicScope: false,
      calls: [],
      test: testPath(file.path),
      paths: new WeakMap(),
    };
    try {
      traverse(ast, {
        enter(path) {
          module.paths.set(path.node, path);
        },
      });
    } catch {
      errors.push({ path: file.path, reason: "scope_analysis_error" });
      continue;
    }
    const binding = (name) =>
      module.bindings.set(name, (module.bindings.get(name) ?? 0) + 1);
    walk(ast.program, (node, ancestors) => {
      const parent = ancestors.at(-1),
        name =
          node.id?.name ??
          (parent?.type === "VariableDeclarator"
            ? parent.id?.name
            : parent?.type === "ObjectProperty" && !parent.computed
              ? staticName(parent.key)
              : staticName(node.key));
      const topLevel = ancestors.every((a) =>
        [
          "Program",
          "ExportNamedDeclaration",
          "ExportDefaultDeclaration",
          "VariableDeclaration",
        ].includes(a.type),
      );
      if (node.type === "ImportDeclaration")
        for (const s of node.specifiers) {
          binding(s.local.name);
          module.imports.set(s.local.name, {
            from: node.source.value,
            imported:
              s.type === "ImportDefaultSpecifier"
                ? "default"
                : s.type === "ImportNamespaceSpecifier"
                  ? "*"
                  : (s.imported.name ?? s.imported.value),
            node,
          });
        }
      if (node.type === "VariableDeclarator")
        for (const n of boundNames(node.id)) binding(n);
      if (node.type === "FunctionDeclaration" && node.id) binding(node.id.name);
      if (node.type === "FunctionExpression" && node.id) binding(node.id.name);
      if (node.type === "ClassExpression" && node.id) binding(node.id.name);
      if (node.type === "TSTypeParameter" && node.name) binding(node.name);
      if (node.type === "CatchClause")
        for (const n of boundNames(node.param)) binding(n);
      if (
        node.type === "WithStatement" ||
        (node.type === "CallExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === "eval")
      )
        module.dynamicScope = true;
      if (
        [
          "AssignmentExpression",
          "UpdateExpression",
          "ForInStatement",
          "ForOfStatement",
        ].includes(node.type)
      ) {
        let target = node.left ?? node.argument;
        while (
          target?.type === "MemberExpression" ||
          target?.type === "OptionalMemberExpression"
        )
          target = target.object;
        for (const n of boundNames(target)) module.mutated.add(n);
      }
      if (functionTypes.has(node.type))
        for (const p of node.params) for (const n of boundNames(p)) binding(n);
      if (
        [
          "ClassDeclaration",
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
        ].includes(node.type) &&
        node.id
      )
        binding(node.id.name);
      if (
        topLevel &&
        [
          "FunctionDeclaration",
          "ClassDeclaration",
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
        ].includes(node.type) &&
        node.id
      )
        module.declarations.set(node.id.name, node);
      if (
        topLevel &&
        node.type === "VariableDeclarator" &&
        node.id.type === "Identifier"
      )
        module.declarations.set(
          node.id.name,
          parent?.type === "VariableDeclaration" ? parent : node,
        );
      if (functionTypes.has(node.type)) {
        if (functions.length >= snapshot.limits.maxFunctions) {
          errors.push({ path: file.path, reason: "function_limit" });
          return;
        }
        const tokens = ast.tokens.filter(
          (t) =>
            t.start >= node.start &&
            t.end <= node.end &&
            typeof t.type !== "string",
        );
        const normal = tokens.map((t) =>
          t.type.label === "name"
            ? "ID"
            : ["string", "template"].includes(t.type.label)
              ? "STR"
              : t.type.label === "num"
                ? "NUM"
                : String(t.value ?? t.type.label),
        );
        const sh = new Set();
        for (let i = 0; i + 5 <= normal.length; i++)
          sh.add(normal.slice(i, i + 5).join("\u001f"));
        const id = hash([file.path, file.sha256, node.start, node.end]);
        const f = {
          id,
          path: file.path,
          name:
            name ??
            (parent?.type === "ExportDefaultDeclaration" ? "default" : null),
          node,
          ancestors,
          range: nodeRange(node),
          lines: node.loc.end.line - node.loc.start.line + 1,
          shingles: sh,
          bodyHash: hash(file.source.slice(node.body.start, node.body.end)),
          test: module.test,
          calls: [],
          catches: [],
          references: [],
          incoming: [],
        };
        functions.push(f);
        module.functions.push(f);
      }
    });
    for (const statement of ast.program.body) {
      if (statement.type === "ExportDefaultDeclaration") {
        const d = statement.declaration;
        if (functionTypes.has(d.type) && !d.id) {
          module.declarations.set("default", d);
          binding("default");
          module.exports.set("default", "default");
        } else
          module.exports.set(
            "default",
            d.type === "Identifier"
              ? d.name
              : (module.functions.find((f) => f.node === d)?.name ?? null),
          );
      }
      if (statement.type === "ExportNamedDeclaration" && !statement.source) {
        const d = statement.declaration;
        if (d?.id) module.exports.set(d.id.name, d.id.name);
        if (d?.type === "VariableDeclaration")
          for (const v of d.declarations)
            if (v.id.type === "Identifier")
              module.exports.set(v.id.name, v.id.name);
        for (const s of statement.specifiers)
          module.exports.set(s.exported.name ?? s.exported.value, s.local.name);
      }
    }
    for (const f of module.functions)
      walk(f.node, (node, ancestors) => {
        if (
          node.type === "Identifier" &&
          module.paths.get(node)?.isReferencedIdentifier()
        )
          f.references.push({ name: node.name, node });
        if (
          node.type === "JSXIdentifier" &&
          ["JSXOpeningElement", "JSXMemberExpression"].includes(
            ancestors.at(-1)?.type,
          ) &&
          !(
            ancestors.at(-1)?.type === "JSXMemberExpression" &&
            ancestors.at(-1).property === node
          ) &&
          (module.imports.has(node.name) || module.declarations.has(node.name))
        )
          f.references.push({ name: node.name, node });
        if (ancestors.some((a) => functionTypes.has(a.type) && a !== f.node))
          return;
        if (node.type === "CatchClause") f.catches.push(node);
        if (
          [
            "CallExpression",
            "NewExpression",
            "OptionalCallExpression",
          ].includes(node.type)
        ) {
          const call = {
            node,
            callee: staticName(node.callee),
            owner: f.id,
            path: file.path,
            range: nodeRange(node),
            resolved: null,
            reason: "dynamic_or_unresolved",
          };
          f.calls.push(call);
          module.calls.push(call);
        }
      });
    walk(ast.program, (node, ancestors) => {
      if (ancestors.some((a) => functionTypes.has(a.type))) return;
      if (
        ["CallExpression", "NewExpression", "OptionalCallExpression"].includes(
          node.type,
        )
      )
        module.calls.push({
          node,
          callee: staticName(node.callee),
          owner: null,
          path: file.path,
          range: nodeRange(node),
          resolved: null,
          reason: "dynamic_or_unresolved",
        });
    });
    module.bindingFor = (name, node = module.ast.program) =>
      module.paths.get(node)?.scope.getBinding(name);
    module.exactDeclaration = (name, node = module.ast.program) => {
      const binding = module.bindingFor(name, node);
      if (binding)
        return binding.path.isVariableDeclarator()
          ? binding.path.parentPath.node
          : binding.path.node;
      const declaration = module.declarations.get(name);
      return name === "default" ||
        [
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
        ].includes(declaration?.type)
        ? declaration
        : undefined;
    };
    module.stable = (
      name,
      configuration = false,
      node = module.ast.program,
    ) => {
      if (
        (module.bindings.get(name) ?? 0) !== 1 ||
        module.mutated.has(name) ||
        module.dynamicScope
      )
        return false;
      const binding = module.bindingFor(name, node);
      if (!binding)
        return !configuration && !!module.exactDeclaration(name, node);
      return (
        binding.constant &&
        binding.constantViolations.length === 0 &&
        (!configuration ||
          binding.referencePaths.every((p) =>
            p.parentPath.isExportDefaultDeclaration(),
          ))
      );
    };
    modules.set(file.path, module);
  }
  const resolveModule = (from, specifier) => {
    if (typeof specifier !== "string") return { reason: "dynamic_module" };
    let bases = [];
    if (specifier.startsWith("."))
      bases = [posix.normalize(posix.join(posix.dirname(from), specifier))];
    else {
      let patterns = Object.entries(config.aliases ?? {}).filter(
        ([pattern, targets]) => {
          const [pre, post] = pattern.split("*");
          return (
            pattern.split("*").length <= 2 &&
            Array.isArray(targets) &&
            (pattern.includes("*")
              ? specifier.length >= pre.length + post.length &&
                specifier.startsWith(pre) &&
                specifier.endsWith(post)
              : specifier === pattern)
          );
        },
      );
      if (patterns.some(([pattern]) => pattern === specifier))
        patterns = patterns.filter(([pattern]) => pattern === specifier);
      else if (patterns.length) {
        const prefixLength = Math.max(
          ...patterns.map(([pattern]) => pattern.split("*")[0].length),
        );
        patterns = patterns.filter(
          ([pattern]) => pattern.split("*")[0].length === prefixLength,
        );
        if (patterns.length > 1) return { reason: "ambiguous_alias_pattern" };
      }
      for (const [pattern, targets] of patterns) {
        const [pre, post] = pattern.split("*");
        if (pattern.split("*").length > 2 || !Array.isArray(targets)) continue;
        const match = pattern.includes("*")
          ? specifier.startsWith(pre) && specifier.endsWith(post)
          : specifier === pattern;
        if (match && config.aliasResolutionUnknown)
          return { reason: "alias_base_or_config_graph_unresolved" };
        if (match)
          for (const t of targets)
            if (typeof t === "string")
              bases.push(
                posix.normalize(
                  posix.join(
                    config.aliasBase ?? ".",
                    t.replace(
                      "*",
                      specifier.slice(
                        pre.length,
                        post ? -post.length : undefined,
                      ),
                    ),
                  ),
                ),
              );
      }
    }
    if (!bases.length) return { reason: "external_or_unresolved_module" };
    const hits = [];
    for (const base of bases) {
      const stem = base.replace(/\.(?:js|mjs|cjs)$/, "");
      for (const path of [
        ...new Set([
          base,
          stem,
          ...[
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mts",
            ".mjs",
            "/index.ts",
            "/index.tsx",
            "/index.js",
          ].map((s) => stem + s),
        ]),
      ])
        if (snapshot.admissible(path) && modules.has(path)) hits.push(path);
    }
    const unique = [...new Set(hits)];
    return unique.length === 1
      ? { path: unique[0], reason: "resolved_static_module" }
      : {
          reason: unique.length
            ? "ambiguous_module"
            : "missing_excluded_or_unsupported_module",
        };
  };
  function resolveSymbol(module, name, node = module.ast.program) {
    if (!module.stable(name, false, node))
      return { reason: "shadowed_mutated_or_ambiguous_binding" };
    const binding = module.bindingFor(name, node),
      imported =
        binding &&
        [
          "ImportSpecifier",
          "ImportDefaultSpecifier",
          "ImportNamespaceSpecifier",
        ].includes(binding.path.node.type)
          ? module.imports.get(name)
          : null;
    if (imported) {
      const target = resolveModule(module.path, imported.from);
      if (!target.path) return target;
      const other = modules.get(target.path),
        local = other.exports.get(imported.imported);
      const declaration = local && other.exactDeclaration(local);
      if (
        !local ||
        !other.stable(local) ||
        !declaration ||
        [
          "ImportSpecifier",
          "ImportDefaultSpecifier",
          "ImportNamespaceSpecifier",
        ].includes(declaration.type)
      )
        return { reason: "unstable_reexport_or_unresolved_export" };
      return {
        path: target.path,
        node: declaration,
        local,
        reason: "import_1hop",
      };
    }
    return {
      path: module.path,
      node: module.exactDeclaration(name, node),
      local: name,
      reason: "local_declaration",
    };
  }
  for (const module of modules.values())
    for (const call of module.calls) {
      if (call.node.callee.type === "Identifier") {
        const binding = module.bindingFor(call.node.callee.name, call.node);
        if (
          binding?.path.node.type.startsWith("Import") &&
          [
            binding.path.node.importKind,
            binding.path.parentPath.node.importKind,
          ].some((kind) => kind === "type" || kind === "typeof")
        ) {
          call.reason = "type_only_import_not_runtime_call";
          continue;
        }
        const target = resolveSymbol(module, call.node.callee.name, call.node);
        const imported = binding?.path.node.type.startsWith("Import")
          ? module.imports.get(call.node.callee.name)
          : null;
        if (
          imported &&
          target.path &&
          !modules.get(target.path).ast.program.body.some((statement) => {
            if (statement.type === "ExportDefaultDeclaration")
              return imported.imported === "default";
            if (
              statement.type !== "ExportNamedDeclaration" ||
              statement.source ||
              statement.exportKind === "type"
            )
              return false;
            return (
              statement.declaration?.id?.name === imported.imported ||
              statement.declaration?.declarations?.some(
                (d) => d.id.name === imported.imported,
              ) ||
              statement.specifiers.some(
                (s) =>
                  s.exportKind !== "type" &&
                  (s.exported.name ?? s.exported.value) === imported.imported,
              )
            );
          })
        ) {
          call.reason = "type_only_or_unsupported_export_not_runtime_call";
          continue;
        }
        const f = target.path
          ? modules
              .get(target.path)
              ?.functions.find(
                (f) =>
                  f.node === target.node ||
                  (f.ancestors.at(-1)?.type === "VariableDeclarator" &&
                    f.ancestors.at(-1).id?.name === target.local &&
                    target.node?.declarations?.includes(f.ancestors.at(-1))),
              )
          : null;
        call.reason = target.reason;
        if (f) {
          call.resolved = f.id;
          f.incoming.push(call);
        }
      }
    }
  const index = {
    snapshot,
    modules,
    functions,
    errors,
    config,
    resolveModule,
    resolveSymbol,
  };
  addConsumers(index);
  return index;
}
