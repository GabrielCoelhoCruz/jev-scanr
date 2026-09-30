import _traverse from "@babel/traverse";
import {
  analyze,
  astKey,
  boundNames,
  parseSource,
  topFunction,
  walk,
} from "./code.mjs";

const traverse = _traverse.default ?? _traverse;
const edit = (start, end, text) => ({ start, end, text });

export function applyEdits(text, edits) {
  const sorted = edits
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i);
  const kept = [];
  let lastEnd = -1;
  for (const e of sorted) {
    if (e.start < lastEnd) continue;
    kept.push(e);
    lastEnd = Math.max(lastEnd, e.end);
  }
  let out = text;
  for (const e of kept.reverse())
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const TS_EXPR = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "TSParameterProperty",
]);
const inTypeContext = (path) =>
  !!path.findParent(
    (p) => p.node.type.startsWith("TS") && !TS_EXPR.has(p.node.type),
  );

function finish(text, ext, edits, check) {
  if (!edits.length) return null;
  const out = applyEdits(text, edits);
  if (out === text) return null;
  try {
    const info = analyze(out, ext);
    if (!info) return null;
    if (check && !check(out)) return null;
  } catch {
    return null;
  }
  return out;
}

const sameAst = (text, ext) => (out) =>
  astKey(parseSource(out, ext)) === astKey(parseSource(text, ext));

