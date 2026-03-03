-- Migration 002: Feature windows table

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
