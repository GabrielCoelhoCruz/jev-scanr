#!/usr/bin/env node
// Generates the constructed-contrast units (see evals/contrast/README.md). Deterministic: the same pinned
// repositories and SEED give byte-identical output. No network, no API, no key.
//
//   node evals/contrast/build.mjs --repos DIR [--out evals/contrast/units.json] [--project DIR] [--check]
//
// --repos: one folder per repository (claude-office, reshaped, t3code, oh-my-pi) checked out at the commits in PINNED.
// --project: also write the excerpt files (the code a live run would send) under DIR/A, DIR/B, DIR/C.
// --check: regenerate and fail if the result differs from --out.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { hash, secretLike } from "../../src/core.mjs";
import {
  FUNCTION_TYPES,
  analyze,
  extractPool,
  functionFeatures,
  jaccard,
  nameWords,
  pairFeatures,
  walk,
} from "./lib/code.mjs";
import {
  BASE_PASSES,
  STRUCTURE_PASSES,
  applyEdits,
} from "./lib/transforms.mjs";
import {
  interner,
  jaccardSorted,
  nearest,
  rngFor,
  shuffle,
  tailPairs,
} from "./lib/match.mjs";

export const SEED = 20260930;
export const PER_CLASS = 50;
export const PINNED = {
  "paulrobello/claude-office": {
    dir: "claude-office",
    commit: "3522c16399660ac787cd1f4ad4f3255352ec8e6c",
    quota: 8,
  },
  "reshaped-ui/reshaped": {
    dir: "reshaped",
    commit: "cf7ac31a5aa91ea50ae2c5fd3bb3b420329adaf1",
    quota: 8,
  },
  "pingdotgg/t3code": {
    dir: "t3code",
    commit: "0fcd5f90611451cca842689faea53b5450c022da",
    quota: 17,
  },
  "can1357/oh-my-pi": {
    dir: "oh-my-pi",
    commit: "2b023d1b80133c523d66412602d99b5427408395",
    quota: 17,
  },
};
export const SETS = {
  A: {
    name: "should_split",
    signal: "function_should_split",
    presence: "split_candidate",
    kind: "function",
    mainHeuristic: "lines",
  },
  B: {
    name: "clone_same_policy",
    signal: "clone_same_policy",
    presence: "same_policy",
    kind: "clone_pair",
    mainHeuristic: "shingleJaccard",
  },
  C: {
    name: "name_vs_behavior",
    signal: "name_vs_behavior",
    presence: "name_mismatch",
    kind: "function",
    mainHeuristic: "lines",
  },
};