const SEMI_STATEMENTS = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
  "TSTypeAliasDeclaration",
]);
const ASI_HAZARD = /[([`+\-*/<,.:?=&|%^!~]/;

export function semicolons(text, ext) {
  const ast = parseSource(text, ext);
  const stmts = [];
  walk(ast.program, (n, parent, key) => {
    if (!SEMI_STATEMENTS.has(n.type)) return;
    if (
      n.type === "VariableDeclaration" &&
      /^For/.test(parent?.type) &&
      (key === "init" || key === "left")
    )
      return;
    stmts.push(n);
  });
  const withSemi = stmts.filter((n) => text[n.end - 1] === ";").length;
  const remove = withSemi * 2 >= stmts.length;
  const edits = [];
  for (const n of stmts) {
    if (remove) {
      if (text[n.end - 1] !== ";") continue;
      const after = /^((?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*)(.?)/.exec(
        text.slice(n.end),
      );
      if (after[2] && (ASI_HAZARD.test(after[2]) || !after[1].includes("\n"))) {
        if (after[2] !== "}") continue;
      }
      edits.push(edit(n.end - 1, n.end, ""));
    } else if (text[n.end - 1] !== ";") edits.push(edit(n.end, n.end, ";"));
  }
  return finish(text, ext, edits, sameAst(text, ext));
}

const SIMPLE = new Set([
  "ExpressionStatement",
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
]);

export function braces(text, ext) {
  const ast = parseSource(text, ext);
  const bodies = [];
  walk(ast.program, (n) => {
    if (n.type === "IfStatement") {
      bodies.push(n.consequent);
      if (n.alternate && n.alternate.type !== "IfStatement")
        bodies.push(n.alternate);
    } else if (
      [
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "WhileStatement",
      ].includes(n.type)
    )
      bodies.push(n.body);
  });
  const edits = [];
  const bare = bodies.filter((b) => b.type !== "BlockStatement");
  if (bare.length) {
    for (const b of bare) {
      edits.push(edit(b.start, b.start, "{ "), edit(b.end, b.end, " }"));
    }
  } else
    for (const b of bodies) {
      if (b.body?.length !== 1 || !SIMPLE.has(b.body[0].type)) continue;
      const inner = b.body[0],
        whole = text.slice(b.start, b.end);
      if (/\/\/|\/\*/.test(whole)) continue;
      let t = text.slice(inner.start, inner.end);
      if (!t.endsWith(";")) t += ";";
      edits.push(edit(b.start, b.end, t));
    }
  return finish(text, ext, edits);
}

export function trailingCommas(text, ext) {
  const ast = parseSource(text, ext);
  const lists = [];
  walk(ast.program, (n) => {
    let items;
    if (n.type === "ObjectExpression") items = n.properties;
    else if (n.type === "ArrayExpression") items = n.elements;
    else if (["CallExpression", "NewExpression"].includes(n.type))
      items = n.arguments;
    else if (n.type === "ObjectPattern")
      items = n.properties.some((p) => p.type === "RestElement")
        ? []
        : n.properties;
    else return;
    if (!items.length || items.some((x) => !x)) return;
    const last = items.at(-1),
      close = n.end - 1;
    if (!")]}".includes(text[close])) return;
    const between = text.slice(last.end, close);
    if (!between.includes("\n") && !/^\s*,\s*$/.test(between)) return;
    if (/^\s*,\s*$/.test(between))
      lists.push({ has: true, at: last.end + between.indexOf(",") });
    else if (/^\s*$/.test(between)) lists.push({ has: false, at: last.end });
  });
  const remove = lists.filter((l) => l.has).length * 2 >= lists.length;
  const edits = lists.flatMap((l) =>
    remove && l.has
      ? [edit(l.at, l.at + 1, "")]
      : !remove && !l.has
        ? [edit(l.at, l.at, ",")]
        : [],
  );
  return finish(text, ext, edits, sameAst(text, ext));
}

const arrowToken = (ast, fn) =>
  ast.tokens
    .filter(
      (t) =>
        typeof t.type !== "string" &&
        t.type.label === "=>" &&
        t.start >= fn.start &&
        t.end <= fn.body.start,
    )
    .at(-1);

export function arrowParens(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n) => {
    if (n.type !== "ArrowFunctionExpression" || n.params.length !== 1) return;
    const p = n.params[0];
    if (p.type !== "Identifier" || p.typeAnnotation || p.optional) return;
    if (n.returnType || n.typeParameters) return;
    const header = text.slice(n.start, n.body.start);
    let m = /^(async\s+)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*$/.exec(header);
    if (m)
      return void edits.push(
        edit(n.start, n.body.start, `${m[1] ?? ""}${m[2]} => `),
      );
    m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*$/.exec(header);
    if (m)
      edits.push(edit(n.start, n.body.start, `${m[1] ?? ""}(${m[2]}) => `));
  });
  return finish(text, ext, edits);
}

export function arrowBody(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n) => {
    if (n.type !== "ArrowFunctionExpression") return;
    if (n.body.type !== "BlockStatement") {
      const arrow = arrowToken(ast, n);
      if (!arrow) return;
      const tail = text.slice(arrow.end, n.end).trim();
      edits.push(edit(arrow.end, n.end, ` { return ${tail}; }`));
      return false;
    }
    const b = n.body;
    if (b.body.length !== 1 || b.body[0].type !== "ReturnStatement") return;
    const arg = b.body[0].argument;
    if (!arg || /\/\/|\/\*/.test(text.slice(b.start, b.end))) return;
    let t = text.slice(arg.start, arg.end);
    if (
      ["ObjectExpression", "SequenceExpression"].includes(arg.type) ||
      t.startsWith("{")
    )
      t = `(${t})`;
    edits.push(edit(b.start, b.end, t));
    return false;
  });
  return finish(text, ext, edits);
}

export function callbackForm(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n, parent) => {
    if (parent?.type !== "CallExpression" || !parent.arguments.includes(n))
      return;
    if (n.type === "ArrowFunctionExpression") {
      if (n.returnType || n.typeParameters) return;
      const header = text.slice(n.start, n.body.start);
      const arrow = arrowToken(ast, n);
      if (!arrow) return;
      const head = text.slice(n.start, arrow.start);
      let m = /^(async\s+)?\(([\s\S]*)\)\s*$/.exec(head);
      let isAsync = m?.[1],
        params = m?.[2];
      if (!m) {
        m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(head);
        if (!m) return;
        isAsync = m[1];
        params = m[2];
      }
      const tail = text.slice(arrow.end, n.end).trim();
      const body =
        n.body.type === "BlockStatement" ? tail : `{ return ${tail}; }`;
      edits.push(
        edit(n.start, n.end, `${isAsync ?? ""}function (${params}) ${body}`),
      );
      return void header;
    }
    if (n.type === "FunctionExpression" && !n.id && !n.generator) {
      if (n.returnType || n.typeParameters) return;
      const head = text.slice(n.start, n.body.start);
      const m = /^(async\s+)?function\s*\(([\s\S]*)\)\s*$/.exec(head);
      if (!m) return;
      edits.push(
        edit(
          n.start,
          n.end,
          `${m[1] ?? ""}(${m[2]}) => ${text.slice(n.body.start, n.end)}`,
        ),
      );
    }
  });
  return finish(text, ext, edits);
}

const SAFE_CONCAT = new Set([
  "Identifier",
  "MemberExpression",
  "OptionalMemberExpression",
  "CallExpression",
  "NumericLiteral",
  "StringLiteral",
  "ThisExpression",
]);
const SAFE_PARENT = new Set([
  "VariableDeclarator",
  "ReturnStatement",
  "CallExpression",
  "ObjectProperty",
  "JSXExpressionContainer",
  "ExpressionStatement",
  "ArrayExpression",
  "ThrowStatement",
]);

export function templateConcat(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n, parent) => {
    if (n.type !== "TemplateLiteral" || !n.expressions.length) return;
    if (parent?.type === "TaggedTemplateExpression") return;
    if (n.quasis.some((q) => q.value.cooked === null)) return;
    const parts = [];
    n.quasis.forEach((q, i) => {
      if (q.value.cooked !== "") parts.push(JSON.stringify(q.value.cooked));
      const e = n.expressions[i];
      if (e) {
        const t = text.slice(e.start, e.end);
        parts.push(SAFE_CONCAT.has(e.type) ? t : `(${t})`);
      }
    });
    if (!parts[0].startsWith('"')) parts.unshift('""');
    const joined = parts.join(" + ");
    edits.push(
      edit(
        n.start,
        n.end,
        SAFE_PARENT.has(parent?.type) ? joined : `(${joined})`,
      ),
    );
    return false;
  });
  return finish(text, ext, edits);
}

export function literalForms(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n, parent, key) => {
    const propKey =
      ["ObjectProperty", "ObjectMethod", "ClassProperty"].includes(
        parent?.type,
      ) &&
      key === "key" &&
      !parent.computed;
    if (n.type === "BooleanLiteral") {
      if (
        propKey ||
        ["TSLiteralType", "JSXAttribute"].includes(parent?.type) ||
        (parent?.type === "MemberExpression" && key === "object")
      )
        return;
      edits.push(edit(n.start, n.end, n.value ? "!0" : "!1"));
    } else if (n.type === "Identifier" && n.name === "undefined") {
      if (
        propKey ||
        parent?.type.startsWith("TS") ||
        parent?.shorthand ||
        (parent?.type.endsWith("MemberExpression") &&
          (key === "object" || (key === "property" && !parent.computed))) ||
        (parent?.type === "AssignmentExpression" && key === "left") ||
        (parent?.type === "CallExpression" && key === "callee")
      )
        return;
      edits.push(edit(n.start, n.end, "void 0"));
    }
  });
  return finish(text, ext, edits);
}

export function quotes(text, ext) {
  const ast = parseSource(text, ext);
  const strings = [];
  walk(ast.program, (n, parent) => {
    if (n.type === "StringLiteral" && parent?.type !== "JSXAttribute")
      strings.push(n);
  });
  const single = strings.filter((s) => text[s.start] === "'").length;
  const from = single * 2 >= strings.length ? "'" : '"',
    to = from === "'" ? '"' : "'";
  const edits = strings
    .filter(
      (s) =>
        text[s.start] === from &&
        !/['"\\`]/.test(text.slice(s.start + 1, s.end - 1)),
    )
    .map((s) =>
      edit(s.start, s.end, to + text.slice(s.start + 1, s.end - 1) + to),
    );
  return finish(text, ext, edits, sameAst(text, ext));
}

