'use strict';

/**
 * src/storage/sqlite/repository.js
 *
 * Low-level insert/query helpers for all SQLite tables — M-05-SQLITE.
 *
 * All write functions use INSERT OR IGNORE so duplicate event_ids are silently
 * skipped (idempotent replay of the same events).
 * upsertFeature uses INSERT OR REPLACE for idempotent feature rebuilds.
 *
 * Statements are prepared lazily on first call and cached for the lifetime of
 * the current DB connection. Calling closeDb() + openDb() invalidates the
 * cache automatically via the _stmts object reset.
 */

const { getDb } = require('./db');

// ─── Statement cache ──────────────────────────────────────────────────────────
// Keyed on the live Database instance so that a close+reopen cycle forces a
// fresh prepare on the new connection.

let _cachedDb = null;
let _stmts = null;

function _s() {
  const db = getDb();
  if (db !== _cachedDb) {
    _cachedDb = db;
    _stmts = _prepareAll(db);
  }
  return _stmts;
}

function _prepareAll(db) {
  return {
    insertRaw: db.prepare(`
      INSERT OR IGNORE INTO events_raw
        (id, session_id, seq, type, created_at, timezone_offset, timestamp_ms, monotonic_ms, payload_json)
      VALUES (?,?,?,?,?,?,?,?,?)
    `),
    insertDwell: db.prepare(`
      INSERT OR IGNORE INTO window_dwell
        (id, session_id, seq, created_at, timezone_offset, timestamp_ms,
         window_event_id, app_name, normalized_window_title,
         start_monotonic_ms, end_monotonic_ms, dwell_time_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `),
    insertInput: db.prepare(`
      INSERT OR IGNORE INTO input_summary
        (id, session_id, seq, created_at, timezone_offset, timestamp_ms,
         active_window_id, key_count, click_count, mouse_distance,
         scroll_delta, idle_ms, dwell_time_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `),
    upsertFeature: db.prepare(`
      INSERT OR REPLACE INTO features_30s
        (window_start_utc, window_start_local, timezone_offset,
         key_rate, click_rate, scroll_rate, mouse_speed, idle_ratio,
         context_switch_count,
         code_ms, docs_ms, video_ms, social_ms, game_ms, other_ms,
         top_app_name, top_category, deep_work_candidate_flag)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `),
  };
}

// ─── Write helpers ────────────────────────────────────────────────────────────

/**
 * Insert any event into events_raw.
 * `record.timestamp` (epoch ms) maps to the timestamp_ms column.
 * `record.monotonic_ms` or `record.end_monotonic_ms` maps to monotonic_ms.
 *
 * @param {object} record
 */
function insertRaw(record) {
  _s().insertRaw.run(
    record.event_id,
    record.session_id,
    record.seq,
    record.type,
    record.created_at,
    record.timezone_offset,
    record.timestamp || 0,
    record.monotonic_ms || record.end_monotonic_ms || 0,
    JSON.stringify(record)
  );
}

/**
 * Insert a window_dwell event into the derived window_dwell table.
 * @param {object} record - Must have all window_dwell fields.
 */
function insertWindowDwell(record) {
  _s().insertDwell.run(
    record.event_id,
    record.session_id,
    record.seq,
    record.created_at,
    record.timezone_offset,
    record.timestamp,
    record.window_event_id,
    record.app_name,
    record.normalized_window_title,
    record.start_monotonic_ms,
    record.end_monotonic_ms,
    record.dwell_time_ms
  );
}

/**
 * Insert an input_summary event into the derived input_summary table.
 * @param {object} record - Must have all input_summary fields.
 */
function insertInputSummary(record) {
  _s().insertInput.run(
    record.event_id,
    record.session_id,
    record.seq,
    record.created_at,
    record.timezone_offset,
    record.timestamp,
    record.active_window_id,
    record.key_count,
    record.click_count,
    record.mouse_distance,
    record.scroll_delta,
    record.idle_ms,
    record.dwell_time_ms
  );
}

/**
 * Insert or replace a features_30s row (idempotent).
 * @param {object} row
 */
function upsertFeature(row) {
  _s().upsertFeature.run(
    row.window_start_utc,
    row.window_start_local,
    row.timezone_offset,
    row.key_rate,
    row.click_rate,
    row.scroll_rate,
    row.mouse_speed,
    row.idle_ratio,
    row.context_switch_count,
    row.code_ms,
    row.docs_ms,
    row.video_ms,
    row.social_ms,
    row.game_ms,
    row.other_ms,
    row.top_app_name,
    row.top_category,
    row.deep_work_candidate_flag ? 1 : 0
  );
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Return all window_dwell rows whose segment overlaps [startMs, endMs).
 * Segment = [timestamp_ms - dwell_time_ms, timestamp_ms).
 */
function getDwellsInRange(startMs, endMs) {
  return getDb().prepare(`
    SELECT * FROM window_dwell
    WHERE (timestamp_ms - dwell_time_ms) < ? AND timestamp_ms > ?
    ORDER BY timestamp_ms
  `).all(endMs, startMs);
}

/**
 * Return all input_summary rows with timestamp_ms in [startMs, endMs).
 */
function getInputsInRange(startMs, endMs) {
  return getDb().prepare(`
    SELECT * FROM input_summary
    WHERE timestamp_ms >= ? AND timestamp_ms < ?
  `).all(startMs, endMs);
}

/**
 * Return features_30s rows in [startLocal, endLocal) ordered by local time.
 * Strings compared lexicographically — works because the format is ISO-like.
 */
function getFeaturesInLocalRange(startLocal, endLocal) {
  return getDb().prepare(`
    SELECT * FROM features_30s
    WHERE window_start_local >= ? AND window_start_local < ?
    ORDER BY window_start_local
  `).all(startLocal, endLocal);
}

/**
 * Return top N apps by total dwell_time_ms with timestamp_ms in [startMs, endMs).
 */
function getTopAppsByDwell(startMs, endMs, limit = 5) {
  return getDb().prepare(`
    SELECT app_name, SUM(dwell_time_ms) AS total_ms
    FROM window_dwell
    WHERE timestamp_ms >= ? AND timestamp_ms < ?
    GROUP BY app_name
    ORDER BY total_ms DESC
    LIMIT ?
  `).all(startMs, endMs, limit);
}

/**
 * Return the overall wall-clock range covered by window_dwell records.
 * Returns { min_ts, max_ts } or null when table is empty.
 */
function getDwellTimeRange() {
  return getDb().prepare(`
    SELECT
      MIN(timestamp_ms - dwell_time_ms) AS min_ts,
      MAX(timestamp_ms)                 AS max_ts
    FROM window_dwell
    WHERE dwell_time_ms > 0
  `).get();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  insertRaw,
  insertWindowDwell,
  insertInputSummary,
  upsertFeature,
  getDwellsInRange,
  getInputsInRange,
  getFeaturesInLocalRange,
  getTopAppsByDwell,
  getDwellTimeRange,
};
