/**
 * eventRecord.ts
 *
 * Defines the canonical EventRecord schema for the JSONL persistence layer.
 *
 * Compliant with INTERFACES.md:
 *   - schema_version is a string (SemVer) per INTERFACES.md §1.2
 *   - monotonic_ms is a number derived from process.hrtime.bigint()
 *   - timezone_offset is minutes from UTC
 *   - All required fields must be present and valid
 *
 * JSONL is the source of truth. One record = one line.
 */

/** Current schema version — bump MAJOR for breaking changes per INTERFACES.md §1.1 */
export const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * Smart-save trigger reason enum as defined in INTERFACES.md §3A.
 */
export type TriggerReason =
  | "WINDOW_CHANGE"
  | "INPUT_ACTIVITY"
  | "HEARTBEAT"
  | "SHUTDOWN_FLUSH"
  | "CHECKPOINT_FLUSH";

/**
 * EventRecord — the canonical unit of persistence written to JSONL.
 *
 * Field constraints (INTERFACES.md §0 and §3A):
 *   schema_version  — SemVer string; writers use CURRENT_SCHEMA_VERSION
 *   event_id        — globally unique; generated with crypto.randomUUID()
 *   session_id      — unique per process start; stable within a session
 *   seq             — monotonic integer >= 0; starts at 0 per session; never skips
 *   created_at      — ISO-8601 UTC string (e.g. "2026-02-20T21:15:32.123Z")
 *   epoch_ms        — same instant as created_at expressed as epoch milliseconds
 *   monotonic_ms    — monotonic clock value in ms; NOT from wall clock
 *                     derived via Number(process.hrtime.bigint() / 1_000_000n)
 *   timezone_offset — minutes offset from UTC at event time (e.g. -300 for UTC-5)
 *   source          — module/component name that produced the event
 *   type            — event type identifier (e.g. "WINDOW_CHANGE")
 *   payload         — event-specific data; must be JSON-serializable
 */
export interface EventRecord {
  schema_version: string;
  event_id: string;
  session_id: string;
  seq: number;
  created_at: string;
  epoch_ms: number;
  monotonic_ms: number;
  timezone_offset: number;
  source: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Validates that a value is a well-formed EventRecord.
 * Throws with a descriptive message if any constraint is violated.
 *
 * Validation rules:
 *   - All required fields must be present and of the correct type
 *   - seq must be an integer >= 0
 *   - epoch_ms must be a finite integer
 *   - monotonic_ms must be a finite number >= 0
 *   - schema_version must be a non-empty string
 *   - The record must be JSON-serializable (no circular refs, no bigint)
 */
export function validateEventRecord(record: unknown): asserts record is EventRecord {
  if (record === null || typeof record !== "object") {
    throw new TypeError("EventRecord must be a non-null object");
  }

  const r = record as Record<string, unknown>;

  // schema_version
  if (typeof r["schema_version"] !== "string" || r["schema_version"].trim() === "") {
    throw new TypeError(`EventRecord.schema_version must be a non-empty string; got ${JSON.stringify(r["schema_version"])}`);
  }

  // event_id
  if (typeof r["event_id"] !== "string" || r["event_id"].trim() === "") {
    throw new TypeError(`EventRecord.event_id must be a non-empty string`);
  }

  // session_id
  if (typeof r["session_id"] !== "string" || r["session_id"].trim() === "") {
    throw new TypeError(`EventRecord.session_id must be a non-empty string`);
  }

  // seq
  if (typeof r["seq"] !== "number" || !Number.isInteger(r["seq"]) || r["seq"] < 0) {
    throw new TypeError(`EventRecord.seq must be a non-negative integer; got ${JSON.stringify(r["seq"])}`);
  }

  // created_at
  if (typeof r["created_at"] !== "string" || isNaN(Date.parse(r["created_at"] as string))) {
    throw new TypeError(`EventRecord.created_at must be a valid ISO-8601 string`);
  }

  // epoch_ms
  if (typeof r["epoch_ms"] !== "number" || !Number.isFinite(r["epoch_ms"]) || !Number.isInteger(r["epoch_ms"])) {
    throw new TypeError(`EventRecord.epoch_ms must be a finite integer`);
  }

  // monotonic_ms
  if (typeof r["monotonic_ms"] !== "number" || !Number.isFinite(r["monotonic_ms"]) || r["monotonic_ms"] < 0) {
    throw new TypeError(`EventRecord.monotonic_ms must be a finite non-negative number`);
  }

  // timezone_offset
  if (typeof r["timezone_offset"] !== "number" || !Number.isInteger(r["timezone_offset"])) {
    throw new TypeError(`EventRecord.timezone_offset must be an integer (minutes from UTC)`);
  }

  // source
  if (typeof r["source"] !== "string" || r["source"].trim() === "") {
    throw new TypeError(`EventRecord.source must be a non-empty string`);
  }

  // type
  if (typeof r["type"] !== "string" || r["type"].trim() === "") {
    throw new TypeError(`EventRecord.type must be a non-empty string`);
  }

  // payload
  if (r["payload"] === null || typeof r["payload"] !== "object" || Array.isArray(r["payload"])) {
    throw new TypeError(`EventRecord.payload must be a non-null, non-array object`);
  }

  // JSON serializability check
  try {
    JSON.stringify(record);
  } catch (err) {
    throw new TypeError(`EventRecord must be JSON-serializable: ${(err as Error).message}`);
  }
}

/**
 * Returns the current timezone offset in minutes from UTC.
 * A negative value means west of UTC (e.g. UTC-5 → -300).
 */
export function getTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
