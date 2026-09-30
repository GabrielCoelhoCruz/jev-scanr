import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { hash, secretLike } from "../../../src/core.mjs";
import { sourcePath, testPath } from "../../../src/snapshot.mjs";

export const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const SKIP_KEYS = new Set([
  "loc",
  "tokens",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
]);
const BRANCHES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);
const STOPWORDS = new Set(
  "the and for with from into that this then than get set has have are was use used make made create new add all any not out off its per via run handle on of to in is it as at by do to if or an a can has own one two index item items data value values result results default props prop state args arg params param options option opts config ctx context".split(
    " ",
  ),
);

export const extOf = (path) => {
  const m = /\.([cm]?[jt]sx?)$/.exec(path);
  return m ? m[1].replace(/^[cm]/, "") : "ts";
};

export function parseSource(source, ext) {
  return parse(source, {
    sourceType: "unambiguous",
    plugins: [
      ...(/^tsx?$/.test(ext) ? ["typescript"] : []),
      ...(/^[jt]sx$/.test(ext) ? ["jsx"] : []),
    ],
    tokens: true,
  });
}

export function walk(node, fn, parent = null, key = null) {
  if (!node || typeof node.type !== "string" || node.type.startsWith("Comment"))
    return;
  if (fn(node, parent, key) === false) return;
  for (const [k, value] of Object.entries(node))
    if (!SKIP_KEYS.has(k))
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child.type === "string") walk(child, fn, node, k);
}

export function astKey(ast) {
  return JSON.stringify(ast.program, (k, v) =>
    [
      "start",
      "end",
      "loc",
      "extra",
      "range",
      "leadingComments",
      "trailingComments",
      "innerComments",
    ].includes(k)
      ? undefined
      : v,
  );
}

export function topFunction(ast) {
  if (ast.program.body.length !== 1) return null;
  let stmt = ast.program.body[0];
  if (stmt.type === "FunctionDeclaration" && stmt.id && stmt.body)
    return { stmt, fn: stmt, id: stmt.id, form: "declaration" };
  if (
    stmt.type === "VariableDeclaration" &&
    stmt.declarations.length === 1 &&
    stmt.declarations[0].id.type === "Identifier" &&
    ["ArrowFunctionExpression", "FunctionExpression"].includes(
      stmt.declarations[0].init?.type,
    )
  )
    return {
      stmt,
      fn: stmt.declarations[0].init,
      id: stmt.declarations[0].id,
      form: "const",
    };
  return null;
}

export function boundNames(node) {
  if (!node) return [];
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "AssignmentPattern":
      return boundNames(node.left);
    case "RestElement":
      return boundNames(node.argument);
    case "ObjectPattern":
      return node.properties.flatMap((p) =>
        boundNames(p.type === "RestElement" ? p : p.value),
      );
    case "ArrayPattern":
      return node.elements.flatMap(boundNames);
    case "TSParameterProperty":
      return boundNames(node.parameter);
    default:
      return [];
  }
}

function localNames(fn) {
  const names = new Set();
  walk(fn, (n) => {
    if (FUNCTION_TYPES.has(n.type)) {
      n.params.forEach((p) => boundNames(p).forEach((x) => names.add(x)));
      if (n !== fn && n.id) names.add(n.id.name);
    }
    if (n.type === "VariableDeclarator")
      boundNames(n.id).forEach((x) => names.add(x));
    if (n.type === "CatchClause")
      boundNames(n.param).forEach((x) => names.add(x));
    if (n.type === "ClassDeclaration" && n.id) names.add(n.id.name);
  });
  return names;
}

const splitWords = (text) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) =>
      w.length > 4 && w.endsWith("ies")
        ? w.slice(0, -3) + "y"
        : w.length > 3 && w.endsWith("s")
          ? w.slice(0, -1)
          : w,
    )
    .filter((w) => !STOPWORDS.has(w));
export const nameWords = (name) => new Set(splitWords(name));