const PURE = new Set([
  "NumericLiteral",
  "StringLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "BigIntLiteral",
  "RegExpLiteral",
  "Identifier",
  "ArrowFunctionExpression",
  "FunctionExpression",
]);
function pure(n) {
  if (!n) return true;
  if (PURE.has(n.type)) return true;
  switch (n.type) {
    case "TemplateLiteral":
      return n.expressions.every(pure);
    case "ObjectExpression":
      return n.properties.every((p) =>
        p.type === "ObjectProperty"
          ? (!p.computed || pure(p.key)) && pure(p.value)
          : p.type === "ObjectMethod" ||
            (p.type === "SpreadElement" && pure(p.argument)),
      );
    case "ArrayExpression":
      return n.elements.every(
        (e) => !e || pure(e.type === "SpreadElement" ? e.argument : e),
      );
    case "MemberExpression":
      return pure(n.object) && (!n.computed || pure(n.property));
    case "UnaryExpression":
      return (
        ["!", "-", "+", "typeof", "void"].includes(n.operator) &&
        pure(n.argument)
      );
    case "BinaryExpression":
    case "LogicalExpression":
      return pure(n.left) && pure(n.right);
    case "ConditionalExpression":
      return pure(n.test) && pure(n.consequent) && pure(n.alternate);
    case "TSAsExpression":
    case "TSNonNullExpression":
      return pure(n.expression);
    default:
      return false;
  }
}
const refs = (n) => {
  const s = new Set();
  walk(n, (x) => {
    if (x.type === "Identifier") s.add(x.name);
  });
  return s;
};

