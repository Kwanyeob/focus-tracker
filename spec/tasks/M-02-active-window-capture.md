# M-02 - Active Window Tracking (INTERFACES.md Compliant)

- ID: `M-02-AW`
- Status: `Planned`
- Type: `Feature`
- Depends on: _None_

## Goal

Implement production-grade Active Window Tracking compliant with `INTERFACES.md`.

This module must:

- Read currently active window using OS-level API (`active-win`)
- Sanitize window title **before** persistence
- Expose stable CommonJS interface
- Integrate with JSONL persistence layer
- Respect all privacy prohibitions

This task does **NOT** include:

- Input aggregation
- Scoring
- AI
- UI
- SQLite

## Compliance Requirement

This module **MUST** comply with:

- `docs/INTERFACES.md`
- `docs/ARCHITECTURE.md`
- `docs/SCOPE.md`

`INTERFACES.md` takes precedence.

## 1. Module Location

File: `capture/activeWindow.js`

Runtime: Node.js (CommonJS)

## 2. Required Exports

Module **MUST** export:

```js
module.exports = {
  getActiveWindow,
  startActiveWindowWatcher,
  stopActiveWindowWatcher,
};
```

## 3. `getActiveWindow()`

Returns:

```js
{
  timestamp: number,
  monotonic_ms: number,
  app_name: string,
  window_title: string,
  bundle_id?: string,
  process_name?: string,
}
```

Field rules:

- `timestamp`
  - Epoch ms (`Date.now`)
- `monotonic_ms`
  - Derived from `process.hrtime.bigint()`
  - Converted to `Number(ms)`
- `app_name`
  - Required
  - Must not be empty
- `window_title`
  - Required
  - **MUST** be sanitized before returning
- `bundle_id`
  - Optional (macOS)
- `process_name`
  - Optional

## 4. Sanitization Strategy (MANDATORY)

Sanitization **MUST** occur before persistence.

Rules:

- URLs
  - Extract domain only
  - Strip query parameters
  - Remove fragments
  - Example:

```txt
https://mail.google.com/mail/u/0/#inbox -> mail.google.com
```

- Emails
  - Mask local part
  - Preserve domain
  - Example:

```txt
john.doe@gmail.com -> ***@gmail.com
```

- File paths
  - Remove user directory names
  - Keep filename only
  - Example:

```txt
C:\Users\John\Documents\report.docx -> report.docx
```

- Length limit
  - Maximum 512 characters after sanitization
  - If `window_title` exceeds limit, truncate safely

Raw window titles **MUST NEVER** be persisted.

## 5. Watcher Behavior

`startActiveWindowWatcher(options)`

Options:

```js
{
  interval_ms: number, // default 1000
  onChange: function(windowData),
}
```

Behavior:

- Poll active window at `interval_ms`
- Detect change by comparing:
  - `app_name`
  - `window_title`
- On change:
  - Invoke `onChange(windowData)`

Watcher **MUST**:

- Avoid tight loops
- Be CPU efficient
- Stop cleanly

`stopActiveWindowWatcher()`

Must:

- Clear interval
- Release references
- Prevent memory leaks

## 6. Integration with Persistence

On `WINDOW_CHANGE` event:

Construct `EventRecordV1` compliant object.

Required fields from `INTERFACES.md`:

- `schema_version` (string, e.g. `"1.0.0"`)
- `created_at` (ISO UTC string)
- `timezone_offset` (minutes)
- `monotonic_ms`
- `event_id`
- `session_id`
- `timestamp`
- `app_name`
- `window_title`
- `key_count` (`0` if not available yet)
- `click_count` (`0`)
- `mouse_distance` (`0`)
- `scroll_delta` (`0`)
- `idle_ms` (`0`)
- `dwell_time_ms` (`0`)
- `trigger_reason = "WINDOW_CHANGE"`

Append using:

```js
appendEventRecord(record);
```

Do **NOT** persist:

- Raw URLs
- Raw emails
- Raw paths

## 7. Privacy Constraints (NON-NEGOTIABLE)

The module **MUST NEVER**:

- Store raw keystrokes
- Store full URLs
- Store full email addresses
- Store unsanitized window titles
- Transmit telemetry externally

Only sanitized data may be returned.

## 8. Error Handling

If `active-win` fails:

- Log error
- Return `null`
- Do not crash process

If permissions are denied:

- Degrade gracefully
- Continue polling
- Emit warning

## 9. Performance Requirements

- Poll interval default: `1000ms`
- Average CPU: `< 2%`
- No memory leak during 2-hour run

## 10. Unit Tests Required

File: `test/activeWindow.test.js`

Test cases:

- Sanitization of URL
- Sanitization of email
- Sanitization of file path
- Length truncation
- Change detection
- No duplicate emission when unchanged
- Proper stop behavior

## 11. Acceptance Criteria

All must pass:

- `npm test` passes
- No raw window title persisted
- Sanitization validated
- Watcher stops cleanly
- No memory leak during 2-hour test

## 12. Out of Scope

Do **NOT** implement:

- Input aggregation
- SQLite
- Scoring
- Feature extraction
- UI

Only active window tracking.

