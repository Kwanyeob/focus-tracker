# M-03 - Active Window Capture Fix

**ID:** `M-03-AW-FIX`  
**Status:** Proposed  
**Type:** Refactor  
**Depends on:** `M-02-active-window-capture`

## 1. Background

Current implementation logs input-related metrics (`key_count`, `mouse_distance`, `scroll_delta`, `idle_ms`, `dwell_time_ms`) inside `WINDOW_CHANGE` events.

This causes:

- Frequent zero-value fields
- Blurred semantic meaning of event types
- Difficulty separating context changes from activity metrics
- No clean way to compute dwell time per window
- Noisy analytics payload

The system must separate context change events from activity aggregation events.

## 2. Decision

Adopt Event Type Separation (Architecture A).

Introduce two distinct event types:

- `active_window`
- `input_summary`

Context events and activity events must not share semantic responsibility.

## 3. New Event Model

### 3.1 `active_window` Event

Represents a change in user context (application or window switch).

Trigger conditions:

- OS-level window change
- App foreground change
- Explicit window refocus

Required fields:

- `type = "active_window"`
- `event_id`
- `session_id`
- `seq`
- `created_at` (UTC ISO-8601)
- `timezone_offset` (minutes)
- `timestamp` (epoch ms)
- `monotonic_ms`
- `app_name`
- `window_title`
- `trigger_reason`

Strict rule: The `active_window` event MUST NOT include:

- `key_count`
- `click_count`
- `mouse_distance`
- `scroll_delta`
- `idle_ms`
- `dwell_time_ms`

This event is strictly contextual.

### 3.2 `input_summary` Event

Represents aggregated user activity over a fixed time window.

Trigger conditions:

- Periodic flush (recommended: every 5-10 seconds)
- OR immediately before a window change occurs

Required fields:

- `type = "input_summary"`
- `event_id`
- `session_id`
- `seq`
- `created_at` (UTC ISO-8601)
- `timezone_offset` (minutes)
- `timestamp` (epoch ms)
- `monotonic_ms`
- `active_window_id` (reference to last `active_window` event)
- `key_count`
- `click_count`
- `mouse_distance`
- `scroll_delta`
- `idle_ms`
- `dwell_time_ms`

Rules:

- Must reference the active window via `active_window_id`
- Duration calculations MUST use `monotonic_ms`
- Zero-value spam should be minimized (no meaningless flushes)

## 4. Dwell Time Calculation

Dwell time per window must be computed using monotonic time.

Correct formula:

```text
dwell_time = next_active_window.monotonic_ms - current_active_window.monotonic_ms
```

Wall-clock timestamps (`created_at` or `timestamp`) MUST NOT be used for interval computation.

## 5. Window Title Normalization (Optional but Recommended)

To reduce excessive event noise:

- Strip file names from VS Code window titles
- Normalize Chrome titles to domain-level granularity
- Avoid micro-context fragmentation

Example:

Before:
`"M-02-active-window-capture.md - focus-tracker - Visual Studio Code"`

After:
`"Visual Studio Code | focus-tracker"`

This prevents unnecessary event explosions.

## 6. Implementation Requirements

- Remove input metrics from `active_window` events
- Implement an input aggregator with periodic flush
- On window change:
  - Flush pending `input_summary` (if any)
  - Then emit new `active_window` event
- Preserve monotonic clock integrity
- Add a `type` field to all new events
- Bump `schema_version` if required

## 7. Acceptance Criteria

- `active_window` events contain no input metrics
- `input_summary` events contain aggregated activity data
- Zero-value field spam is eliminated
- Dwell time can be computed reliably using `monotonic_ms`
- Backward compatibility strategy is documented

## 8. Rationale

This refactor provides:

- Clean event semantics
- Improved analytical clarity
- Accurate focus scoring foundation
- Reduced payload noise
- Production-grade event modeling

## 9. Migration Strategy

- Legacy events remain readable
- New events include a mandatory `type` field
- Analytics layer must support both formats during transition
- Future deprecation of legacy structure to be planned separately

## 10. Future Extensions

This separation enables:

- Real-time focus scoring
- Passive vs active detection
- Idle segmentation
- Productivity heatmaps
- Window-level behavioral analytics
