# INTERFACES.md

Focus Intelligence System
On-Device, Privacy-First
Runtime: Node.js (CommonJS)
OS: Windows + macOS

This document defines stable production-grade interface contracts.
Only interfaces, schemas, compatibility guarantees, and operational safeguards are defined here.

JSONL is the canonical source of truth.
SQLite is derived and fully reconstructible.

---

# 0. Global Interface Rules

All persisted records MUST include:

- schema_version
- created_at (ISO-8601 UTC)
- timezone_offset (minutes from UTC at event time)
- monotonic_ms (relative monotonic timestamp)

All modules MUST export stable function signatures.
All readers MUST ignore unknown fields.
All writers MUST NOT emit future schema versions.

---

# 1. Versioning Strategy

## 1.1 Interface Versioning (SemVer)

Format: MAJOR.MINOR.PATCH

MAJOR
- Required field added
- Field removed
- Field type changed
- Enum value removed
- Privacy constraint changed

MINOR
- Optional field added
- Enum extended
- Backward-compatible schema expansion

PATCH
- Documentation update
- Validation tightening (non-breaking)

---

## 1.2 Schema Version Field

Every persisted record MUST contain:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | string | Yes | e.g. "1.1.0" |
| created_at | string | Yes | ISO-8601 UTC |
| timezone_offset | number | Yes | Minutes offset from UTC |
| monotonic_ms | number | Yes | Monotonic clock value |

monotonic_ms MUST be derived from a monotonic clock (e.g. process.hrtime or performance.now).
It MUST NOT rely on system wall clock.

---

## 1.3 Migration Strategy (Lazy Migration)

Full-file migration is NOT required.

Reader implementations MUST:

- Support reading multiple schema versions.
- Apply transformation at read-time when required.
- Preserve original JSONL entries.
- Write only current schema_version going forward.

SQLite migrations:
- Forward-only incremental SQL.
- meta table stores aggregate schema version.
- SQLite can be fully rebuilt from JSONL.

---

# 2. Internal Module Interfaces

All modules use CommonJS exports.

---

# 2A. Capture Layer

## Module: capture/activeWindow.js

Exports:

module.exports = {
  getActiveWindow,
  startActiveWindowWatcher,
  stopActiveWindowWatcher
};

### getActiveWindow()

Returns:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| timestamp | number | Yes | Epoch ms |
| monotonic_ms | number | Yes | Monotonic time |
| app_name | string | Yes | Application name |
| window_title | string | Yes | Sanitized per strategy |
| bundle_id | string | Optional | macOS bundle id |
| process_name | string | Optional | OS process name |

---

# 2B. Input Aggregation (Checkpoint-Aware)

## Module: capture/inputAggregator.js

Exports:

module.exports = {
  startInputCapture,
  stopInputCapture,
  getAggregatedMetrics,
  resetAggregation,
  writeCheckpoint,
  clearCheckpoint,
  restoreFromCheckpoint
};

### AggregatedMetrics

| Field | Type | Required |
|-------|------|----------|
| key_count | number | Yes |
| click_count | number | Yes |
| mouse_distance | number | Yes |
| scroll_delta | number | Yes |
| idle_ms | number | Yes |
| dwell_time_ms | number | Yes |

---

## Checkpoint Contract

File: dirty_state.json

Checkpoint MUST contain:

| Field | Type | Required |
|-------|------|----------|
| session_id | string | Yes |
| last_persisted_monotonic_ms | number | Yes |
| aggregated_metrics | object | Yes |
| created_at | string | Yes |

Behavior:

- writeCheckpoint() runs at fixed interval (default 60s)
- On successful JSONL append, clearCheckpoint() MUST run
- On startup, restoreFromCheckpoint() MUST merge unflushed metrics
- Checkpoint file MUST be atomic write

This prevents data loss on crash or forced shutdown.

---

# 2C. Persistence (JSONL Canonical Store)

