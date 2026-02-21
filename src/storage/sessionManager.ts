/**
 * sessionManager.ts
 *
 * Generates a stable session_id for this process lifetime and provides
 * a strictly-monotonic sequence counter (seq).
 *
 * Rules (per spec):
 *   - session_id is generated once per process start
 *   - seq starts at 0 and increments by exactly 1 per call to nextSeq()
 *   - seq MUST NEVER decrease
 *   - seq MUST NEVER skip values during normal operation
 *
 * session_id format: <hostname>-<epoch_ms>-<8-char-random>
 * Example: MYPC-1708452399123-ab12cd34
 *
 * Uses crypto.randomUUID() — no external uuid dependency.
 */

import * as os from "os";
import * as crypto from "crypto";

/** Stable monotonic sequence counter for this session. */
let _seq: number = -1;

/** Stable session identifier for this process lifetime. */
const _sessionId: string = generateSessionId();

/**
 * Generates a unique session_id.
 * Format: <sanitized-hostname>-<process-start-epoch-ms>-<8-char-hex>
 */
function generateSessionId(): string {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "host";
  const epoch = Date.now();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${hostname}-${epoch}-${rand}`;
}

/**
 * Returns the session_id for this process lifetime.
 * The same value is returned on every call.
 */
export function getSessionId(): string {
  return _sessionId;
}

/**
 * Returns the next monotonic sequence number and advances the counter.
 * The first call returns 0. Each subsequent call returns the previous value + 1.
 *
 * This function is NOT thread-safe. Serialized single-process appends are assumed
 * (per spec: "single-process, serialized appends").
 */
export function nextSeq(): number {
  _seq += 1;
  return _seq;
}

/**
 * Returns the current seq without advancing it.
 * Returns -1 if nextSeq() has never been called.
 */
export function currentSeq(): number {
  return _seq;
}

/**
 * Overrides the internal seq counter to `value`.
 * Used by recovery to reconcile seq with the JSONL tail.
 * After calling this, the next nextSeq() call returns value + 1.
 *
 * MUST only be called during startup recovery — never during normal operation.
 */
export function setSeq(value: number): void {
  if (!Number.isInteger(value) || value < -1) {
    throw new RangeError(`setSeq: value must be an integer >= -1; got ${value}`);
  }
  _seq = value;
}
