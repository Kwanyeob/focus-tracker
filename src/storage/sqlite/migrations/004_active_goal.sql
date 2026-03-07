-- Migration 004: active goal storage
CREATE TABLE IF NOT EXISTS active_goal (
  id              TEXT PRIMARY KEY,
  text            TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  created_at_utc  TEXT NOT NULL,
  updated_at_utc  TEXT NOT NULL
);
