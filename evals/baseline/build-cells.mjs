#!/usr/bin/env node
// Stage A of the free-baseline comparison. Joins stored Jev answers, stored LLM labels and the source at the
// pinned commits into evals/baseline/cells.json (no source text, no API call). It needs private handoff inputs,
// so only the maintainers can rerun it; everybody can rerun stage B (analyze.mjs) from the committed cells.json.
//
//   node evals/baseline/build-cells.mjs --map FILE --repos DIR [--out evals/baseline/cells.json]
//
// --map: JSON that says where each private input lives (see INPUTS for the names; "gateManifest" and
// "gateJournal" map a repository to its files, "showReports" is a list of [file, repository]).
// Paths are relative to the map file. The script pins every input by sha256 where the sample is frozen.
// --repos: one folder per repository (claude-office, reshaped, t3code, oh-my-pi), each checked out at the
// commit named in PINNED below.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "@babel/parser";
import { hash } from "../../src/core.mjs";
import { allSignals } from "../../src/catalog.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const DEFAULT_SIGNALS = allSignals
  .filter((s) => s.status === "default")
  .map((s) => s.id);
const PRESENCE = Object.fromEntries(allSignals.map((s) => [s.id, s.presence]));

const PINNED = {
  "paulrobello/claude-office": {
    dir: "claude-office",
    commit: "3522c16399660ac787cd1f4ad4f3255352ec8e6c",
  },
  "reshaped-ui/reshaped": {
    dir: "reshaped",
    commit: "cf7ac31a5aa91ea50ae2c5fd3bb3b420329adaf1",
  },
  "pingdotgg/t3code": {
    dir: "t3code",
    commit: "0fcd5f90611451cca842689faea53b5450c022da",
  },
  "can1357/oh-my-pi": {
    dir: "oh-my-pi",
    commit: "2b023d1b80133c523d66412602d99b5427408395",
  },
};

const INPUTS = {
  gateCards: "60e57aab09c276eb7eea0013164aa3c7488b03eca24a2246722899fd4a2bb56e",
  gatePass1: "c8b4ce8fd132c00d564c43f8a3fc9fe86bdb3fa0bc44ef15239abb589aeb18dd",
  gatePass2: "5a14b6f62592c8915705cad62fb7732012dfd8e5125657cb358d44e9f17cbed8",
  gateSecond:
    "582d6054f2c7c52a8ac6bac893d7f44469e71c70555b5e48ebad161b0b0a79d0",
  gateResult: null,
  gateReceipt: null,
  showCards: "81f8296cfc694fe6b0f39388d079d0e435562fc5f6496d78659c6e7a1c88f513",
  showPass1: "c0391f87618e9ee1dd588ced93a1eece998591411174e897e1f74e8dcb5e1a3f",
  showPass2: "a6785c3f693b1c92f2104f9e63432e30d454aaee4171c4b7635a9f0849737daf",
  showResult: null,
  showReceipt: null,
};

const { values: args } = parseArgs({
  options: {
    map: { type: "string" },
    repos: { type: "string" },
    out: { type: "string", default: "evals/baseline/cells.json" },
  },
});
if (!args.map || !args.repos)
  throw Error("Usage: build-cells.mjs --map FILE --repos DIR [--out FILE]");

const mapDir = dirname(resolve(args.map));
const where = JSON.parse(readFileSync(args.map, "utf8"));
const inputHashes = {};
const load = (label, path, expected = null) => {
  const bytes = readFileSync(resolve(mapDir, path));
  const got = sha(bytes);
  if (expected && got !== expected)
    throw Error(`${label}: sha256 ${got} differs from the pinned ${expected}`);
  inputHashes[label] = got;
  return bytes;
};
const read = (name) => JSON.parse(load(name, where[name], INPUTS[name]));

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
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
const LOGICAL = new Set(["&&", "||", "??"]);
const LOGICAL_ASSIGN = new Set(["&&=", "||=", "??="]);

