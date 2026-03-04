-- Migration 003: semantic calibration thresholds
CREATE TABLE IF NOT EXISTS semantic_calibration (
  goal_id      TEXT NOT NULL,
  day_utc      TEXT NOT NULL,
  t_on         REAL NOT NULL,
  t_off        REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY (goal_id, day_utc)
);
