import { hash, jaccard } from "./core.mjs";
import { lowOverlapPairs, LOW_OVERLAP_DEFAULTS } from "./low-overlap.mjs";

export function generateCandidates(
  index,
  {
    minLines = 8,
    minJaccard = 0.45,
    minSizeRatio = 0.5,
    includeTests = false,
    recordCapped = false,
    lowOverlap = {},
  } = {},
) {
  const low = { ...LOW_OVERLAP_DEFAULTS, ...lowOverlap };
  if (
    !Number.isSafeInteger(minLines) ||
    minLines < 1 ||
    ![minJaccard, minSizeRatio, low.minScore].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) ||
    !Number.isSafeInteger(low.cap) ||
    low.cap < 0 ||
    !Number.isSafeInteger(low.minSurface) ||
    low.minSurface < 1 ||
    !Number.isSafeInteger(low.maxDocumentFrequency) ||
    low.maxDocumentFrequency < 2
  )
    throw Error("Invalid retrieval options");
  const { maxCandidates, maxComparisons } = index.snapshot.limits,
    candidates = [],
    omitted = [];
  const pool = index.functions.filter(
      (f) => (includeTests || !f.test) && f.lines >= minLines,
    ),
    parents = new Map();
  let comparisons = 0,
    eligiblePairs = 0;
  const find = (x) => {
    if (!parents.has(x)) parents.set(x, x);
    while (parents.get(x) !== x) x = parents.get(x);
    return x;
  };
  const capped = (c) => ({
    kind: c.kind,
    reason: "candidate_limit",
    ...(recordCapped
      ? {
          unitId: hash([c.kind, c.members.map((f) => f.id)]),
          location: c.members.map((f) => ({
            name: f.name ?? null,
            path: f.path,
            startLine: f.range.startLine,
            endLine: f.range.endLine,
          })),
        }
      : {}),
  });
  const add = (c) => {
    if (candidates.length >= maxCandidates) {
      omitted.push(capped(c));
      return;
    }
    c.id = hash([c.kind, c.members.map((f) => f.id), null]);
    candidates.push(c);
  };
  const propose = (members, facts) => {
    if (candidates.length >= maxCandidates) {
      omitted.push(capped({ kind: "clone_pair", members }));
      return;
    }
    parents.set(find(members[0].id), find(members[1].id));
    add({ kind: "clone_pair", members, facts });
  };
  outer: for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      if (++comparisons > maxComparisons) {
        omitted.push({
          kind: "clone_pair",
          reason: "comparison_cap_remaining_unknown",
        });
        break outer;
      }
      const a = pool[i],
        b = pool[j];
      if (
        a.path === b.path &&
        a.range.startOffset < b.range.endOffset &&
        b.range.startOffset < a.range.endOffset
      )
        continue;
      const ratio = Math.min(a.lines, b.lines) / Math.max(a.lines, b.lines);
      if (ratio < minSizeRatio) continue;
      const similarity = jaccard(a.shingles, b.shingles);
      if (similarity < minJaccard) continue;
      eligiblePairs++;
      propose([a, b], {
        jaccard: similarity,
        sizeRatio: ratio,
        exactBody: a.bodyHash === b.bodyHash,
        duplicatedLineProxy: Math.min(a.lines, b.lines),
        provenance: "token_shingles_not_semantic_equivalence",
      });
    }
  let lowOverlapStats = null;
  if (low.cap > 0) {
    const found = lowOverlapPairs(
      pool,
      { minJaccard, minSizeRatio, budget: maxComparisons },
      low,
    );
    for (const pair of found.pairs) propose(pair.members, pair.facts);
    omitted.push(...found.omitted);
    lowOverlapStats = found.stats;
  }
  const groups = new Map();
  for (const x of parents.keys()) {
    const root = find(x);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(x);
  }
  const clusters = [...groups.values()].map((ids) => ({
    id: hash(ids.sort()),
    members: ids,
    meaning:
      "retrieval connected component; transitivity does not establish semantic equivalence",
    edges: [],
  }));
  for (const c of candidates) {
    const cluster = clusters.find((g) => g.members.includes(c.members[0].id));
    c.clusterId = cluster.id;
    cluster.edges.push(c.id);
  }
  return {
    candidates,
    clusters,
    facts: [],
    omitted,
    stats: {
      functionsIndexed: index.functions.length,
      clonePool: pool.length,
      comparisons: Math.min(comparisons, maxComparisons),
      eligiblePairs,
      candidateCount: candidates.length,
      lowOverlap: {
        ...lowOverlapStats,
        candidates: candidates.filter(
          (c) => c.facts.retrievalSource === "low_overlap_surface",
        ).length,
      },
    },
    options: {
      minLines,
      minJaccard,
      minSizeRatio,
      includeTests,
      lowOverlap: low,
    },
  };
}
