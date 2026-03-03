# M-04 - Dwell Time Engine

- ID: `M-04-DWELL`
- Status: `Proposed`
- Type: `Feature`
- Depends on: `M-03-AW-FIX`

## 1. Objective

Implement a reliable dwell time engine that calculates the duration spent in each active window.

Duration **MUST** be computed using `monotonic_ms`.

This feature provides the foundation for:

- Window-level analytics
- Focus scoring
- Productivity heatmaps
- Session reconstruction

## 2. Problem

Currently, `active_window` events are emitted but no deterministic dwell time is computed.

Without dwell calculation:

- Window usage time cannot be measured
- Focus duration cannot be derived
- Productivity analytics remain incomplete

## 3. Core Design

### 3.1 Dwell Definition

For two consecutive `active_window` events:

```txt
dwell_time_ms = next_active_window.monotonic_ms - current_active_window.monotonic_ms
```

Wall-clock timestamps **MUST NOT** be used.

### 3.2 Engine Behavior

When a new `active_window` event is emitted:

1. Retrieve previous `active_window` event
2. Compute dwell using monotonic delta
3. Emit derived event:

```txt
type = "window_dwell"
```

4. Store result

### 3.3 `window_dwell` Event Schema

Required fields:

- `type = "window_dwell"`
- `event_id`
- `session_id`
- `window_event_id` (reference to original `active_window`)
- `app_name`
- `normalized_window_title`
- `start_monotonic_ms`
- `end_monotonic_ms`
- `dwell_time_ms`
- `created_at`
- `timezone_offset`

### 3.4 Session End Handling

Edge case: last window before crash or shutdown.

Implement one of:

Option A (recommended):

- Emit heartbeat every N seconds
- On shutdown, flush final dwell

Option B:

- On next session start, close previous open window using stored monotonic state

System **MUST** prevent unclosed dwell windows.

## 4. Normalization Integration

Dwell events must use normalized window titles (if normalization layer exists).

This prevents micro-fragmentation.

## 5. Acceptance Criteria

- Every `active_window` (except last open window) results in one `window_dwell` event
- `dwell_time_ms` is always `>= 0`
- Dwell is computed using monotonic clock only
- No duplicate dwell records
- System recovers safely after restart

## 6. Future Extension

This engine enables:

- Focus intensity scoring
- App-level time breakdown
- Passive vs active segmentation
- Deep work detection
