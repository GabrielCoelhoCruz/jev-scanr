export const rate = (k, n) => (n > 0 ? k / n : null);

export function wilson(k, n, z = 1.96) {
  if (n <= 0) return null;
  const p = k / n,
    denominator = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / denominator,
    half =
      (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export const noiseFloor = (n) => (n > 0 ? 1 / Math.sqrt(n) : null);

export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const labels = [...new Set(pairs.flat())];
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const expected = labels.reduce(
    (sum, label) =>
      sum +
      (pairs.filter(([a]) => a === label).length / n) *
        (pairs.filter(([, b]) => b === label).length / n),
    0,
  );
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

export const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

export const withNoise = (k, n) =>
  n > 0
    ? `${k}/${n} = ${pct(k / n)} ±${pct(noiseFloor(n))} noise floor`
    : "n/a";

export function auc(scores, labels) {
  let wins = 0,
    pairs = 0;
  for (let i = 0; i < scores.length; i++)
    for (let j = 0; j < scores.length; j++) {
      if (!labels[i] || labels[j]) continue;
      pairs++;
      wins += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
    }
  return pairs ? wins / pairs : null;
}

export function precisionAtK(scores, labels, k) {
  if (!k) return null;
  const order = scores
    .map((s, i) => [s, labels[i]])
    .sort((a, b) => b[0] - a[0]);
  const edge = order[k - 1][0];
  const above = order.filter(([s]) => s > edge);
  const tied = order.filter(([s]) => s === edge);
  const hits =
    above.reduce((n, [, y]) => n + y, 0) +
    ((k - above.length) * tied.reduce((n, [, y]) => n + y, 0)) / tied.length;
  return hits / k;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrap(items, resamples, seed, fn) {
  const random = mulberry32(seed);
  for (let b = 0; b < resamples; b++)
    fn(
      Array.from(
        { length: items.length },
        () => items[Math.floor(random() * items.length)],
      ),
    );
}
