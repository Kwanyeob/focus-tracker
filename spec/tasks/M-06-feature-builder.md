# M-06 - Feature Builder (ML-ready Aggregations)

- ID: `M-06-FEATURES`
- Status: `Proposed`
- Type: `Feature`
- Depends on: `M-05-SQLITE`

## 1. Objective

Build a deterministic feature generation pipeline that converts persisted events into fixed-window ML features (for example, `30s` / `60s` buckets) for focus vs distraction modeling.

This module produces:

- Feature tables in SQLite
- Export to CSV / Parquet (optional)

## 2. Feature Windows

Default:

- `30s` windows (primary)

Optional:

- `60s` windows for smoothing

Windowing policy:

- Time anchor is local time reconstructed from `created_at + timezone_offset`
- Duration math uses `monotonic_ms` when needed (for example, dwell overlaps)

## 3. Feature Set (Baseline v1)

Per window (`30s`):

### 3.1 Activity Features

- `key_rate = key_count / window_seconds`
- `click_rate`
- `scroll_rate = abs(scroll_delta) / window_seconds`
- `mouse_speed = mouse_distance / window_seconds`
- `idle_ratio = idle_ms / window_ms`

### 3.2 Context Features

- `context_switch_count` (`active_window` changes inside window)
- `app_dwell_ms_by_category`
  - `code_ms`, `docs_ms`, `video_ms`, `social_ms`, `game_ms`, `other_ms`
- `top_app_name` (mode)
- `top_category` (mode)
- `video_like_flag` (`category == video` and `dwell_ms` is high)
- `deep_work_candidate_flag` (`code/docs` dwell high and `idle_ratio` low and `context_switch_count` low)

### 3.3 Optional Signals

- `night_flag` (local hour)
- `weekday_flag`

## 4. Category Mapping

Implement a deterministic mapping:

- Code: VS Code, JetBrains, terminal editors
- Docs: Notion, Google Docs, PDF viewers
- Video: YouTube, Netflix, Twitch (browser tab normalization helps)
- Social: X, Instagram, Reddit, Discord
- Game: League, Steam games, etc.
- Other: fallback

Mapping must be local-only and configurable via a JSON / YAML file.

## 5. Storage

Create table: `features_30s`

Columns (minimum):

- `window_start_utc TEXT`
- `window_start_local TEXT`
- `timezone_offset INTEGER`
- `key_rate REAL`
- `click_rate REAL`
- `scroll_rate REAL`
- `mouse_speed REAL`
- `idle_ratio REAL`
- `context_switch_count INTEGER`
- `code_ms INTEGER`
- `docs_ms INTEGER`
- `video_ms INTEGER`
- `social_ms INTEGER`
- `game_ms INTEGER`
- `other_ms INTEGER`
- `top_app_name TEXT`
- `top_category TEXT`
- `deep_work_candidate_flag INTEGER`

Indexes:

- `(window_start_utc)`
- `(window_start_local)`

## 6. Implementation Requirements

`FeatureBuilder` reads from SQLite derived tables:

- `window_dwell`
- `input_summary`

Requirements:

- Bucket events into `30s` windows
- Handle overlap:
  - A dwell segment may span multiple feature windows; distribute `dwell_ms` proportionally
- Output is idempotent:
  - Running builder twice should not duplicate rows (use primary key on `window_start_utc`)

## 7. Acceptance Criteria

- `features_30s` fills continuously for sessions with sufficient data
- Basic sanity checks pass:
  - `sum(category_ms)` is approximately `30000ms` per window (allow small gaps)
  - `idle_ratio` stays within `[0,1]`
- Exportable dataset ready for baseline ML (`logistic regression` / `lightGBM` / simple NN)
