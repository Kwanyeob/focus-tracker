# M-07 - Reporting MVP (Daily/Weekly)

- ID: `M-07-REPORTS`
- Status: `Proposed`
- Type: `Feature`
- Depends on: `M-05-SQLITE`, `M-06-FEATURES`

## 1. Objective

Deliver a minimal reporting MVP that proves end-to-end value:

- Daily time breakdown by app / category
- Top distraction apps
- Deep work candidate blocks (rule-based from `features_30s`)
- Simple weekly summary

Output targets:

- CLI report (`stdout`)
- Optional JSON output for later UI integration

## 2. Reports

### 2.1 Daily Summary (local day)

Total focused time estimate:

- `sum(windows where deep_work_candidate_flag = 1)`

Total time by category:

- `code`
- `docs`
- `video`
- `social`
- `game`
- `other`

Other outputs:

- Top 5 apps by dwell
- Context switches count

### 2.2 Weekly Summary

- Total deep work windows
- Trend chart data (no UI required; output arrays)

## 3. Deep Work Rule (v1)

A `30s` window is `deep_work_candidate` if:

- `(code_ms + docs_ms) >= 20000`
- `idle_ratio <= 0.35`
- `context_switch_count <= 1`
- `video_ms + social_ms + game_ms` is low

All thresholds are configurable.

## 4. Implementation Requirements

Implement report generator reading from:

- `features_30s`
- `window_dwell` (for top apps)

Support date selection:

- Default: `today` (local)
- Allow `YYYY-MM-DD`

Provide both human-readable and machine JSON modes:

- `--json` flag

## 5. Acceptance Criteria

Running report on a day produces:

- Category totals
- Top apps
- Deep work blocks estimate

Additional requirements:

- Report uses local day boundaries (`timezone_offset`-aware)
- Output is stable and easy to parse