function walk(node, fn) {
  if (!node || typeof node.type !== "string" || node.type.startsWith("Comment"))
    return;
  fn(node);
  for (const [key, value] of Object.entries(node))
    if (!SKIP_KEYS.has(key))
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child.type === "string") walk(child, fn);
}

const fileCache = new Map();
function loadFile(repo, path) {
  const cacheKey = `${repo}:${path}`;
  if (fileCache.has(cacheKey)) return fileCache.get(cacheKey);
  const bytes = readFileSync(join(args.repos, PINNED[repo].dir, path));
  const source = bytes.toString("utf8");
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: [
      ...(/\.[cm]?tsx?$/.test(path) ? ["typescript"] : []),
      ...(/\.[jt]sx$/.test(path) ? ["jsx"] : []),
    ],
    tokens: true,
  });
  const entry = { source, ast, sha256: sha(bytes) };
  fileCache.set(cacheKey, entry);
  return entry;
}

function findFunction(ast, start, end) {
  let found = null;
  walk(ast.program, (n) => {
    if (
      !found &&
      FUNCTION_TYPES.has(n.type) &&
      n.start === start &&
      n.end === end
    )
      found = n;
  });
  return found;
}

function memberFacts(repo, member) {
  const file = loadFile(repo, member.path);
  if (file.sha256 !== member.fileSHA256)
    throw Error(`${member.path}: file hash differs from the card`);
  const { startOffset: start, endOffset: end } = member.range;
  const node = findFunction(file.ast, start, end);
  if (!node)
    throw Error(
      `${member.path}:${member.range.startLine} is not a function node`,
    );
  let statements = 0,
    cyclomatic = 1;
  walk(node, (n) => {
    if (
      (n.type.endsWith("Statement") &&
        n.type !== "BlockStatement" &&
        n.type !== "EmptyStatement") ||
      n.type === "VariableDeclaration"
    )
      statements++;
    if (BRANCHES.has(n.type)) cyclomatic++;
    if (n.type === "SwitchCase" && n.test) cyclomatic++;
    if (n.type === "LogicalExpression" && LOGICAL.has(n.operator)) cyclomatic++;
    if (n.type === "AssignmentExpression" && LOGICAL_ASSIGN.has(n.operator))
      cyclomatic++;
  });
  const tokens = file.ast.tokens
    .filter(
      (t) => t.start >= start && t.end <= end && typeof t.type !== "string",
    )
    .map((t) => ({
      label: t.type.label,
      value: file.source.slice(t.start, t.end),
    }));
  return {
    lines: member.range.endLine - member.range.startLine + 1,
    statements,
    cyclomatic,
    params: node.params.length,
    tokens: tokens.length,
    tokenList: tokens,
  };
}

const STR = new Set(["string", "template"]);
const normalize = (t) =>
  t.label === "name"
    ? "ID"
    : STR.has(t.label)
      ? "STR"
      : t.label === "num"
        ? "NUM"
        : t.value;
const windows = (seq, k) => {
  const out = [];
  for (let i = 0; i + k <= seq.length; i++)
    out.push(seq.slice(i, i + k).join("\u001f"));
  return out;
};
const jaccard = (a, b) => {
  const sa = new Set(a),
    sb = new Set(b);
  let common = 0;
  for (const x of sa) if (sb.has(x)) common++;
  return common / (sa.size + sb.size - common || 1);
};
function coverage(small, other, k) {
  const inOther = new Set(windows(other, k));
  const covered = new Set();
  windows(small, k).forEach((w, i) => {
    if (inOther.has(w)) for (let j = i; j < i + k; j++) covered.add(j);
  });
  return small.length ? covered.size / small.length : 0;
}
function pairFeatures(a, b) {
  const rawA = a.tokenList.map((t) => t.value),
    rawB = b.tokenList.map((t) => t.value);
  const [small, other] =
    rawA.length <= rawB.length ? [rawA, rawB] : [rawB, rawA];
  return {
    retrievalJaccard: jaccard(
      windows(a.tokenList.map(normalize), 5),
      windows(b.tokenList.map(normalize), 5),
    ),
    rawJaccard5: jaccard(windows(rawA, 5), windows(rawB, 5)),
    jscpdCoverage10: coverage(small, other, 10),
    jscpdCoverage50: coverage(small, other, 50),
    minLines: Math.min(a.lines, b.lines),
    minTokens: Math.min(a.tokens, b.tokens),
  };
}

