import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hash } from "../../src/core.mjs";
import { fullCatalog } from "../../src/catalog.mjs";
import { LABELS } from "./labels.mjs";

const SOURCE_TYPES = ["human", "llm_reviewer", "author"];

export function loadCases(path) {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => join(path, f))
    : [path];
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          throw Error(`${file}:${i + 1}: malformed JSON`);
        }
      }),
  );
}

export function caseProblems(c) {
  const problems = [];
  const need = (ok, message) => ok || problems.push(message);
  need(typeof c.id === "string" && c.id.length > 0, "id required");
  need(
    fullCatalog.signals.some((s) => s.id === c.signalId),
    "signalId must name a catalog signal",
  );
  need(
    c.files &&
      typeof c.files === "object" &&
      Object.keys(c.files).length > 0 &&
      Object.entries(c.files).every(
        ([p, s]) =>
          typeof s === "string" &&
          /^[A-Za-z0-9_./-]+$/.test(p) &&
          !p.includes(".."),
      ),
    "files must map safe relative paths to source text",
  );
  need(
    LABELS.includes(c.label?.value),
    "label.value must be actionable, no_action or uncertain",
  );
  need(
    SOURCE_TYPES.includes(c.label?.source?.type),
    "label.source.type must be human, llm_reviewer or author",
  );
  need(
    typeof c.label?.source?.who === "string" && c.label.source.who.length > 0,
    "label.source.who required (a person, or the reviewer model)",
  );
  need(
    c.label?.source?.type !== "llm_reviewer" ||
      typeof c.label.source.model === "string",
    "llm_reviewer labels must name the model",
  );
  need(
    c.focus === undefined ||
      (Array.isArray(c.focus) && c.focus.every((n) => typeof n === "string")),
    "focus must be a list of function names",
  );
  return problems;
}

const shingles = (text) => {
  const tokens = text.split(/\W+/).filter(Boolean),
    out = new Set();
  for (let i = 0; i + 3 <= tokens.length; i++)
    out.add(tokens.slice(i, i + 3).join(" "));
  return out;
};
const jaccard = (a, b) => {
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both || 1);
};

export function auditCases(cases) {
  const problems = [],
    warnings = [];
  const ids = new Set();
  for (const c of cases) {
    for (const p of caseProblems(c)) problems.push(`${c.id ?? "?"}: ${p}`);
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
  }
  const valid = cases.filter((c) => caseProblems(c).length === 0);
  const text = (c) => Object.values(c.files).join("\n");
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i],
        b = valid[j];
      if (a.signalId !== b.signalId) continue;
      if (hash(text(a)) === hash(text(b)))
        warnings.push(
          `${a.id} and ${b.id}: identical source (exact duplicate)`,
        );
      else if (jaccard(shingles(text(a)), shingles(text(b))) >= 0.9)
        warnings.push(`${a.id} and ${b.id}: near-duplicate source`);
      if (hash(text(a)) === hash(text(b)) && a.label.value !== b.label.value)
        problems.push(`${a.id} and ${b.id}: same source with different labels`);
    }
  for (const c of valid) {
    const leak = new RegExp(
      `${c.signalId}|\\bexpected\\b|\\b(?:positive|negative) case\\b`,
      "i",
    );
    if (leak.test(text(c)) || Object.keys(c.files).some((p) => leak.test(p)))
      problems.push(
        `${c.id}: source or paths name the signal or the expected answer (label leakage)`,
      );
  }
  const bySignal = {};
  for (const c of valid) {
    const s = (bySignal[c.signalId] ??= {
      cases: 0,
      actionable: 0,
      no_action: 0,
      uncertain: 0,
      sources: {},
      bytes: [],
    });
    s.cases++;
    s[c.label.value]++;
    s.sources[c.label.source.type] = (s.sources[c.label.source.type] ?? 0) + 1;
    s.bytes.push(text(c).length);
  }
  for (const [id, s] of Object.entries(bySignal)) {
    if (!s.actionable || !s.no_action)
      warnings.push(
        `${id}: needs both actionable and no_action cases (has ${s.actionable} and ${s.no_action})`,
      );
    const graded = s.actionable + s.no_action;
    s.majorityBaseline = graded
      ? Math.max(s.actionable, s.no_action) / graded
      : null;
    if (Object.keys(s.sources).every((t) => t === "author"))
      warnings.push(
        `${id}: every label is author-written; these are sanity checks, not evidence for the gate`,
      );
    s.bytes = { min: Math.min(...s.bytes), max: Math.max(...s.bytes) };
  }
  return {
    cases: cases.length,
    valid: valid.length,
    problems,
    warnings,
    bySignal,
  };
}

export function caseProject(c) {
  const root = mkdtempSync(join(tmpdir(), "semantic-refactor-scan-case-"));
  for (const [path, source] of Object.entries(c.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}
