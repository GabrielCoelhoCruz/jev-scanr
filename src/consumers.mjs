const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const imports = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

function range(node) {
  return {
    startOffset: node.start,
    endOffset: node.end,
    startLine: node.loc.start.line,
    endLine: node.loc.end.line,
    encoding: "UTF-16",
    endExclusive: true,
  };
}

function allowed(index, path) {
  return index.snapshot.admissible(path);
}

function* nodes(root) {
  const queue = [root];
  while (queue.length) {
    const node = queue.pop();
    yield node;
    const children = Object.values(node).flatMap((value) =>
      Array.isArray(value) ? value : [value],
    );
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (
        child &&
        typeof child.type === "string" &&
        !child.type.startsWith("Comment")
      )
        queue.push(child);
    }
  }
}

function globalFetchWrite(index) {
  const globals = new Set(["globalThis", "window", "self", "global"]);
  function targetsFetch(node) {
    if (!node) return false;
    if (
      [
        "TSAsExpression",
        "TSNonNullExpression",
        "ParenthesizedExpression",
      ].includes(node.type)
    )
      return targetsFetch(node.expression);
    if (node.type === "ObjectPattern")
      return node.properties.some((p) => targetsFetch(p.value ?? p.argument));
    if (node.type === "ArrayPattern") return node.elements.some(targetsFetch);
    if (node.type === "AssignmentPattern") return targetsFetch(node.left);
    if (node.type === "RestElement") return targetsFetch(node.argument);
    if (!["MemberExpression", "OptionalMemberExpression"].includes(node.type))
      return false;
    const object = node.object;
    if (object.type !== "Identifier" || !globals.has(object.name)) return false;
    if (!node.computed) return node.property.name === "fetch";
    if (
      ["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(
        node.property.type,
      )
    )
      return node.property.value === "fetch";
    return true;
  }
  for (const module of index.modules.values()) {
    if (!allowed(index, module.path)) continue;
    for (const node of nodes(module.ast.program)) {
      let target;
      if (
        ["AssignmentExpression", "ForInStatement", "ForOfStatement"].includes(
          node.type,
        )
      )
        target = node.left;
      if (
        node.type === "UpdateExpression" ||
        (node.type === "UnaryExpression" && node.operator === "delete")
      )
        target = node.argument;
      if (targetsFetch(target))
        return {
          path: module.path,
          range: range(node),
          operation: node.operator ?? node.type,
        };
    }
  }
  return null;
}

function runtimeExport(module, name) {
  return module.ast.program.body.some((s) => {
    if (s.type === "ExportDefaultDeclaration") return name === "default";
    if (
      s.type !== "ExportNamedDeclaration" ||
      s.source ||
      s.exportKind === "type"
    )
      return false;
    return (
      s.declaration?.id?.name === name ||
      s.declaration?.declarations?.some((d) => d.id.name === name) ||
      s.specifiers.some(
        (p) =>
          p.exportKind !== "type" &&
          (p.exported.name ?? p.exported.value) === name,
      )
    );
  });
}

function targetFunction(index, target) {
  if (!target.path || !allowed(index, target.path)) return undefined;
  const matches = index.modules.get(target.path)?.functions.filter((f) => {
    const parent = f.ancestors.at(-1);
    return (
      f.node === target.node ||
      (parent?.type === "VariableDeclarator" &&
        parent.id?.name === target.local &&
        parent.init === f.node &&
        target.node?.declarations?.includes(parent))
    );
  });
  return matches?.length === 1 ? matches[0] : undefined;
}

function stringValue(index, module, node, depth = 0, hops = 0) {
  if (!node || depth > 8 || module.dynamicScope) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (["TSAsExpression", "TSSatisfiesExpression"].includes(node.type))
    return stringValue(index, module, node.expression, depth + 1, hops);
  if (node.type !== "Identifier" || !module.stable(node.name, false, node))
    return undefined;
  const binding = module.bindingFor(node.name, node);
  if (!binding) return undefined;
  let declaration = binding.path.node;
  if (imports.has(declaration.type)) {
    if (
      hops ||
      declaration.type === "ImportNamespaceSpecifier" ||
      declaration.importKind === "type" ||
      binding.path.parentPath.node.importKind === "type"
    )
      return undefined;
    const target = index.resolveSymbol(module, node.name, node);
    if (!target.path || !allowed(index, target.path)) return undefined;
    const imported = module.imports.get(node.name);
    module = index.modules.get(target.path);
    if (!runtimeExport(module, imported.imported)) return undefined;
    declaration = target.node?.declarations?.find(
      (d) => d.id.type === "Identifier" && d.id.name === target.local,
    );
    if (target.node?.kind !== "const" || !declaration) return undefined;
    return stringValue(index, module, declaration.init, depth + 1, hops + 1);
  }
  if (
    declaration.type !== "VariableDeclarator" ||
    declaration.id.type !== "Identifier" ||
    binding.path.parentPath.node.kind !== "const" ||
    declaration.end >= node.start
  )
    return undefined;
  return stringValue(index, module, declaration.init, depth + 1, hops);
}

