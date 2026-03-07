-- Migration 005: split goal into todoText + appHint
ALTER TABLE active_goal ADD COLUMN todo_text TEXT NOT NULL DEFAULT '';
ALTER TABLE active_goal ADD COLUMN app_hint  TEXT;
