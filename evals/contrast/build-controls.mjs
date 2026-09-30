#!/usr/bin/env node
// Follow-up controls for the two strongest objections to live-1 (see evals/contrast/README.md, "Follow-up controls").
//   A2: the same chimeras, but the second half consumes the first half's result, so no dangling local is left.
//       Controls are the same untouched functions as in A (re-asked; they give a test-retest read).
//   B2: the same rewritten-copy positives as B (re-asked), against different-function pairs chosen to share
//       string literals, property names and type names as copies do (surface overlap matched), as well as
//       scanner overlap, vocabulary, size and raw-token overlap.
// Deterministic, offline. Writes controls.json; --project writes the excerpts.
//
//   node evals/contrast/build-controls.mjs --repos DIR [--out controls.json] [--project DIR] [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { hash, secretLike } from "../../src/core.mjs";
import {
  analyze,
  functionFeatures,
  jaccard,
  pairFeatures,
} from "./lib/code.mjs";
import {
  PINNED,
  SEED,
  assemble,
  buildA,
  buildB,
  loadPools,
  makeChimera,
  publicUnits,
} from "./build.mjs";
import {
  interner,
  jaccardSorted,
  nearest,
  rngFor,
  tailPairs,
} from "./lib/match.mjs";

export const CONTROL_SETS = {
  A2: {
    name: "should_split_consumed_result",
    signal: "function_should_split",
    presence: "split_candidate",
    kind: "function",
    mainHeuristic: "lines",
  },
  B2: {
    name: "clone_same_policy_surface_matched",
    signal: "clone_same_policy",
    presence: "same_policy",
    kind: "clone_pair",
    mainHeuristic: "shingleJaccard",
  },
};

const findPart = (pool, s) =>
  pool.find((p) => p.path === s.path && p.startLine === s.startLine);

function buildA2(ctx, reuse) {
  const a = buildA(ctx);
  const positives = a.units.filter((u) => u.label === 1);
  const units = [],
    kept = new Set(),
    dropped = [];
  for (const u of positives) {
    const [sa, sb] = u.source;
    const pa = findPart(ctx.pools[sa.repo], sa),
      pb = findPart(ctx.pools[sb.repo], sb);
    const chimera = makeChimera(pa, pb, { consume: true });
    if (!chimera || secretLike(chimera.text)) {
      dropped.push(u.index);
      continue;
    }
    kept.add(u.index);
    units.push({
      set: "A2",
      label: 1,
      role: "chimera_consumed",
      index: u.index,
      ext: u.ext,
      texts: [chimera.text],
      source: u.source,
      recipe: {
        op: "concatenate_two_unrelated_functions",
        consumed: true,
        seamLine: chimera.seamLine,
        nameFrom: "part.first",
      },
      features: functionFeatures(chimera.info),
      reuses: null,
    });
  }
  for (const u of a.units.filter((x) => x.label === 0))
    if (kept.has(u.recipe.matchedTo))
      units.push({
        ...u,
        set: "A2",
        reuses: reuse.get(hash(u.texts[0])),
      });
  return {
    units,
    log: { consumedChimeras: kept.size, droppedIndices: dropped },
  };
}

const surfaceJ = (a, b) => jaccard(a.surface, b.surface);
const ratio = (a, b) => Math.min(a.lines, b.lines) / Math.max(a.lines, b.lines);