export function analyze(text, ext) {
  const ast = parseSource(text, ext);
  const top = topFunction(ast);
  if (!top) return null;
  const { fn, id } = top;
  let statements = 0,
    cyclomatic = 1,
    usesThis = false,
    recursion = false,
    generator = !!fn.generator,
    awaits = false,
    returns = 0;
  walk(fn, (n) => {
    if (
      (n.type.endsWith("Statement") &&
        n.type !== "BlockStatement" &&
        n.type !== "EmptyStatement") ||
      n.type === "VariableDeclaration"
    )
      statements++;
    if (BRANCHES.has(n.type)) cyclomatic++;
    if (n.type === "SwitchCase" && n.test) cyclomatic++;
    if (n.type === "LogicalExpression") cyclomatic++;
    if (["ThisExpression", "Super", "MetaProperty"].includes(n.type))
      usesThis = true;
    if (n.type === "Identifier" && n.name === "arguments") usesThis = true;
    if (n.type === "Identifier" && n.name === id.name && n !== id)
      recursion = true;
    if (n.type === "YieldExpression") generator = true;
    if (n.type === "AwaitExpression") awaits = true;
    if (n.type === "ReturnStatement") returns++;
  });
  const toks = ast.tokens.filter(
    (t) => t.start >= fn.start && t.end <= fn.end && typeof t.type !== "string",
  );
  const raw = toks.map((t) => text.slice(t.start, t.end));
  const norm = toks.map((t) =>
    t.type.label === "name"
      ? "ID"
      : ["string", "template"].includes(t.type.label)
        ? "STR"
        : t.type.label === "num"
          ? "NUM"
          : String(t.value ?? t.type.label),
  );
  const shingles = new Set();
  for (let i = 0; i + 5 <= norm.length; i++)
    shingles.add(norm.slice(i, i + 5).join("\u001f"));
  const locals = localNames(fn);
  const vocab = new Set(
    toks
      .filter((t) => t.type.label === "name")
      .map((t) => t.value)
      .filter((v) => !locals.has(v) && v !== id.name),
  );
  const bodyText = text.slice(0, id.start) + text.slice(id.end);
  return {
    top,
    name: id.name,
    lines: fn.loc.end.line - fn.loc.start.line + 1,
    statements,
    cyclomatic,
    params: fn.params.length,
    tokens: toks.length,
    raw,
    norm,
    shingles,
    vocab,
    locals,
    words: new Set(splitWords(bodyText)),
    usesThis,
    recursion,
    generator,
    awaits,
    returns,
    async: !!fn.async,
  };
}

export const jaccard = (a, b) => {
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common || 1);
};
const windows = (seq, k) => {
  const out = [];
  for (let i = 0; i + k <= seq.length; i++)
    out.push(seq.slice(i, i + k).join("\u001f"));
  return out;
};
function coverage(small, other, k) {
  const inOther = new Set(windows(other, k));
  const covered = new Set();
  windows(small, k).forEach((w, i) => {
    if (inOther.has(w)) for (let j = i; j < i + k; j++) covered.add(j);
  });
  return small.length ? covered.size / small.length : 0;
}

export function pairFeatures(a, b) {
  const [small, other] =
    a.raw.length <= b.raw.length ? [a.raw, b.raw] : [b.raw, a.raw];
  return {
    shingleJaccard: jaccard(a.shingles, b.shingles),
    rawJaccard5: jaccard(
      new Set(windows(a.raw, 5)),
      new Set(windows(b.raw, 5)),
    ),
    tokenCoverage10: coverage(small, other, 10),
    vocabJaccard: jaccard(a.vocab, b.vocab),
    minLines: Math.min(a.lines, b.lines),
    sizeRatio: Math.min(a.lines, b.lines) / Math.max(a.lines, b.lines),
    minTokens: Math.min(a.tokens, b.tokens),
  };
}

export const functionFeatures = (a) => ({
  lines: a.lines,
  statements: a.statements,
  cyclomatic: a.cyclomatic,
  params: a.params,
  tokens: a.tokens,
});

const EXCLUDED_DIRS =
  /(?:^|\/)(?:node_modules|vendor|vendors|dist|build|coverage|generated|__generated__|out|target|\.[^/]+)(?:\/|$)/;

export function extractPool(
  repoDir,
  repo,
  { minLines = 5, maxLines = 100 } = {},
) {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\0")
    .filter(
      (p) =>
        p &&
        sourcePath(p) &&
        !testPath(p) &&
        !EXCLUDED_DIRS.test(p) &&
        !/(?:secret|credential|\.min\.|\.generated\.|\.stories\.|\.config\.|demoSeedUtils)/i.test(
          p,
        ),
    )
    .sort();
  const pool = [];
  for (const path of files) {
    let source;
    try {
      source = readFileSync(join(repoDir, path), "utf8");
    } catch {
      continue;
    }
    if (
      source.length > 150000 ||
      secretLike(source) ||
      /@generated|auto.generated|DO NOT EDIT/i.test(source.slice(0, 4096))
    )
      continue;
    const ext = extOf(path);
    let ast;
    try {
      ast = parseSource(source, ext);
    } catch {
      continue;
    }
    for (const top of ast.program.body) {
      const decl =
        top.type === "ExportNamedDeclaration" ||
        top.type === "ExportDefaultDeclaration"
          ? top.declaration
          : top;
      if (!decl) continue;
      const text = source.slice(decl.start, decl.end);
      if (decl.loc.end.line - decl.loc.start.line + 1 > maxLines + 10) continue;
      let info;
      try {
        info = analyze(text, ext);
      } catch {
        continue;
      }
      if (
        !info ||
        info.usesThis ||
        info.generator ||
        info.lines < minLines ||
        info.lines > maxLines ||
        secretLike(text)
      )
        continue;
      pool.push({
        repo,
        path,
        ext,
        text,
        info,
        startLine: decl.loc.start.line,
        endLine: decl.loc.end.line,
        sha256: hash(text),
      });
    }
  }
  return pool;
}
