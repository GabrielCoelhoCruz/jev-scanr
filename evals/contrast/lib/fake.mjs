import { rngFor } from "./match.mjs";

export const FAKE_KINDS = ["random", "oracle", "inverse-oracle", "feature"];

export function fakeScores(doc, kind, { seed = 1, feature = "lines" } = {}) {
  const rng = rngFor(seed, `fake:${kind}`);
  const range = {};
  if (kind === "feature")
    for (const set of Object.keys(doc.sets)) {
      const values = doc.units
        .filter((u) => u.set === set)
        .map((u) => u.features[feature])
        .filter((v) => v !== undefined);
      range[set] = [Math.min(...values), Math.max(...values)];
    }
  return new Map(
    doc.units.map((u) => {
      let p;
      if (kind === "random") p = rng();
      else if (kind === "oracle") p = u.label ? 0.9 : 0.1;
      else if (kind === "inverse-oracle") p = u.label ? 0.1 : 0.9;
      else if (kind === "feature") {
        const [lo, hi] = range[u.set];
        const v = u.features[feature];
        p = v === undefined ? null : hi === lo ? 0.5 : (v - lo) / (hi - lo);
      } else throw Error(`Unknown fake kind ${kind}`);
      return [u.id, { p, choice: null }];
    }),
  );
}
