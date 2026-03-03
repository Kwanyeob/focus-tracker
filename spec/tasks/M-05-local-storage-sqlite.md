# M-05 - Local Storage Engine (SQLite)

- ID: `M-05-SQLITE`
- Status: `Proposed`
- Type: `Feature`
- Depends on: `M-03-AW-FIX`, `M-04-DWELL`

## 1. Objective

Introduce a local SQLite storage engine to persist all event streams and derived records for reliable querying, reporting, and ML feature export.

Goals:

- ACID-safe local persistence
- Fast queries for daily/weekly analytics
- Efficient feature extraction for ML
- Minimal overhead (local-only, privacy-preserving)

## 2. Scope

### In Scope

- SQLite DB file creation and migrations
- Tables for raw and derived events
- Event writer integration (dual-write optional during transition)
- Minimal indexing for performance
- A simple query API (read helpers)

### Out of Scope

- Full report UI
- Remote sync
- Complex aggregation pipelines (handled in `M-07` / `M-08`)

## 3. Data Model (Initial)

### 3.1 `events_raw` (append-only)

Purpose: store all events (`active_window`, `input_summary`, `window_dwell`, future types) in one canonical table.

Columns:

- `id TEXT PRIMARY KEY` (`event_id`)
- `session_id TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `type TEXT NOT NULL`
- `created_at TEXT NOT NULL` (UTC ISO-8601)
- `timezone_offset INTEGER NOT NULL` (minutes)
- `timestamp_ms INTEGER NOT NULL` (epoch ms)
- `monotonic_ms INTEGER NOT NULL`
- `payload_json TEXT NOT NULL` (full event JSON string)

Indexes:

- `(session_id, seq)`
- `(timestamp_ms)`
- `(type)`
- Optional: `(created_at)`

Constraints:

- `UNIQUE(session_id, seq)` recommended if `seq` is strictly monotonic per session

### 3.2 `window_dwell` (derived table)

Purpose: fast window duration analytics without parsing JSON.

Columns:

- `id TEXT PRIMARY KEY` (`event_id`)
- `session_id TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `timezone_offset INTEGER NOT NULL`
- `timestamp_ms INTEGER NOT NULL`
- `window_event_id TEXT NOT NULL`
- `app_name TEXT NOT NULL`
- `normalized_window_title TEXT NOT NULL`
- `start_monotonic_ms INTEGER NOT NULL`
- `end_monotonic_ms INTEGER NOT NULL`
- `dwell_time_ms INTEGER NOT NULL`

Indexes:

- `(timestamp_ms)`
- `(app_name)`
- `(normalized_window_title)`

### 3.3 `input_summary` (derived table)

Columns:

- `id TEXT PRIMARY KEY` (`event_id`)
- `session_id TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `timezone_offset INTEGER NOT NULL`
- `timestamp_ms INTEGER NOT NULL`
- `active_window_id TEXT NOT NULL`
- `key_count INTEGER NOT NULL`
- `click_count INTEGER NOT NULL`
- `mouse_distance INTEGER NOT NULL`
- `scroll_delta INTEGER NOT NULL`
- `idle_ms INTEGER NOT NULL`
- `dwell_time_ms INTEGER NOT NULL`

Indexes:

- `(timestamp_ms)`
- `(active_window_id)`

## 4. Write Strategy

Option A (recommended): Single-writer to SQLite

- `eventWriter` writes to SQLite only
- JSONL becomes optional debug output

Option B: Dual-write during migration

- Write to JSONL and SQLite in parallel
- Compare outputs
- Deprecate JSONL once stable

## 5. Implementation Requirements

- Add SQLite dependency (Node)
- Create DB at a deterministic local path (configurable)
- Implement migrations:
  - Initial schema create
  - `schema_version` table
- Implement insert functions:
  - `insertRaw(event)`
  - `insertWindowDwell(event)`
  - `insertInputSummary(event)`
- Ensure WAL mode enabled for concurrency and performance
- Ensure graceful close on shutdown

## 6. Acceptance Criteria

- All events are persisted into `events_raw`
- `window_dwell` and `input_summary` are persisted into derived tables
- Queries can return:
  - Total dwell per app for a given day
  - Dwell list for a session ordered by `seq`
- No data loss during normal operation (crash-safe improvements can come later)
