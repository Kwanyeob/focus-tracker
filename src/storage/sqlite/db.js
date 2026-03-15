'use strict';

/**
 * src/storage/sqlite/db.js
 *
 * SQLite database lifecycle — M-05-SQLITE.
 *
 * Responsibilities:
 *   - Open / close the DB file (single shared instance per process)
 *   - Enable WAL mode and foreign keys
 *   - Run migrations in version order (idempotent)
 *
 * Default DB path: ~/.focus-tracker/focus-tracker.db
 * Override via: FOCUS_TRACKER_DB_PATH environment variable
 *               or the dbPath argument to openDb()
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.focus-tracker', 'focus-tracker.db');

/** Shared DB instance — null until openDb() is called. */
let _db = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open (or return) the shared SQLite database.
 * Creates the directory and file if missing.
 * Runs all pending migrations on first open.
 *
 * @param {string} [dbPath] - Override the default path.
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  if (_db) return _db;

  const resolved = dbPath || process.env.FOCUS_TRACKER_DB_PATH || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  _db = new Database(resolved);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _migrate(_db);
  return _db;
}

/**
 * Return the shared DB instance.
 * Throws if openDb() has not been called yet.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!_db) throw new Error('[db] Not initialized — call openDb() first.');
  return _db;
}

/**
 * Close the shared DB and clear the reference.
 * Safe to call when already closed.
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ─── Migration runner ─────────────────────────────────────────────────────────

function _migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_version').all().map(r => r.version)
  );

  const migrations = [
    [1, _m001],
    [2, _m002],
    [3, _m003],
    [4, _m004],
    [5, _m005],
  ];

  for (const [v, fn] of migrations) {
    if (!applied.has(v)) {
      fn(db);
      db.prepare('INSERT INTO schema_version VALUES (?,?)').run(v, new Date().toISOString());
    }
  }
}

// ─── Migration 001: core event tables ─────────────────────────────────────────

function _m001(db) {
  db.exec(`
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
  `);
}

// ─── Migration 002: feature windows table ────────────────────────────────────

function _m002(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS features_30s (
      window_start_utc         TEXT PRIMARY KEY,
      window_start_local       TEXT    NOT NULL,
      timezone_offset          INTEGER NOT NULL,
      key_rate                 REAL    NOT NULL DEFAULT 0,
      click_rate               REAL    NOT NULL DEFAULT 0,
      scroll_rate              REAL    NOT NULL DEFAULT 0,
      mouse_speed              REAL    NOT NULL DEFAULT 0,
      idle_ratio               REAL    NOT NULL DEFAULT 0,
      context_switch_count     INTEGER NOT NULL DEFAULT 0,
      code_ms                  INTEGER NOT NULL DEFAULT 0,
      docs_ms                  INTEGER NOT NULL DEFAULT 0,
      video_ms                 INTEGER NOT NULL DEFAULT 0,
      social_ms                INTEGER NOT NULL DEFAULT 0,
      game_ms                  INTEGER NOT NULL DEFAULT 0,
      other_ms                 INTEGER NOT NULL DEFAULT 0,
      top_app_name             TEXT    NOT NULL DEFAULT '',
      top_category             TEXT    NOT NULL DEFAULT 'other',
      deep_work_candidate_flag INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_f30_local ON features_30s (window_start_local);
  `);
}

// ─── Migration 003: semantic calibration thresholds ──────────────────────────

function _m003(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_calibration (
      goal_id        TEXT NOT NULL,
      day_utc        TEXT NOT NULL,
      t_on           REAL NOT NULL,
      t_off          REAL NOT NULL,
      sample_count   INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL,
      PRIMARY KEY (goal_id, day_utc)
    );
  `);
}

// ─── Migration 004: active goal storage ──────────────────────────────────────

function _m004(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_goal (
      id              TEXT PRIMARY KEY,
      text            TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      model_id        TEXT NOT NULL,
      created_at_utc  TEXT NOT NULL,
      updated_at_utc  TEXT NOT NULL
    );
  `);
}

// ─── Migration 005: split goal into todoText + appHint ───────────────────────

function _m005(db) {
  db.exec(`
    ALTER TABLE active_goal ADD COLUMN todo_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE active_goal ADD COLUMN app_hint  TEXT;
  `);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { openDb, getDb, closeDb };
