import { posix } from "node:path";

function literal(node) {
  if (!node) return undefined;
  if (["TSAsExpression", "TSSatisfiesExpression"].includes(node.type))
    return literal(node.expression);
  if (["StringLiteral", "BooleanLiteral", "NumericLiteral"].includes(node.type))
    return node.value;
  if (node.type === "ArrayExpression") {
    const values = node.elements.map(literal);
    return values.some((v) => v === undefined) ? undefined : values;
  }
  if (node.type === "ObjectExpression") {
    const out = Object.create(null);
    for (const p of node.properties) {
      if (p.type !== "ObjectProperty" || p.computed) return undefined;
      const key = p.key.name ?? p.key.value,
        value = literal(p.value);
      if (value === undefined) return undefined;
      out[key] = value;
    }
    return out;
  }
}
export function testConfigFacts(index) {
  const records = [];
  for (const module of index.modules.values())
    if (/(?:^|\/)jest\.config\.[cm]?[jt]s$/.test(module.path)) {
      let value;
      for (const statement of module.ast.program.body)
        if (statement.type === "ExportDefaultDeclaration") {
          let node = statement.declaration;
          if (node.type === "Identifier") {
            const declaration = module.stable(node.name, true)
              ? module.declarations.get(node.name)
              : null;
            node = declaration?.declarations?.find(
              (d) => d.id.name === node.name,
            )?.init;
          }
          value = literal(node);
        }
      const roots = value?.roots,
        rootDir = value?.rootDir ?? ".";
      const safeBase =
        typeof rootDir === "string" &&
        !posix.isAbsolute(rootDir) &&
        !/[<>?*\\]|(?:^|\/)\.\.(?:\/|$)/.test(rootDir);
      if (
        !safeBase ||
        !Array.isArray(roots) ||
        roots.some(
          (r) =>
            typeof r !== "string" ||
            !/^<rootDir>(?:\/.*)?$/.test(r) ||
            /[?*\\]|(?:^|\/)\.\.(?:\/|$)/.test(r),
        )
      ) {
        records.push({
          path: module.path,
          fileSHA256: module.sha256,
          status: "dynamic_or_unsupported_config_unresolved",
          provenance: "AST_literals_only_no_execution",
        });
        continue;
      }
      const base = posix.normalize(
          posix.join(posix.dirname(module.path), rootDir),
        ),
        prefixes = roots.map((r) =>
          posix.normalize(posix.join(base, r.replace(/^<rootDir>\/?/, ""))),
        );
      records.push({
        path: module.path,
        fileSHA256: module.sha256,
        status: "static_literals",
        rootDir: base,
        roots,
        testMatch: value.testMatch ?? null,
        provenance: "AST_literals_only_no_execution",
      });
      for (const test of index.modules.values())
        if (
          test.test &&
          !prefixes.some(
            (r) =>
              r === "." || test.path.startsWith(r.replace(/\/$/, "") + "/"),
          )
        )
          records.push({
            path: test.path,
            fileSHA256: test.sha256,
            status: "potential_outside_static_roots",
            config: module.path,
            reason:
              "static root prefix comparison; dynamic overrides/projects/CLI and actual test discovery unknown; listTests not executed",
          });
    }
  return records;
}