function featuresFor(repo, members, kind) {
  if (kind === "clone_pair")
    return pairFeatures(
      memberFacts(
        repo,
        members.find((m) => m.role === "pair.a"),
      ),
      memberFacts(
        repo,
        members.find((m) => m.role === "pair.b"),
      ),
    );
  const { tokenList: _tokens, ...rest } = memberFacts(repo, members[0]);
  return rest;
}

const labelsOf = (file) =>
  new Map(
    file.cards.flatMap((c) =>
      c.evaluations.map((e) => [`${c.cardId}|${e.signalId}`, e.label]),
    ),
  );

const probability = (answer, signalId) =>
  !answer || answer.choice === "insufficient"
    ? null
    : (answer.probabilities[PRESENCE[signalId]] ?? null);

const gateReceipt = read("gateReceipt"),
  showReceipt = read("showReceipt");
const cardIndex = new Map();
const cardKeyOf = (pack, unitId, packId) =>
  pack.split?.type === "line_window"
    ? hash(["function_chunk", unitId, pack.split.startLine, pack.split.endLine])
    : pack.split
      ? unitId
      : packId;
const addCells = (cardId, repo, cells) => {
  const entry = cardIndex.get(cardId) ?? { repo, cells: new Map() };
  for (const [signalId, p] of cells) entry.cells.set(signalId, p);
  cardIndex.set(cardId, entry);
};

for (const repo of ["paulrobello/claude-office", "reshaped-ui/reshaped"]) {
  const manifestBytes = load(`gateManifest:${repo}`, where.gateManifest[repo]),
    journalBytes = load(`gateJournal:${repo}`, where.gateJournal[repo]);
  const manifest = JSON.parse(manifestBytes);
  const finished = new Map(
    journalBytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "finished")
      .map((e) => [e.unitId, e]),
  );
  for (const pack of manifest.units) {
    const event = finished.get(pack.id);
    const cells = new Map();
    for (const [signalId, eligibility] of Object.entries(
      pack.questionEligibility,
    ))
      if (eligibility.status === "eligible" && event?.status === "succeeded")
        cells.set(
          signalId,
          probability(event.response.answers[signalId], signalId),
        );
    const cardKey = cardKeyOf(pack, pack.unitId, pack.id);
    const cardId = hash([
      gateReceipt.blindSampling.seed,
      "card",
      manifest.planHash,
      cardKey,
    ]);
    addCells(cardId, repo, cells);
  }
}

for (const [rel, repo] of where.showReports) {
  const bytes = load(`showReport:${rel.split("/").slice(-2).join("/")}`, rel);
  const report = JSON.parse(bytes);
  for (const block of report.blocks)
    for (const part of block.parts) {
      const cardKey = cardKeyOf(part, block.unitId, part.packId);
      const cardId = hash([
        showReceipt.blindSampling.seed,
        "card",
        report.planHash,
        cardKey,
      ]);
      const cells = new Map(
        block.signals
          .filter((c) => c.packId === part.packId && c.status === "scored")
          .map((c) => [c.signalId, c.pPositive]),
      );
      addCells(cardId, repo, cells);
    }
}

const p1 = {
  gate: labelsOf(read("gatePass1")),
  showcase: labelsOf(read("showPass1")),
};
const p2 = {
  gate: labelsOf(read("gatePass2")),
  showcase: labelsOf(read("showPass2")),
};
const second = new Map(
  read("gateSecond").labels.map((l) => [`${l.cardId}|${l.signalId}`, l.label]),
);

const cells = [],
  dropped = {};