## Module: persistence/jsonlWriter.js

Exports:

module.exports = {
  appendEventRecord,
  flush,
  close
};

appendEventRecord(record)
- Atomic append
- Non-blocking
- Must complete < 5ms under normal load

---

# 2D. Feature Extraction (M-02+)

module.exports = {
  extractSemanticFeatures,
  extractBehaviorFeatures,
  extractVisualFeatures
};

No raw content may be returned or persisted.

---

# 2E. Scoring Engine (M-03+)

module.exports = {
  computeFocusScore
};

Returns:

| Field | Type | Required |
|-------|------|----------|
| score | number | Yes |
| score_components | object | Yes |
| top_reasons | string[] | Yes |

---

# 3. Storage Contracts

---

# 3A. EventRecordV1 (JSONL)

| Field | Type | Required |
|-------|------|----------|
| schema_version | string | Yes |
| created_at | string | Yes |
| timezone_offset | number | Yes |
| monotonic_ms | number | Yes |
| session_id | string | Yes |
| timestamp | number | Yes |
| app_name | string | Yes |
| window_title | string | Yes |
| bundle_id | string | Optional |
| process_name | string | Optional |
| key_count | number | Yes |
| click_count | number | Yes |
| mouse_distance | number | Yes |
| scroll_delta | number | Yes |
| idle_ms | number | Yes |
| dwell_time_ms | number | Yes |
| trigger_reason | enum | Yes |

---

Smart Save Trigger Enum:

WINDOW_CHANGE
INPUT_ACTIVITY
HEARTBEAT
SHUTDOWN_FLUSH
CHECKPOINT_FLUSH

---

# 4. Sanitization Strategy (Mandatory)

window_title MUST be sanitized before persistence.

Sanitization Strategy:

1. URLs:
   - Extract domain only.
   - Strip query parameters.
   - Remove fragments.

2. Emails:
   - Mask local part.
   - Preserve domain.

3. File paths:
   - Remove user directory names.
   - Keep filename only.

4. Length limit:
   - Max 512 chars after sanitization.

Raw window titles MUST NEVER be persisted.

Sanitization MUST occur before EventRecord construction.

---

# 5. Resource Governance

## Configuration (config.json)

| Field | Type | Required |
|-------|------|----------|
| sampling_interval_ms | number | Yes |
| heartbeat_interval_ms | number | Yes |
| idle_threshold_ms | number | Yes |
| privacy_kill_switch | boolean | Yes |
| max_window_title_length | number | Yes |
| cpu_throttle_threshold | number | Yes |
| max_storage_mb | number | Yes |
| retention_days | number | Yes |
| checkpoint_interval_ms | number | Yes |

---

## Storage Enforcement Rules

- JSONL total size MUST NOT exceed max_storage_mb
- Oldest files deleted when limit exceeded
- Records older than retention_days MUST be purged
- Purge MUST run at startup and daily

---

# 6. Session Contract

| Field | Type | Required |
|-------|------|----------|
| session_id | string | Yes |
| start_ts | number | Yes |
| end_ts | number | Optional |

---

# 7. Contractual Prohibitions

The system MUST NEVER:

- Store raw keystrokes
- Store clipboard contents
- Store OCR text
- Store raw video frames
- Store screen recordings
- Transmit telemetry externally
- Store full URLs
- Store email addresses in full
- Persist unsanitized window titles

Only aggregated telemetry may be persisted.

---

# 8. Change Process

New MAJOR required if:
- Required field added
- Field removed
- Field type changed
- Sanitization strategy changed
- Privacy rules modified

All changes MUST be recorded in DECISION.md.

Each entry MUST include:
- Decision ID
- Date
- Impacted Interface
- Version change
- Migration required (Y/N)

Safe Rollout:

1. Writer updated first.
2. Reader supports both versions.
3. Checkpoint compatibility verified.
4. Release.
5. Deprecate old version after validation.

---

End of INTERFACES.md