const indentOf = (text, at) => /[ \t]*$/.exec(text.slice(0, at))[0];
const nestedFunction = (n) =>
  FUNCTION_TYPES.has(n.type) ||
  ["ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(n.type);
const names = (info) => new Set([...info.vocab, ...info.locals, info.name]);
const ratio = (a, b) =>
  Math.min(a.info.lines, b.info.lines) / Math.max(a.info.lines, b.info.lines);
const sourceOf = (p, role) => ({
  role,
  repo: p.repo,
  path: p.path,
  startLine: p.startLine,
  endLine: p.endLine,
  name: p.info.name,
  sha256: p.sha256,
});

function returnsOf(fn) {
  const found = [];
  if (fn.body.type === "BlockStatement")
    walk(fn.body, (n) => {
      if (nestedFunction(n)) return false;
      if (n.type === "ReturnStatement") found.push(n);
    });
  return found;
}

function component(p, first) {
  const { info } = p,
    fn = info.top.fn;
  if (
    info.lines < 6 ||
    info.lines > 35 ||
    info.recursion ||
    fn.typeParameters ||
    ((info.top.form === "const") === false && false)
  )
    return false;
  if (fn.body.type !== "BlockStatement") return true;
  if (!fn.body.body.length) return false;
  if (!first) return true;
  const found = returnsOf(fn);
  return (
    found.length === 0 ||
    (found.length === 1 && found[0] === fn.body.body.at(-1))
  );
}

function partText(p, first, resultName) {
  const { text, info } = p,
    fn = info.top.fn;
  let body;
  if (fn.body.type !== "BlockStatement") {
    const e = text.slice(fn.body.start, fn.body.end);
    body = first ? `const ${resultName} = ${e};` : `return ${e};`;
    return "  " + body;
  }
  const stmts = fn.body.body,
    last = stmts.at(-1);
  if (first && last.type === "ReturnStatement") {
    if (last.argument)
      body = `${text.slice(stmts[0].start, last.start)}const ${resultName} = ${text.slice(last.argument.start, last.argument.end)};`;
    else if (stmts.length > 1)
      body = text.slice(stmts[0].start, stmts.at(-2).end);
    else return null;
  } else body = text.slice(stmts[0].start, last.end);
  return (indentOf(text, stmts[0].start) || "  ") + body;
}

export function makeChimera(a, b) {
  const fa = a.info.top.fn,
    fb = b.info.top.fn;
  if (a.ext !== b.ext || a.info.name === b.info.name) return null;
  const na = names(a.info),
    nb = names(b.info);
  if (
    [...a.info.locals].some((x) => nb.has(x)) ||
    [...b.info.locals].some((x) => na.has(x))
  )
    return null;
  if (
    fa.params.length &&
    fb.params.length &&
    fa.params.some((p) => p.type !== "Identifier" || p.optional)
  )
    return null;
  const resultName = `${a.info.name}Result`;
  if (na.has(resultName) || nb.has(resultName)) return null;
  const first = partText(a, true, resultName),
    second = partText(b, false, resultName);
  if (!first || !second) return null;
  const params = [fa.params, fb.params]
    .filter((ps) => ps.length)
    .map((ps, i) => {
      const src = i === 0 && fa.params.length ? a.text : b.text;
      return src.slice(ps[0].start, ps.at(-1).end);
    })
    .join(", ");
  const isAsync = fa.async || fb.async ? "async " : "";
  const head =
    a.info.top.form === "const"
      ? `const ${a.info.name} = ${isAsync}(${params}) => {`
      : `${isAsync}function ${a.info.name}(${params}) {`;
  const text = `${head}\n${first}\n\n${second}\n}${a.info.top.form === "const" ? ";" : ""}\n`;
  if (secretLike(text)) return null;
  const info = analyze(text, a.ext);
  if (!info || info.recursion || info.returns > returnsOf(fb).length + 1)
    return null;
  return {
    text,
    info,
    seamLine: head.split("\n").length + first.split("\n").length + 2,
  };
}

function buildA(ctx) {
  const rng = rngFor(SEED, "A");
  const used = new Set();
  const key = (p) => `${p.repo}:${p.path}:${p.startLine}`;
  const top = (p) => p.path.split("/").slice(0, 2).join("/");
  const positives = [];
  let rejected = 0;
  for (const [repo, { quota }] of Object.entries(PINNED)) {
    const pool = ctx.pools[repo];
    const firsts = shuffle(
      pool.filter((p) => component(p, true)),
      rng,
    );
    const seconds = pool.filter((p) => component(p, false));
    let made = 0;
    for (const a of firsts) {
      if (made >= quota) break;
      if (used.has(key(a))) continue;
      for (let tries = 0; tries < 60; tries++) {
        const b = seconds[Math.floor(rng() * seconds.length)];
        if (
          used.has(key(b)) ||
          b.path === a.path ||
          (tries < 40 && top(a) === top(b))
        )
          continue;
        if (
          [...nameWords(a.info.name)].some((w) => b.info.words.has(w)) ||
          [...nameWords(b.info.name)].some((w) => a.info.words.has(w)) ||
          jaccard(a.info.vocab, b.info.vocab) > 0.3
        )
          continue;
        const chimera = makeChimera(a, b);
        if (!chimera) {
          rejected++;
          continue;
        }
        used.add(key(a)).add(key(b));
        positives.push({ repo, a, b, ...chimera });
        made++;
        break;
      }
    }
    if (made < quota)
      throw Error(`set A: only ${made}/${quota} chimeras for ${repo}`);
  }
  const controls = [];
  const taken = new Set();
  for (const pos of shuffle(positives, rng)) {
    const t = pos.info;
    const pool = ctx.pools[pos.repo].filter(
      (p) =>
        p.info.lines >= 8 &&
        !p.info.recursion &&
        !used.has(key(p)) &&
        Math.abs(p.info.lines - t.lines) <=
          Math.max(2, Math.round(0.1 * t.lines)),
    );
    const best = nearest(
      pool,
      (c) =>
        (Math.abs(c.info.lines - t.lines) / Math.max(t.lines, 8)) * 4 +
        Math.abs(c.info.tokens - t.tokens) / Math.max(t.tokens, 50) +
        0.1 * Math.abs(c.info.params - t.params),
      (c) => taken.has(key(c)),
    );
    if (!best)
      throw Error(
        `set A: no length-matched control for ${t.lines} lines in ${pos.repo}`,
      );
    taken.add(key(best.item));
    controls.push({ pos, control: best.item });
  }
  const units = [];
  positives.forEach((p, i) =>
    units.push({
      set: "A",
      label: 1,
      role: "chimera",
      index: i,
      ext: p.a.ext,
      texts: [p.text],
      source: [sourceOf(p.a, "part.first"), sourceOf(p.b, "part.second")],
      recipe: {
        op: "concatenate_two_unrelated_functions",
        seamLine: p.seamLine,
        nameFrom: "part.first",
        returnTypesDropped: true,
      },
      features: functionFeatures(p.info),
    }),
  );
  controls.forEach(({ pos, control }, i) =>
    units.push({
      set: "A",
      label: 0,
      role: "control",
      index: i,
      ext: control.ext,
      texts: [control.text],
      source: [sourceOf(control, "control")],
      recipe: {
        op: "untouched_real_function",
        matchedTo: positives.indexOf(pos),
      },
      features: functionFeatures(control.info),
    }),
  );
  return { units, log: { chimeraRejectedByCompatibility: rejected } };
}

const nameStyle = (n) => `${/^[A-Z]/.test(n)}|${/^use[A-Z]/.test(n)}`;

function donorFor(target, donors, rng) {
  const tw = nameWords(target.info.name);
  const fit = donors.filter(
    (d) =>
      d.path !== target.path &&
      d.info.name !== target.info.name &&
      nameStyle(d.info.name) === nameStyle(target.info.name) &&
      [...nameWords(d.info.name)].every(
        (w) => !target.info.words.has(w) && !tw.has(w),
      ),
  );
  return fit.length ? fit[Math.floor(rng() * fit.length)] : null;
}

const renameTop = (text, ext, name) => {
  const { id } = analyze(text, ext).top;
  return applyEdits(text, [{ start: id.start, end: id.end, text: name }]);
};

function nameOverlap(p) {
  const w = nameWords(p.info.name);
  return w.size
    ? [...w].filter((x) => p.info.words.has(x)).length / w.size
    : null;
}

function buildC(ctx) {
  const rng = rngFor(SEED, "C");
  const units = [];
  const log = { eligible: 0, withZeroOverlap: 0 };
  let index = 0;
  for (const [repo, { quota }] of Object.entries(PINNED)) {
    const pool = ctx.pools[repo];
    const pickable = pool.filter(
      (p) =>
        p.info.lines >= 8 &&
        p.info.lines <= 60 &&
        !p.info.recursion &&
        p.info.name.length >= 5 &&
        nameWords(p.info.name).size >= 1,
    );
    const zero = pickable.filter((p) => nameOverlap(p) === 0);
    log.eligible += pickable.length;
    log.withZeroOverlap += zero.length;
    const donors = pool.filter(
      (p) => p.info.name.length >= 5 && nameWords(p.info.name).size >= 1,
    );
    let made = 0;
    for (const target of shuffle(zero, rng)) {
      if (made >= quota) break;
      const donor = donorFor(target, donors, rng);
      if (!donor) continue;
      const renamed = renameTop(target.text, target.ext, donor.info.name);
      const info = analyze(renamed, target.ext);
      if (!info || info.name !== donor.info.name || secretLike(renamed))
        continue;
      const base = {
        set: "C",
        index,
        ext: target.ext,
        pairId: index,
        features: {
          ...functionFeatures(target.info),
          nameWordsMissingFromBody: 1,
        },
      };
      units.push(
        {
          ...base,
          label: 1,
          role: "renamed",
          texts: [renamed],
          source: [sourceOf(target, "body"), sourceOf(donor, "name.donor")],
          recipe: {
            op: "rename_to_name_of_another_function_in_same_repo",
            originalName: target.info.name,
            newName: donor.info.name,
            lexicalOverlapOriginal: 0,
            lexicalOverlapNew: 0,
          },
        },
        {
          ...base,
          label: 0,
          role: "original",
          texts: [target.text],
          source: [sourceOf(target, "control")],
          recipe: { op: "untouched_real_function", lexicalOverlapOriginal: 0 },
        },
      );
      index++;
      made++;
    }
    if (made < quota) throw Error(`set C: only ${made}/${quota} for ${repo}`);
  }
  return { units, log };
}

function buildB(ctx) {
  const rng = rngFor(SEED, "B");
  const intern = interner();
  const units = [];
  const log = { perRepo: {} };
  let index = 0;
  for (const [repo, { quota }] of Object.entries(PINNED)) {
    const pool = ctx.pools[repo].filter(
      (p) =>
        p.info.lines >= 10 &&
        p.info.lines <= 60 &&
        !p.info.recursion &&
        p.info.tokens >= 60,
    );
    for (const p of pool) {
      p.ids = intern(p.info.shingles);
      p.vids = intern(p.info.vocab);
    }
    const tail = tailPairs(pool, {
      minJ: 0.1,
      maxJ: 0.45,
      accept: (a, b) =>
        a.path !== b.path && a.ext === b.ext && ratio(a, b) >= 0.5,
    });
    const order = tail.jac
      .map((_, k) => k)
      .sort((x, y) => tail.jac[x] - tail.jac[y]);
    const sortedJ = order.map((k) => tail.jac[k]);
    const lowerBound = (v) => {
      let lo = 0,
        hi = sortedJ.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedJ[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const donors = ctx.pools[repo].filter(
      (p) => p.info.name.length >= 5 && nameWords(p.info.name).size >= 1,
    );
    const used = new Set();
    const key = (p) => `${p.path}:${p.startLine}`;
    const positives = [];
    let attempts = 0;
    for (const f of shuffle(pool, rng)) {
      if (positives.length >= quota) break;
      if (used.has(key(f))) continue;
      attempts++;
      const stop = 0.15 + rng() * 0.2;
      let text = f.text;
      const applied = [];
      let done = null;
      for (const [name, pass] of BASE_PASSES) {
        let out = null;
        try {
          out = pass(text, f.ext, rng);
        } catch {}
        if (out) {
          text = out;
          applied.push(name);
        } else if (name === "rename") break;
      }
      if (!applied.includes("rename")) continue;
      for (const [name, pass] of shuffle(STRUCTURE_PASSES, rng)) {
        let out = null;
        try {
          out = pass(text, f.ext, rng);
        } catch {}
        if (!out) continue;
        text = out;
        applied.push(name);
        const info = analyze(text, f.ext);
        if (jaccard(f.info.shingles, info.shingles) <= stop) {
          done = info;
          break;
        }
      }
      if (!done || secretLike(text)) continue;
      const j = jaccard(f.info.shingles, done.shingles);
      const r =
        Math.min(f.info.lines, done.lines) / Math.max(f.info.lines, done.lines);
      if (j < 0.1 || done.lines < 8 || r < 0.5) continue;
      const donor = donorFor(f, donors, rng);
      if (!donor) continue;
      text = renameTop(text, f.ext, donor.info.name);
      applied.push("renameFunction");
      used.add(key(f));
      positives.push({ f, text, info: analyze(text, f.ext), applied, j, r });
    }
    if (positives.length < quota)
      throw Error(
        `set B: only ${positives.length}/${quota} positives for ${repo}`,
      );
    const negatives = [];
    for (const pos of positives) {
      const vp = jaccardSorted(pos.f.vids, intern(pos.info.vocab));
      pos.vocabJ = vp;
      const pf = pairFeatures(pos.f.info, pos.info);
      const lo = lowerBound(pos.j - 0.05),
        hi = lowerBound(pos.j + 0.05);
      const free = order
        .slice(lo, hi)
        .filter(
          (k) =>
            !used.has(key(pool[tail.i[k]])) && !used.has(key(pool[tail.j[k]])),
        );
      const cheap = (k) => {
        const a = pool[tail.i[k]],
          b = pool[tail.j[k]];
        return (
          Math.abs(tail.jac[k] - pos.j) / 0.008 +
          Math.abs(jaccardSorted(a.vids, b.vids) - vp) / 0.025 +
          Math.abs(
            Math.log(Math.min(a.info.tokens, b.info.tokens) / pf.minTokens),
          ) /
            0.1 +
          Math.abs(
            Math.log(Math.min(a.info.lines, b.info.lines) / pf.minLines),
          ) /
            0.1 +
          Math.abs(ratio(a, b) - pf.sizeRatio) / 0.03
        );
      };
      const shortlist = free
        .map((k) => [cheap(k), k])
        .sort((x, y) => x[0] - y[0])
        .slice(0, 300);
      const best = nearest(
        shortlist,
        ([c, k]) => {
          const f = pairFeatures(pool[tail.i[k]].info, pool[tail.j[k]].info);
          return (
            c +
            Math.abs(f.tokenCoverage10 - pf.tokenCoverage10) / 0.05 +
            Math.abs(f.rawJaccard5 - pf.rawJaccard5) / 0.03
          );
        },
        () => false,
      )?.item[1];
      if (!best)
        throw Error(`set B: no negative near J=${pos.j.toFixed(2)} in ${repo}`);
      const k = best;
      used.add(key(pool[tail.i[k]])).add(key(pool[tail.j[k]]));
      negatives.push({ a: pool[tail.i[k]], b: pool[tail.j[k]] });
    }
    log.perRepo[repo] = {
      pool: pool.length,
      tailPairs: tail.jac.length,
      transformAttempts: attempts,
    };
    for (const pos of positives) {
      const flip = rng() < 0.5;
      const orig = { text: pos.f.text, info: pos.f.info },
        moved = { text: pos.text, info: pos.info };
      const [first, second] = flip ? [moved, orig] : [orig, moved];
      units.push({
        set: "B",
        label: 1,
        role: "transformed_copy",
        index: index,
        ext: pos.f.ext,
        texts: [first.text, second.text],
        source: [sourceOf(pos.f, "original")],
        recipe: {
          op: "mechanical_rewrite_of_same_function",
          passes: pos.applied,
          transformedIsPair: flip ? "a" : "b",
        },
        features: pairFeatures(first.info, second.info),
      });
      index++;
    }
    negatives.forEach((n, i) => {
      const flip = rng() < 0.5;
      const [x, y] = flip ? [n.b, n.a] : [n.a, n.b];
      units.push({
        set: "B",
        label: 0,
        role: "different_functions",
        index: index - quota + i,
        ext: x.ext,
        texts: [x.text, y.text],
        source: [sourceOf(x, "pair.a"), sourceOf(y, "pair.b")],
        recipe: { op: "random_pair_same_repo_different_files" },
        features: pairFeatures(x.info, y.info),
      });
    });
  }
  return { units, log };
}

export function assemble(sets) {
  const out = [];
  for (const [set, { units }] of Object.entries(sets))
    for (const u of units) {
      const id = hash([SEED, set, u.label, u.index]).slice(0, 8);
      const two = u.texts.length === 2;
      const files = u.texts.map((text, i) => ({
        path: two ? `u/${id}/${"ab"[i]}.${u.ext}` : `u/${id}.${u.ext}`,
        text,
        sha256: hash(text),
      }));
      out.push({ ...u, id, kind: SETS[set].kind, files });
    }
  return out.sort(
    (x, y) =>
      x.set.localeCompare(y.set) || y.label - x.label || x.index - y.index,
  );
}

export function publicUnits(units) {
  return units.map(({ texts: _t, ext, files, ...u }) => ({
    ...u,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  }));
}

export function build(reposDir) {
  const pools = {};
  for (const [repo, { dir, commit }] of Object.entries(PINNED)) {
    const cwd = join(reposDir, dir);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd })
      .toString()
      .trim();
    if (head !== commit)
      throw Error(`${repo} is at ${head}, expected ${commit}`);
    pools[repo] = extractPool(cwd, repo);
  }
  const ctx = { pools };
  const sets = { A: buildA(ctx), B: buildB(ctx), C: buildC(ctx) };
  const units = assemble(sets);
  const document = {
    schema: "contrast-units/1",
    meaning:
      "Ground truth by construction, not by labeling. A: chimeras (two unrelated functions in one) against length-matched real functions. B: a function and a mechanically rewritten copy of itself against a pair of different functions matched on scanner token overlap. C: a function renamed to another function's name against the same function untouched. Paths, ranges, hashes and numbers only; the excerpts are regenerated from the pinned repositories.",
    generatedBy: "evals/contrast/build.mjs",
    seed: SEED,
    pinned: Object.fromEntries(
      Object.entries(PINNED).map(([repo, { commit }]) => [repo, commit]),
    ),
    sets: Object.fromEntries(
      Object.entries(SETS).map(([id, s]) => [
        id,
        {
          ...s,
          positives: units.filter((u) => u.set === id && u.label === 1).length,
          controls: units.filter((u) => u.set === id && u.label === 0).length,
          log: sets[id].log,
        },
      ]),
    ),
    units: publicUnits(units),
  };
  return { document, units };
}

function main() {
  const { values } = parseArgs({
    options: {
      repos: { type: "string" },
      out: {
        type: "string",
        default: new URL("./units.json", import.meta.url).pathname,
      },
      project: { type: "string" },
      check: { type: "boolean" },
    },
  });
  if (!values.repos)
    throw Error(
      "Usage: build.mjs --repos DIR [--out FILE] [--project DIR] [--check]",
    );
  const { document, units } = build(values.repos);
  const json = JSON.stringify(document, null, 2) + "\n";
  if (values.check) {
    if (readFileSync(values.out, "utf8") !== json)
      throw Error(`${values.out} differs from a fresh build`);
    console.log("units.json matches a fresh build");
  } else {
    writeFileSync(values.out, json);
    console.log(`wrote ${values.out}: ${units.length} units`);
  }
  if (values.project) {
    for (const u of units)
      for (const f of u.files) {
        const path = join(values.project, u.set, f.path);
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) throw Error(`${path} exists`);
        writeFileSync(path, f.text);
      }
    console.log(`wrote excerpts under ${values.project}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
