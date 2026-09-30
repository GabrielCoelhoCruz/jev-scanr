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
