/**
 * In-memory query cache with TTL and LRU eviction.
 *
 * Purpose: avoid hitting the LLM for repeated identical queries.
 * Identical questions (pricing, schedules) are asked by many students.
 * Cache hit = zero API cost + ~1ms latency vs ~1200ms.
 *
 * Replace with Redis for multi-instance / persistent deployments.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 150;

const store = new Map(); // key -> { value, expiresAt, lastUsed }

/**
 * Normalizes a query string to maximize cache hit rate.
 * "How much does B2 cost?" and "how much does b2 cost" -> same key
 */
export function normalizeQuery(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

export function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  entry.lastUsed = Date.now();
  return entry.value;
}

export function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  // Evict oldest entry when at capacity
  if (store.size >= MAX_ENTRIES) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of store) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    lastUsed: Date.now(),
  });
}

export function invalidate(key) {
  store.delete(key);
}

export function flush() {
  store.clear();
}

export function stats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  for (const [, v] of store) {
    if (now > v.expiresAt) expired++;
    else active++;
  }
  return { total: store.size, active, expired, maxEntries: MAX_ENTRIES };
}
