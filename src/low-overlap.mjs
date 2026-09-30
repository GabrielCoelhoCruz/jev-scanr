import { boundNames, walk } from "./index.mjs";
import { jaccard } from "./core.mjs";

export const LOW_OVERLAP_DEFAULTS = Object.freeze({
  cap: 50,
  minScore: 0.6,
  minSurface: 3,
  maxDocumentFrequency: 250,
});

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

export function profile(f) {
  const locals = new Set(f.name ? [f.name] : []);
  walk(f.node, (n) => {
    if (FUNCTION_TYPES.has(n.type)) {
      for (const p of n.params) for (const x of boundNames(p)) locals.add(x);
      if (n.id) locals.add(n.id.name);
    }
    if (n.type === "VariableDeclarator")
      for (const x of boundNames(n.id)) locals.add(x);
    if (n.type === "CatchClause")
      for (const x of boundNames(n.param)) locals.add(x);
  });
  const surface = new Set(),
    shape = new Map();
  walk(f.node, (n) => {
    shape.set(n.type, (shape.get(n.type) ?? 0) + 1);
    if (
      (n.type === "Identifier" || n.type === "JSXIdentifier") &&
      !locals.has(n.name)
    )
      surface.add(n.name);
    else if (n.type === "StringLiteral" && n.value.length >= 2)
      surface.add(`"${n.value}`);
    else if (n.type === "TemplateElement" && n.value.cooked?.trim().length >= 2)
      surface.add(`"${n.value.cooked}`);
  });
  return { surface, shape };
}

function shapeSimilarity(a, b) {
  let least = 0,
    most = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? 0,
      y = b.get(key) ?? 0;
    least += Math.min(x, y);
    most += Math.max(x, y);
  }
  return most ? least / most : 0;
}

export function decidePair(
  [a, pa],
  [b, pb],
  { minJaccard, minSizeRatio, minScore, minSurface },
) {
  if (
    a.path === b.path &&
    a.range.startOffset < b.range.endOffset &&
    b.range.startOffset < a.range.endOffset
  )
    return { pass: false, reason: "overlapping" };
  if (pa.surface.size < minSurface || pb.surface.size < minSurface)
    return { pass: false, reason: "small_surface" };
  const sizeRatio = Math.min(a.lines, b.lines) / Math.max(a.lines, b.lines);
  if (sizeRatio < minSizeRatio) return { pass: false, reason: "size_ratio" };
  const shingles = jaccard(a.shingles, b.shingles);
  if (shingles >= minJaccard) return { pass: false, reason: "high_overlap" };
  const surfaceJaccard = jaccard(pa.surface, pb.surface),
    shape = shapeSimilarity(pa.shape, pb.shape),
    score = (surfaceJaccard + shape) / 2;
  return {
    pass: score >= minScore,
    reason: score >= minScore ? "proposed" : "score",
    shingles,
    sizeRatio,
    surfaceJaccard,
    shapeSimilarity: shape,
    score,
  };
}

export function lowOverlapPairs(pool, retrieval, options) {
  const { budget } = retrieval,
    { cap, minSurface, maxDocumentFrequency } = options,
    profiles = pool.map(profile),
    documents = new Map(),
    omitted = [];
  profiles.forEach((p, i) => {
    if (p.surface.size < minSurface) return;
    for (const name of p.surface) {
      if (!documents.has(name)) documents.set(name, []);
      documents.get(name).push(i);
    }
  });
  const names = [...documents.entries()]
    .filter(([, list]) => list.length <= maxDocumentFrequency)
    .sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1));
  const seen = new Set(),
    found = [];
  let comparisons = 0;
  outer: for (const [, list] of names)
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const key = list[x] * pool.length + list[y];
        if (seen.has(key)) continue;
        if (++comparisons > budget) {
          omitted.push({
            kind: "clone_pair",
            reason: "low_overlap_comparison_cap_remaining_unknown",
          });
          break outer;
        }
        seen.add(key);
        const a = pool[list[x]],
          b = pool[list[y]],
          d = decidePair([a, profiles[list[x]]], [b, profiles[list[y]]], {
            ...retrieval,
            ...options,
          });
        if (!d.pass) continue;
        found.push({
          members: [a, b],
          score: d.score,
          facts: {
            jaccard: d.shingles,
            sizeRatio: d.sizeRatio,
            exactBody: a.bodyHash === b.bodyHash,
            duplicatedLineProxy: Math.min(a.lines, b.lines),
            provenance: "shared_surface_not_semantic_equivalence",
            retrievalSource: "low_overlap_surface",
            surfaceJaccard: d.surfaceJaccard,
            shapeSimilarity: d.shapeSimilarity,
            score: d.score,
          },
        });
      }
  found.sort(
    (a, b) =>
      b.score - a.score ||
      (a.members[0].id + a.members[1].id < b.members[0].id + b.members[1].id
        ? -1
        : 1),
  );
  if (found.length > cap)
    omitted.push({
      kind: "clone_pair",
      reason: "low_overlap_cap",
      count: found.length - cap,
    });
  return {
    pairs: found.slice(0, cap),
    omitted,
    stats: {
      functions: profiles.filter((p) => p.surface.size >= minSurface).length,
      comparisons: Math.min(comparisons, budget),
      passing: found.length,
    },
  };
}
