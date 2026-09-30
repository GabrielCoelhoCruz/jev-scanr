import { createHash } from "node:crypto";
import { mulberry32 } from "../../lib/stats.mjs";

export const rngFor = (seed, name) =>
  mulberry32(
    createHash("sha256").update(`${seed}|${name}`).digest().readUInt32BE(0),
  );

export const shuffle = (items, rng) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function interner() {
  const table = new Map();
  return (set) =>
    Int32Array.from(
      [...set].map((s) => {
        let i = table.get(s);
        if (i === undefined) {
          i = table.size;
          table.set(s, i);
        }
        return i;
      }),
    ).sort();
}

export function jaccardSorted(a, b) {
  let i = 0,
    j = 0,
    common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      common++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return common / (a.length + b.length - common || 1);
}

export function tailPairs(items, { minJ, maxJ, accept }) {
  const out = { i: [], j: [], jac: [] };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j];
      if (!accept(a, b)) continue;
      const jac = jaccardSorted(a.ids, b.ids);
      if (jac >= minJ && jac < maxJ) {
        out.i.push(i);
        out.j.push(j);
        out.jac.push(jac);
      }
    }
  return out;
}

export function nearest(candidates, cost, used) {
  let best = null,
    bestCost = Infinity;
  for (const c of candidates) {
    if (used(c)) continue;
    const k = cost(c);
    if (k < bestCost) {
      best = c;
      bestCost = k;
    }
  }
  return best && { item: best, cost: bestCost };
}