function routeTable(index) {
  const routes = new Map(),
    roots = new Set();
  let unsupported = false;
  let incomplete = !index.snapshot.coverage.traversalComplete;
  for (const file of index.snapshot.files) {
    if (file.path === "src" && file.status === "symlink") incomplete = true;
    const root = /^(app|src\/app)(?:\/|$)/.exec(file.path);
    if (root) {
      roots.add(root[1]);
      if (
        file.status === "unreadable_directory" ||
        file.status === "symlink" ||
        (file.status === "excluded_path" && !/\.[^/]+$/.test(file.path))
      )
        incomplete = true;
    }
    const match = /^(app|src\/app)\/(.+)\+api\.[jt]sx?$/.exec(file.path);
    if (!match) {
      if (/^(app|src\/app)\/.*\+api\./.test(file.path)) unsupported = true;
      continue;
    }
    const segments = match[2].split("/");
    if (segments.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) {
      unsupported = true;
      continue;
    }
    if (segments.at(-1) === "index") segments.pop();
    const url = "/" + segments.join("/");
    routes.set(url, [...(routes.get(url) ?? []), file.path]);
  }
  return { routes, unsupported, incomplete, ambiguousRoot: roots.size > 1 };
}

function httpTarget(index, module, node, routing, globalFetchMutation) {
  if (
    node.type !== "CallExpression" ||
    node.optional ||
    node.callee.type !== "Identifier" ||
    node.callee.name !== "fetch"
  )
    return { reason: "unsupported_fetch_callee" };
  if (globalFetchMutation)
    return { reason: "global_fetch_write_or_delete", globalFetchMutation };
  if (
    module.dynamicScope ||
    module.bindingFor("fetch", node) ||
    module.bindings.has("fetch") ||
    module.mutated.has("fetch")
  )
    return { reason: "shadowed_or_mutated_fetch" };
  const url = stringValue(index, module, node.arguments[0]);
  if (url === undefined) return { reason: "dynamic_url" };
  if (!/^\/api(?:\/[A-Za-z0-9_-]+)*$/.test(url))
    return { reason: "unsupported_or_unsafe_url", url };
  if (!node.arguments.length || node.arguments.length > 2)
    return { reason: "unsupported_fetch_arguments", url };
  let method = "GET";
  if (node.arguments.length === 2) {
    const options = node.arguments[1];
    if (
      options.type !== "ObjectExpression" ||
      options.properties.some(
        (p) =>
          p.type !== "ObjectProperty" ||
          p.computed ||
          (p.key.name ?? p.key.value) === "__proto__",
      )
    )
      return { reason: "dynamic_fetch_options", url };
    const values = options.properties.filter(
      (p) => (p.key.name ?? p.key.value) === "method",
    );
    if (values.length > 1) return { reason: "ambiguous_method", url };
    if (values.length) method = stringValue(index, module, values[0].value);
  }
  if (!methods.has(method))
    return { reason: "dynamic_or_unsupported_method", url };
  const evidence = { url, method };
  if (routing.incomplete)
    return { ...evidence, reason: "incomplete_route_inventory" };
  if (routing.ambiguousRoot)
    return { ...evidence, reason: "ambiguous_route_roots" };
  if (routing.unsupported)
    return { ...evidence, reason: "unsupported_route_layout" };
  const hits = routing.routes.get(url) ?? [];
  if (hits.length !== 1)
    return {
      ...evidence,
      reason: hits.length ? "ambiguous_route" : "missing_route",
    };
  const path = hits[0];
  const handler = allowed(index, path) && index.modules.get(path);
  if (!handler) return { ...evidence, reason: "excluded_or_unindexed_route" };
  const local = handler.exports.get(method);
  if (!local || !runtimeExport(handler, method))
    return { ...evidence, route: path, reason: "missing_method_export" };
  const target = index.resolveSymbol(handler, local);
  const f = target.path === path && targetFunction(index, target);
  return f
    ? { ...evidence, route: path, f, reason: "exact_expo_api_export" }
    : { ...evidence, route: path, reason: "unstable_or_unsupported_handler" };
}