for (const [sample, cards] of [
  ["gate", read("gateCards").cards],
  ["showcase", read("showCards").cards],
]) {
  for (const card of cards) {
    const indexed = cardIndex.get(card.cardId);
    if (!indexed)
      throw Error(`card ${card.cardId.slice(0, 12)} has no matching pack`);
    const repo = card.repository.split("@")[0];
    if (indexed.repo !== repo || !card.repository.endsWith(PINNED[repo].commit))
      throw Error("card repository or commit differs from the pinned one");
    for (const signalId of card.signalIds) {
      const p = indexed.cells.get(signalId);
      if (p === undefined || p === null)
        throw Error(
          `card ${card.cardId.slice(0, 12)} ${signalId}: no scored P in the stored answers`,
        );
      if (!DEFAULT_SIGNALS.includes(signalId)) {
        dropped[signalId] = (dropped[signalId] ?? 0) + 1;
        continue;
      }
      const key = `${card.cardId}|${signalId}`;
      const labels = { pass1: p1[sample].get(key), pass2: p2[sample].get(key) };
      if (!labels.pass1 || !labels.pass2)
        throw Error(`${key}: a label is missing`);
      if (second.has(key)) labels.second = second.get(key);
      cells.push({
        id: sha(key).slice(0, 16),
        sample,
        repository: repo,
        commit: PINNED[repo].commit,
        signalId,
        kind: card.kind,
        members: card.members.map((m) => ({
          name: m.name ?? null,
          path: m.path,
          startLine: m.range.startLine,
          endLine: m.range.endLine,
          role: m.role,
        })),
        p,
        labels,
        features: featuresFor(repo, card.members, card.kind),
      });
    }
  }
}
cells.sort((a, b) => a.id.localeCompare(b.id));

const gateResult = read("gateResult"),
  showResult = read("showResult");
const mismatches = [];
for (const signalId of DEFAULT_SIGNALS) {
  const check = (name, got, want) =>
    got !== want &&
    mismatches.push(`${signalId} ${name}: ${got} vs published ${want}`);
  const view = Object.values(gateResult.views)[0].perSignal[signalId].pooled;
  const gate = cells.filter(
    (c) => c.sample === "gate" && c.signalId === signalId,
  );
  const above = gate.filter((c) => c.p >= 0.7),
    below = gate.filter((c) => c.p < 0.7);
  const isAction = (c) => c.labels.pass1 === "actionable";
  check("gate above n", above.length, view.above.n);
  check(
    "gate above actionable",
    above.filter(isAction).length,
    view.above.actionable,
  );
  check("gate near-below n", below.length, view.nearBelow.n);
  check(
    "gate near-below actionable",
    below.filter(isAction).length,
    view.nearBelow.actionable,
  );
  const published = showResult.pass1.bySignal[signalId].pooled;
  const show = cells.filter(
    (c) => c.sample === "showcase" && c.signalId === signalId,
  );
  check("showcase n", show.length, published.n);
  check(
    "showcase actionable",
    show.filter(isAction).length,
    published.actionable,
  );
}
if (mismatches.length)
  throw Error(
    `Reconstruction differs from the published counts:\n${mismatches.join("\n")}`,
  );

writeFileSync(
  args.out,
  JSON.stringify(
    {
      schema: "baseline-cells/1",
      meaning:
        "One row per labeled cell (unit x default signal) of two independent samples: the validation gate (claude-office, reshaped) and the showcase sample (t3code, oh-my-pi). p is Jev's stored P(positive option). Labels come from an LLM reviewer (pass1 sealed before repository access, pass2 anchored on pass1, second = a different LLM on some gate cells); no person has labeled them. Features are computed from the source at the pinned commit. No source text is stored and nothing here came from a new Jev call.",
      generatedBy: "evals/baseline/build-cells.mjs",
      inputs: inputHashes,
      pinned: PINNED,
      droppedNonDefaultSignalCells: dropped,
      cells,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${cells.length} cells written to ${args.out}; per-signal counts match the published gate and showcase aggregates.`,
);
