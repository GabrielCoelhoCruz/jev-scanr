export const RATE_LIMITS = Object.freeze({
  requestsPerSecond: 40,
  tokensPerSecond: 100_000,
});

export function createLimiter({
  requestsPerSecond = RATE_LIMITS.requestsPerSecond,
  tokensPerSecond = RATE_LIMITS.tokensPerSecond,
  headroom = 0.8,
  burstSeconds = 0.25,
  minIntervalMs = 0,
  clock = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (
    ![requestsPerSecond, tokensPerSecond, headroom, burstSeconds].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    headroom > 1 ||
    !Number.isFinite(minIntervalMs) ||
    minIntervalMs < 0
  )
    throw Error("Invalid limiter configuration");
  const requestRate = requestsPerSecond * headroom,
    tokenRate = tokensPerSecond * headroom,
    requestCapacity = Math.max(1, requestRate * burstSeconds),
    tokenCapacity = tokenRate * burstSeconds;
  let requests = requestCapacity,
    tokens = tokenCapacity,
    last = clock(),
    lastGrant = clock(),
    tail = Promise.resolve();
  const refill = () => {
    const now = clock(),
      elapsed = Math.max(0, now - last) / 1000;
    last = now;
    requests = Math.min(requestCapacity, requests + elapsed * requestRate);
    tokens = Math.min(tokenCapacity, tokens + elapsed * tokenRate);
  };
  async function take(cost) {
    const need = Math.min(cost, tokenCapacity);
    for (;;) {
      refill();
      const sinceGrant = clock() - lastGrant;
      if (requests >= 1 && tokens >= need && sinceGrant >= minIntervalMs) {
        requests -= 1;
        tokens -= cost;
        lastGrant = clock();
        return;
      }
      const wait = Math.max(
        ((1 - requests) / requestRate) * 1000,
        ((need - tokens) / tokenRate) * 1000,
        minIntervalMs - sinceGrant,
        1,
      );
      await sleep(Math.ceil(wait));
    }
  }
  return {
    acquire(cost) {
      if (!Number.isFinite(cost) || cost <= 0) throw Error("Invalid cost");
      const turn = tail.then(() => take(cost));
      tail = turn.catch(() => {});
      return turn;
    },
    effective: { requestRate, tokenRate, requestCapacity, tokenCapacity },
  };
}
