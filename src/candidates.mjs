import { hash } from "./core.mjs";

export function jaccard(a, b) {
  let count = 0;
  for (const x of a) if (b.has(x)) count++;
  return count / (a.size + b.size - count || 1);
}
export function generateCandidates(
  index,
  {
    minLines = 8,
    minJaccard = 0.45,
    minSizeRatio = 0.5,
    includeTests = false,
    recordCapped = false,
  } = {},
) {
  if (
    !Number.isSafeInteger(minLines) ||
    minLines < 1 ||
    ![minJaccard, minSizeRatio].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    )
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
      if (candidates.length >= maxCandidates) {
        omitted.push(capped({ kind: "clone_pair", members: [a, b] }));
        continue;
      }
      parents.set(find(a.id), find(b.id));
      add({
        kind: "clone_pair",
        members: [a, b],
        facts: {
          jaccard: similarity,
          sizeRatio: ratio,
          exactBody: a.bodyHash === b.bodyHash,
          duplicatedLineProxy: Math.min(a.lines, b.lines),
          provenance: "token_shingles_not_semantic_equivalence",
        },
      });
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
    },
    options: { minLines, minJaccard, minSizeRatio, includeTests },
  };
}