function jsxTarget(index, module, node, use) {
  if (!["Identifier", "JSXIdentifier"].includes(node?.type))
    return { reason: "unsupported_jsx_binding" };
  const binding = module.bindingFor(node.name, use);
  if (
    !binding ||
    binding.path.node.importKind === "type" ||
    binding.path.parentPath?.node.importKind === "type"
  )
    return { reason: "missing_or_type_only_jsx_binding" };
  const target = index.resolveSymbol(module, node.name, use);
  if (imports.has(binding.path.node.type) && target.path) {
    const other = index.modules.get(target.path);
    const imported = module.imports.get(node.name);
    if (!other || !runtimeExport(other, imported.imported))
      return { reason: "missing_runtime_jsx_export", binding: node.name };
  }
  const f = targetFunction(index, target);
  return f
    ? { f, reason: "exact_jsx_binding", binding: node.name }
    : { reason: target.reason, binding: node.name };
}

function props(module, node) {
  return {
    attributes: node.attributes.slice(0, 16).map((a) => ({
      name: a.name?.name ?? null,
      kind: a.type,
      range: range(a),
      source: module.source.slice(a.start, Math.min(a.end, a.start + 512)),
      truncated: a.end - a.start > 512,
    })),
    truncated: node.attributes.length > 16,
  };
}

export function addConsumers(index) {
  if (index.consumerFacts) return index.consumerFacts;
  const facts = {
    resolved: [],
    unresolved: [],
    limit: index.snapshot.limits.maxFunctions,
    truncated: false,
    scope: {
      http: "Exact literal /api paths, one immutable-string import hop, and same-file named Expo method exports only; no runtime routing proof.",
      jsx: "Unique lexical component and onX callback bindings only; props are bounded source data, not evaluated values or proof of invocation.",
      returnedFieldReads: "unsupported",
    },
  };
  index.consumerFacts = facts;
  const routing = routeTable(index);
  const globalFetchMutation = globalFetchWrite(index);
  let count = 0;
  function record(module, node, kind, result, extra = {}) {
    if (count >= facts.limit) {
      facts.truncated = true;
      return;
    }
    count++;
    const { f, ...detail } = result;
    const provenance = { kind, ...detail, ...extra };
    const evidence = {
      path: module.path,
      range: range(node),
      resolved: f?.id ?? null,
      reason: result.reason,
      provenance,
    };
    (f ? facts.resolved : facts.unresolved).push(evidence);
    if (!f) return;
    const ownerNode = module.paths.get(node)?.getFunctionParent()?.node;
    f.incoming.push({
      ...evidence,
      node,
      callee: result.binding ?? "fetch",
      owner: module.functions.find((x) => x.node === ownerNode)?.id ?? null,
    });
  }
  for (const module of index.modules.values()) {
    if (!allowed(index, module.path)) continue;
    for (const node of nodes(module.ast.program)) {
      if (["CallExpression", "OptionalCallExpression"].includes(node.type)) {
        const callee = node.callee;
        if (
          (callee.type === "Identifier" && callee.name === "fetch") ||
          (["MemberExpression", "OptionalMemberExpression"].includes(
            callee.type,
          ) &&
            !callee.computed &&
            callee.property.name === "fetch")
        )
          record(
            module,
            node,
            "http_fetch",
            httpTarget(index, module, node, routing, globalFetchMutation),
          );
      }
      if (node.type === "JSXOpeningElement") {
        if (node.name.type !== "JSXIdentifier" || /^[A-Z]/.test(node.name.name))
          record(
            module,
            node,
            "jsx_render",
            jsxTarget(index, module, node.name, node),
            {
              props: props(module, node),
            },
          );
        const lastNamed = new Map();
        let lastSpread = -1;
        for (const [position, attribute] of node.attributes.entries()) {
          if (attribute.type === "JSXSpreadAttribute") lastSpread = position;
          else lastNamed.set(attribute.name.name, position);
        }
        for (const [position, attribute] of node.attributes.entries()) {
          if (count >= facts.limit) break;
          if (
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            /^on[A-Z]/.test(attribute.name.name)
          )
            record(
              module,
              attribute,
              "jsx_callback",
              position < lastSpread ||
                position < lastNamed.get(attribute.name.name)
                ? { reason: "possibly_overridden_jsx_callback" }
                : jsxTarget(
                    index,
                    module,
                    attribute.value?.expression,
                    attribute,
                  ),
              { attribute: attribute.name.name, invocation: "not_proven" },
            );
        }
      }
      if (count >= facts.limit) {
        facts.truncated = true;
        return facts;
      }
    }
  }
  return facts;
}