export function reorder(text, ext, rng) {
  const ast = parseSource(text, ext);
  const top = topFunction(ast);
  if (top.fn.body.type !== "BlockStatement") return null;
  const body = top.fn.body.body,
    edits = [];
  for (let i = 0; i + 1 < body.length; i++) {
    const a = body[i],
      b = body[i + 1];
    let ok = false;
    if (a.type === "FunctionDeclaration" && b.type === "FunctionDeclaration")
      ok = true;
    else if (
      a.type === "VariableDeclaration" &&
      b.type === "VariableDeclaration" &&
      a.declarations.length === 1 &&
      b.declarations.length === 1 &&
      a.declarations[0].init &&
      b.declarations[0].init &&
      pure(a.declarations[0].init) &&
      pure(b.declarations[0].init)
    ) {
      const na = new Set(boundNames(a.declarations[0].id)),
        nb = new Set(boundNames(b.declarations[0].id)),
        ra = refs(a),
        rb = refs(b);
      ok = ![...na].some((x) => rb.has(x)) && ![...nb].some((x) => ra.has(x));
    }
    if (!ok || rng() < 0.3) continue;
    edits.push(
      edit(
        a.start,
        b.end,
        text.slice(b.start, b.end) +
          text.slice(a.end, b.start) +
          text.slice(a.start, a.end),
      ),
    );
    i++;
  }
  return finish(text, ext, edits);
}

export function swapParams(text, ext) {
  const ast = parseSource(text, ext);
  const { fn } = topFunction(ast);
  const ps = fn.params;
  if (ps.length < 2 || ps.some((p) => p.type !== "Identifier" || p.optional))
    return null;
  for (let i = 1; i < ps.length; i++)
    if (!/^\s*,\s*$/.test(text.slice(ps[i - 1].end, ps[i].start))) return null;
  const swapped = ps
    .map((p) => text.slice(p.start, p.end))
    .reverse()
    .join(", ");
  return finish(text, ext, [edit(ps[0].start, ps.at(-1).end, swapped)]);
}

const GENERIC = [
  "item",
  "entry",
  "value",
  "input",
  "output",
  "current",
  "next",
  "temp",
  "source",
  "target",
  "record",
  "node",
  "chunk",
  "slot",
  "part",
  "unit",
  "token",
  "cursor",
  "bucket",
  "group",
];

export function renameLocals(text, ext) {
  const ast = parseSource(text, ext);
  const top = topFunction(ast);
  const info = analyze(text, ext);
  const names = new Set(info.locals);
  const used = new Set();
  walk(ast.program, (n) => {
    if (n.type === "Identifier") used.add(n.name);
  });
  const assigned = new Map();
  let k = 0,
    unsafe = false;
  const edits = [];
  const fresh = (binding) => {
    if (!assigned.has(binding.identifier)) {
      let name;
      do {
        name =
          GENERIC[k % GENERIC.length] +
          (k >= GENERIC.length ? Math.floor(k / GENERIC.length) + 1 : "");
        k++;
      } while (used.has(name));
      assigned.set(binding.identifier, name);
    }
    return assigned.get(binding.identifier);
  };
  const visit = (path, isJsx) => {
    const node = path.node,
      parent = path.parent;
    if (!names.has(node.name)) return;
    if (!isJsx && inTypeContext(path)) {
      unsafe = true;
      return;
    }
    if (
      (parent.type.endsWith("MemberExpression") &&
        path.key === "property" &&
        !parent.computed) ||
      ([
        "ObjectProperty",
        "ObjectMethod",
        "ClassProperty",
        "ClassMethod",
      ].includes(parent.type) &&
        path.key === "key" &&
        !parent.computed) ||
      ["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(
        parent.type,
      ) ||
      (isJsx &&
        !(
          (["JSXOpeningElement", "JSXClosingElement"].includes(parent.type) &&
            path.key === "name") ||
          (parent.type === "JSXMemberExpression" && path.key === "object")
        ))
    )
      return;
    const binding = path.scope.getBinding(node.name);
    if (!binding) return;
    const inside =
      binding.identifier.start >= top.fn.start &&
      binding.identifier.end <= top.fn.end;
    if (!inside) return;
    const next = fresh(binding);
    const shorthand =
      (parent.type === "ObjectProperty" &&
        parent.shorthand &&
        path.key === "value") ||
      (parent.type === "AssignmentPattern" &&
        path.key === "left" &&
        path.parentPath.parent.type === "ObjectProperty" &&
        path.parentPath.parent.shorthand);
    edits.push(
      edit(
        node.start,
        node.start + node.name.length,
        shorthand ? `${node.name}: ${next}` : next,
      ),
    );
  };
  traverse(ast, {
    Identifier: (p) => visit(p, false),
    JSXIdentifier: (p) => visit(p, true),
  });
  if (unsafe) return null;
  return finish(text, ext, edits);
}