function buildB2(ctx, reuse) {
  const rng = rngFor(SEED, "B2");
  const b = buildB(ctx);
  const positives = b.units.filter((u) => u.label === 1);
  const units = [];
  const log = { perRepo: {} };
  const intern = interner(),
    internSurface = interner(),
    internVocab = interner();
  let pIndex = 0,
    nIndex = 0;
  for (const repo of Object.keys(PINNED)) {
    const mine = positives
      .filter((u) => u.source[0].repo === repo)
      .map((u) => {
        const x = analyze(u.texts[0], u.ext),
          y = analyze(u.texts[1], u.ext);
        return { u, x, y, sj: surfaceJ(x, y), pf: pairFeatures(x, y) };
      })
      .sort((p, q) => q.sj - p.sj);
    const pool = ctx.pools[repo].filter(
      (p) =>
        p.info.lines >= 10 &&
        p.info.lines <= 60 &&
        !p.info.recursion &&
        p.info.tokens >= 60,
    );
    for (const p of pool) {
      p.ids = intern(p.info.shingles);
      p.sids = internSurface(p.info.surface);
      p.vids = internVocab(p.info.vocab);
    }
    const tail = tailPairs(pool, {
      minJ: 0.08,
      maxJ: 0.45,
      accept: (p, q) =>
        p.path !== q.path && p.ext === q.ext && ratio(p.info, q.info) >= 0.5,
    });
    const all = tail.jac.map((_, k) => k);
    const used = new Set(
      mine.map((m) => `${m.u.source[0].path}:${m.u.source[0].startLine}`),
    );
    const key = (p) => `${p.path}:${p.startLine}`;
    const picked = [];
    for (const m of mine) {
      const best = nearest(
        all,
        (k) => {
          const p = pool[tail.i[k]],
            q = pool[tail.j[k]];
          return (
            Math.abs(tail.jac[k] - m.pf.shingleJaccard) / 0.02 +
            Math.abs(jaccardSorted(p.sids, q.sids) - m.sj) / 0.03 +
            Math.abs(jaccardSorted(p.vids, q.vids) - m.pf.vocabJaccard) / 0.05 +
            Math.abs(
              Math.log(Math.min(p.info.tokens, q.info.tokens) / m.pf.minTokens),
            ) /
              0.15 +
            Math.abs(ratio(p.info, q.info) - m.pf.sizeRatio) / 0.05
          );
        },
        (k) => used.has(key(pool[tail.i[k]])) || used.has(key(pool[tail.j[k]])),
      );
      if (!best) throw Error(`B2: no negative for a positive in ${repo}`);
      used.add(key(pool[tail.i[best.item]])).add(key(pool[tail.j[best.item]]));
      picked.push({
        m,
        p: pool[tail.i[best.item]],
        q: pool[tail.j[best.item]],
      });
    }
    log.perRepo[repo] = {
      pool: pool.length,
      tailPairs: tail.jac.length,
      meanSurfaceJaccard: {
        positives: mine.reduce((n, m) => n + m.sj, 0) / mine.length,
        negatives:
          picked.reduce((n, x) => n + surfaceJ(x.p.info, x.q.info), 0) /
          picked.length,
      },
    };
    for (const { m } of picked)
      units.push({
        set: "B2",
        label: 1,
        role: "transformed_copy",
        index: pIndex++,
        ext: m.u.ext,
        texts: m.u.texts,
        source: m.u.source,
        recipe: m.u.recipe,
        features: { ...m.pf, surfaceJaccard: m.sj },
        reuses: reuse.get(m.u.texts.map(hash).join("+")),
      });
    for (const { p, q } of picked) {
      const [x, y] = rng() < 0.5 ? [q, p] : [p, q];
      units.push({
        set: "B2",
        label: 0,
        role: "different_functions_sharing_surface",
        index: nIndex++,
        ext: x.ext,
        texts: [x.text, y.text],
        source: [
          {
            role: "pair.a",
            repo,
            path: x.path,
            startLine: x.startLine,
            endLine: x.endLine,
            name: x.info.name,
            sha256: x.sha256,
          },
          {
            role: "pair.b",
            repo,
            path: y.path,
            startLine: y.startLine,
            endLine: y.endLine,
            name: y.info.name,
            sha256: y.sha256,
          },
        ],
        recipe: { op: "different_functions_matched_on_surface_overlap" },
        features: {
          ...pairFeatures(x.info, y.info),
          surfaceJaccard: surfaceJ(x.info, y.info),
        },
        reuses: null,
      });
    }
  }
  return { units, log };
}

export function buildControls(reposDir) {
  const base = JSON.parse(
    readFileSync(new URL("./units.json", import.meta.url), "utf8"),
  );
  const reuse = new Map(
    base.units.map((u) => [u.files.map((f) => f.sha256).join("+"), u.id]),
  );
  const pools = loadPools(reposDir);
  const ctx = { pools };
  const sets = { A2: buildA2(ctx, reuse), B2: buildB2(ctx, reuse) };
  const units = assemble(sets, CONTROL_SETS);
  for (const u of units)
    if (u.reuses === undefined)
      throw Error(`${u.set}/${u.id}: reused unit not found`);
  const document = {
    schema: "contrast-units/1",
    meaning:
      "Follow-up controls to units.json. A2: the chimeras of A with the first half's result consumed by the second half, against the same controls as A. B2: the rewritten copies of B against different-function pairs matched on scanner overlap and on shared string literals, property names and type names. `reuses` names the units.json unit with identical text. Paths, ranges, hashes and numbers only.",
    generatedBy: "evals/contrast/build-controls.mjs",
    seed: SEED,
    pinned: Object.fromEntries(
      Object.entries(PINNED).map(([r, { commit }]) => [r, commit]),
    ),
    sets: Object.fromEntries(
      Object.entries(CONTROL_SETS).map(([id, s]) => [
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
        default: new URL("./controls.json", import.meta.url).pathname,
      },
      project: { type: "string" },
      check: { type: "boolean" },
    },
  });
  if (!values.repos)
    throw Error(
      "Usage: build-controls.mjs --repos DIR [--out FILE] [--project DIR] [--check]",
    );
  const { document, units } = buildControls(values.repos);
  const json = JSON.stringify(document, null, 2) + "\n";
  if (values.check) {
    if (readFileSync(values.out, "utf8") !== json)
      throw Error(`${values.out} differs from a fresh build`);
    console.log("controls.json matches a fresh build");
  } else {
    writeFileSync(values.out, json);
    console.log(`wrote ${values.out}: ${units.length} units`);
  }
  if (values.project)
    for (const u of units)
      for (const f of u.files) {
        const path = join(values.project, u.set, f.path);
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) throw Error(`${path} exists`);
        writeFileSync(path, f.text);
      }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
