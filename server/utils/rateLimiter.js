// server/utils/rateLimiter.js
//
// A lightweight in-memory token-bucket rate limiter, keyed by socket id.
// No database or external dependency needed — state simply lives for the
// lifetime of the process (and is cleaned up when a socket disconnects).
//
// Rules:
//   - Each socket gets a bucket of MAX_TOKENS "message tokens".
//   - Tokens refill at REFILL_RATE per REFILL_INTERVAL_MS.
//   - Sending a message costs 1 token.
//   - If a socket runs out of tokens repeatedly, it gets temporarily muted.

const MAX_TOKENS = 5;              // burst allowance
const REFILL_INTERVAL_MS = 5000;   // every 5 seconds...
const REFILL_AMOUNT = 5;           // ...refill up to MAX_TOKENS
const MUTE_DURATION_MS = 8000;     // mute duration after abuse
const VIOLATION_THRESHOLD = 3;     // consecutive violations before mute

const buckets = new Map();

function getBucket(socketId) {
  let bucket = buckets.get(socketId);
  if (!bucket) {
    bucket = {
      tokens: MAX_TOKENS,
      lastRefill: Date.now(),
      violations: 0,
      mutedUntil: 0,
    };
    buckets.set(socketId, bucket);
  }
  return bucket;
}

function refill(bucket) {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= REFILL_INTERVAL_MS) {
    const refillCycles = Math.floor(elapsed / REFILL_INTERVAL_MS);
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + refillCycles * REFILL_AMOUNT);
    bucket.lastRefill = now;
  }
}

/**
 * Attempts to consume one token for the given socket.
 * @param {string} socketId
 * @returns {{ allowed: boolean, mutedMsRemaining?: number }}
 */
function tryConsume(socketId) {
  const bucket = getBucket(socketId);
  const now = Date.now();

  if (now < bucket.mutedUntil) {
    return { allowed: false, mutedMsRemaining: bucket.mutedUntil - now };
  }

  refill(bucket);

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    bucket.violations = 0;
    return { allowed: true };
  }

  // No tokens left — count as a violation.
  bucket.violations += 1;
  if (bucket.violations >= VIOLATION_THRESHOLD) {
    bucket.mutedUntil = now + MUTE_DURATION_MS;
    bucket.violations = 0;
    return { allowed: false, mutedMsRemaining: MUTE_DURATION_MS };
  }

  return { allowed: false, mutedMsRemaining: 0 };
}

/**
 * Cleans up bucket state for a disconnected socket.
 * @param {string} socketId
 */
function removeBucket(socketId) {
  buckets.delete(socketId);
}

module.exports = { tryConsume, removeBucket };