export function constToLet(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n, parent) => {
    if (n.type !== "VariableDeclaration" || n.kind !== "const") return;
    if (n.declare || (/^For(?:In|Of)/.test(parent?.type) && parent.left === n))
      return;
    edits.push(edit(n.start, n.start + 5, "let"));
  });
  return finish(text, ext, edits);
}

export function updateForms(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n, parent, key) => {
    const statementLevel =
      (parent?.type === "ExpressionStatement" && key === "expression") ||
      (parent?.type === "ForStatement" && key === "update");
    if (!statementLevel) return;
    if (n.type === "UpdateExpression" && n.argument.type === "Identifier")
      edits.push(
        edit(
          n.start,
          n.end,
          `${n.argument.name} ${n.operator === "++" ? "+=" : "-="} 1`,
        ),
      );
    else if (
      n.type === "AssignmentExpression" &&
      ["+=", "-="].includes(n.operator) &&
      n.left.type === "Identifier"
    ) {
      const r = text.slice(n.right.start, n.right.end);
      edits.push(
        edit(
          n.start,
          n.end,
          `${n.left.name} = ${n.left.name} ${n.operator[0]} ${SAFE_CONCAT.has(n.right.type) ? r : `(${r})`}`,
        ),
      );
    }
  });
  return finish(text, ext, edits);
}

const FLIP = { "!==": "===", "!=": "==" };
export function invertConditions(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n) => {
    const conditional = n.type === "ConditionalExpression";
    if (!(conditional || (n.type === "IfStatement" && n.alternate))) return;
    if (!conditional && n.alternate.type === "IfStatement") return;
    const t = n.test;
    let testText;
    if (
      t.type === "UnaryExpression" &&
      t.operator === "!" &&
      !t.extra?.parenthesized
    )
      testText = text.slice(t.argument.start, t.argument.end);
    else if (t.type === "BinaryExpression" && FLIP[t.operator])
      testText = `${text.slice(t.left.start, t.left.end)} ${FLIP[t.operator]} ${text.slice(t.right.start, t.right.end)}`;
    else return;
    if (
      t.type === "UnaryExpression" &&
      [
        "LogicalExpression",
        "ConditionalExpression",
        "AssignmentExpression",
        "SequenceExpression",
      ].includes(t.argument.type) &&
      !t.argument.extra?.parenthesized
    )
      testText = `(${testText})`;
    const a = conditional ? n.consequent : n.consequent,
      b = n.alternate;
    if (/\/\/|\/\*/.test(text.slice(n.start, n.end))) return;
    edits.push(
      edit(t.start, t.end, testText),
      edit(a.start, a.end, text.slice(b.start, b.end)),
      edit(b.start, b.end, text.slice(a.start, a.end)),
    );
    return false;
  });
  return finish(text, ext, edits);
}

export function parenWrap(text, ext) {
  const ast = parseSource(text, ext);
  const edits = [];
  walk(ast.program, (n) => {
    if (
      n.type === "ReturnStatement" &&
      n.argument &&
      !n.argument.extra?.parenthesized
    )
      edits.push(
        edit(n.argument.start, n.argument.start, "("),
        edit(n.argument.end, n.argument.end, ")"),
      );
  });
  return finish(text, ext, edits, sameAst(text, ext));
}

export const BASE_PASSES = [
  ["rename", renameLocals],
  ["reorder", reorder],
  ["swapParams", swapParams],
  ["quotes", quotes],
];
export const STRUCTURE_PASSES = [
  ["semicolons", semicolons],
  ["braces", braces],
  ["trailingCommas", trailingCommas],
  ["arrowParens", arrowParens],
  ["arrowBody", arrowBody],
  ["callbackForm", callbackForm],
  ["templateConcat", templateConcat],
  ["literalForms", literalForms],
  ["constToLet", constToLet],
  ["updateForms", updateForms],
  ["invertConditions", invertConditions],
  ["parenWrap", parenWrap],
];
