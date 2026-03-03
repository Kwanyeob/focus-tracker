-- Migration 001: Initial schema
-- Tables: events_raw, window_dwell, input_summary, schema_version

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events_raw (
  id              TEXT PRIMARY KEY,
  session_id      TEXT    NOT NULL,
  seq             INTEGER NOT NULL,
  type            TEXT    NOT NULL,
  created_at      TEXT    NOT NULL,
  timezone_offset INTEGER NOT NULL,
  timestamp_ms    INTEGER NOT NULL,
  monotonic_ms    INTEGER NOT NULL,
  payload_json    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_er_sess_seq ON events_raw (session_id, seq);
CREATE        INDEX IF NOT EXISTS idx_er_ts       ON events_raw (timestamp_ms);
CREATE        INDEX IF NOT EXISTS idx_er_type     ON events_raw (type);

CREATE TABLE IF NOT EXISTS window_dwell (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT    NOT NULL,
  seq                     INTEGER NOT NULL,
  created_at              TEXT    NOT NULL,
  timezone_offset         INTEGER NOT NULL,
  timestamp_ms            INTEGER NOT NULL,
  window_event_id         TEXT    NOT NULL,
  app_name                TEXT    NOT NULL,
  normalized_window_title TEXT    NOT NULL,
  start_monotonic_ms      INTEGER NOT NULL,
  end_monotonic_ms        INTEGER NOT NULL,
  dwell_time_ms           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wd_ts  ON window_dwell (timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_wd_app ON window_dwell (app_name);

CREATE TABLE IF NOT EXISTS input_summary (
  id               TEXT PRIMARY KEY,
  session_id       TEXT    NOT NULL,
  seq              INTEGER NOT NULL,
  created_at       TEXT    NOT NULL,
  timezone_offset  INTEGER NOT NULL,
  timestamp_ms     INTEGER NOT NULL,
  active_window_id TEXT    NOT NULL,
  key_count        INTEGER NOT NULL,
  click_count      INTEGER NOT NULL,
  mouse_distance   INTEGER NOT NULL,
  scroll_delta     INTEGER NOT NULL,
  idle_ms          INTEGER NOT NULL,
  dwell_time_ms    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_is_ts ON input_summary (timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_is_aw ON input_summary (active_window_id);
