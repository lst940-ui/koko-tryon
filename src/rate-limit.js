export function createRateLimiter({ limit, windowMs = 60_000 }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const bucket = hits.get(key) || [];
    const recent = bucket.filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
    }
    recent.push(now);
    hits.set(key, recent);
    return { ok: true };
  };
}
