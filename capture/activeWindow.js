'use strict';

/**
 * capture/activeWindow.js
 *
 * Active Window Tracking module — M-02-AW.
 *
 * Compliant with INTERFACES.md §2A, §3A (EventRecordV1), and §4 (Sanitization).
 *
 * Exports (per INTERFACES.md §2A):
 *   getActiveWindow()
 *   startActiveWindowWatcher(options)
 *   stopActiveWindowWatcher()
 *
 * Additional exports for testing:
 *   sanitizeWindowTitle(title)
 *
 * Privacy guarantees (INTERFACES.md §7 — NON-NEGOTIABLE):
 *   - Raw window titles NEVER returned or persisted
 *   - Full URLs NEVER stored (domain only)
 *   - Full email addresses NEVER stored (local part masked)
 *   - Raw file paths NEVER stored (filename only)
 *   - No external telemetry
 *
 * Runtime: Node.js (CommonJS)
 * OS: Windows + macOS
 */

const crypto = require('crypto');
const os = require('os');

// ─── active-win (v7, CommonJS) ───────────────────────────────────────────────
// Loaded lazily to allow test mocking. Falls back to null if unavailable
// (e.g., permission denied, platform not supported).
let _activeWin;
try {
  _activeWin = require('active-win');
} catch (err) {
  console.warn('[activeWindow] active-win unavailable:', err.message);
  _activeWin = null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = '1.1.0';
const MAX_TITLE_LENGTH = 512;
const DEFAULT_INTERVAL_MS = 1000;

// ─── Session State ────────────────────────────────────────────────────────────
// One session_id and one seq counter per process lifetime.
// seq increments by exactly 1 per persisted event (never skips, never decreases).

const _SESSION_ID = _generateSessionId();
let _seq = 0;

/**
 * Generates a unique session_id.
 * Format: <sanitized-hostname>-<epoch_ms>-<8-char-hex>
 * Uses crypto.randomUUID() — no external uuid dependency.
 */
function _generateSessionId() {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'host';
  const epoch = Date.now();
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${hostname}-${epoch}-${rand}`;
}

// ─── Sanitization ─────────────────────────────────────────────────────────────

/**
 * URL pattern.
 * Matches http(s):// + host + optional path/query/fragment.
 * Captures the host only (group 1).
 *
 * Example: "https://mail.google.com/mail/u/0/#inbox" → host = "mail.google.com"
 */
const _URL_RE = /https?:\/\/([^\/\s?#"<>]+)[^\s"<>]*/gi;

/**
 * Email pattern.
 * Matches local@domain.tld. Captures the domain (group 1).
 * Run AFTER URL sanitization so that email-like tokens inside URLs are already replaced.
 *
 * Example: "john.doe@gmail.com" → domain = "gmail.com"
 */
const _EMAIL_RE = /[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

/**
 * Windows absolute path pattern.
 * Matches DRIVE:\ followed by directory components, captures the final filename.
 *
 * Example: "C:\Users\John\Documents\report.docx" → filename = "report.docx"
 */
const _WIN_PATH_RE = /[A-Za-z]:\\(?:[^\\<>:"\/|?*\r\n\s]+\\)*([^\\<>:"\/|?*\r\n\s]*)/g;

/**
 * Unix absolute path with at least one directory separator after the root.
 * Does NOT match single-segment paths like "/tmp" (no trailing slash after the segment).
 * Captures the final filename (group 1).
 *
 * Example: "/home/john/documents/report.pdf" → filename = "report.pdf"
 * Non-example: "/tmp" → no match (only one segment)
 */
const _UNIX_PATH_RE = /\/(?:[^\s\/\\:*?"<>|]+\/)+([^\s\/\\:*?"<>|]*)/g;

/**
 * Sanitizes a raw window title per INTERFACES.md §4.
 *
 * Steps (applied in order):
 *   1. Replace URLs with domain only
 *   2. Replace email addresses with ***@domain
 *   3. Replace Windows absolute paths with filename only
 *   4. Replace Unix absolute paths with filename only
 *   5. Truncate to MAX_TITLE_LENGTH (512 chars)
 *
 * Returns an empty string for null/undefined/non-string input.
 * This function is PURE — it has no side effects.
 *
 * @param {string} title - Raw window title
 * @returns {string} Sanitized title
 */
function sanitizeWindowTitle(title) {
  if (!title || typeof title !== 'string') return '';

  // Reset regex lastIndex (stateful global regexes)
  _URL_RE.lastIndex = 0;
  _EMAIL_RE.lastIndex = 0;
  _WIN_PATH_RE.lastIndex = 0;
  _UNIX_PATH_RE.lastIndex = 0;

  let result = title;

  // Step 1: URLs → domain only
  // "Visit https://mail.google.com/mail/u/0/#inbox today" → "Visit mail.google.com today"
  result = result.replace(_URL_RE, (_match, host) => host);

  // Reset for reuse (global flag keeps lastIndex)
  _EMAIL_RE.lastIndex = 0;

  // Step 2: Emails → ***@domain
  // "Contact john.doe@gmail.com for info" → "Contact ***@gmail.com for info"
  result = result.replace(_EMAIL_RE, (_match, domain) => `***@${domain}`);

  _WIN_PATH_RE.lastIndex = 0;

  // Step 3: Windows paths → filename only
  // "Editing C:\Users\John\Documents\report.docx" → "Editing report.docx"
  result = result.replace(_WIN_PATH_RE, (_match, filename) => {
    return (filename !== undefined && filename !== '') ? filename : _match;
  });

  _UNIX_PATH_RE.lastIndex = 0;

  // Step 4: Unix paths → filename only
  // "Error opening /home/john/notes/todo.txt" → "Error opening todo.txt"
  result = result.replace(_UNIX_PATH_RE, (_match, filename) => {
    return (filename !== undefined && filename !== '') ? filename : _match;
  });

  // Step 5: Truncate
  if (result.length > MAX_TITLE_LENGTH) {
    result = result.slice(0, MAX_TITLE_LENGTH);
  }

  return result;
}

// ─── Watcher State ────────────────────────────────────────────────────────────

/** Handle returned by setInterval, or null when stopped. */
let _watcherTimer = null;

/**
 * Key of the last observed window: "<app_name>|<sanitized_window_title>".
 * Used for change detection. Reset to null on stop.
 */
let _lastWindowKey = null;

/**
 * Optional InputAggregator instance active during the current watcher session.
 * Flushed before each window change, stopped on watcher stop.
 */
let _currentAggregator = null;

/**
 * Optional DwellEngine instance active during the current watcher session.
 * Receives each new active_window record and emits window_dwell events.
 */
let _currentDwellEngine = null;

/**
 * The appendEventRecord function supplied to startActiveWindowWatcher.
 * Stored so stopActiveWindowWatcher can pass it to dwellEngine.flushFinal().
 */
let _currentAppendFn = null;

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Reads the currently active window and returns sanitized data.
 *
 * Returns an object matching INTERFACES.md §2A getActiveWindow() contract,
 * or null if:
 *   - active-win is unavailable
 *   - No window is active
 *   - An error occurs (logged, not thrown)
 *
 * @returns {Promise<{
 *   timestamp: number,
 *   monotonic_ms: number,
 *   app_name: string,
 *   window_title: string,
 *   bundle_id?: string,
 *   process_name?: string
 * } | null>}
 */
async function getActiveWindow() {
  if (!_activeWin) return null;

  let rawWindow;
  try {
    rawWindow = await _activeWin();
  } catch (err) {
    console.error('[activeWindow] Failed to read active window:', err.message);
    return null;
  }

  if (!rawWindow) return null;

  // Sanitize the raw title BEFORE constructing the result object.
  // Raw titles MUST NEVER be persisted (INTERFACES.md §7).
  const rawTitle = typeof rawWindow.title === 'string' ? rawWindow.title : '';
  const sanitizedTitle = sanitizeWindowTitle(rawTitle);

  // Derive app_name from the owner object (preferred) or fall back to sanitized title.
  const appName =
    (rawWindow.owner && rawWindow.owner.name && rawWindow.owner.name.trim())
      ? rawWindow.owner.name.trim()
      : (sanitizedTitle || 'Unknown');

  /** @type {object} */
  const result = {
    timestamp: Date.now(),
    // monotonic_ms: derived from process monotonic clock, NOT from wall clock.
    // Converted from bigint nanoseconds to number milliseconds.
    monotonic_ms: Number(process.hrtime.bigint() / 1_000_000n),
    app_name: appName,
    window_title: sanitizedTitle,
  };

  // Optional fields (INTERFACES.md §3A)
  if (rawWindow.owner) {
    if (rawWindow.owner.bundleId) {
      result.bundle_id = rawWindow.owner.bundleId;
    }
    const procName = rawWindow.owner.processName || rawWindow.owner.name;
    if (procName) {
      result.process_name = procName;
    }
  }

  return result;
}

/**
 * Starts polling for active window changes.
 *
 * Per INTERFACES.md §2A:
 *   - Polls at interval_ms (default 1000ms)
 *   - Detects change by comparing app_name + sanitized window_title
 *   - Calls onChange(windowData) on change
 *   - Optionally calls appendEventRecord(record) to persist an EventRecordV1
 *
 * M-03 extensions:
 *   - inputAggregator: optional InputAggregator instance; if provided it is
 *     flushed (emitting an input_summary) before each window change and driven
 *     by a periodic flush timer for the lifetime of the watcher.
 *   - inputFlushIntervalMs: periodic flush interval (default: aggregator's
 *     DEFAULT_FLUSH_INTERVAL_MS).
 *
 * If the watcher is already running, the existing one is stopped first.
 *
 * @param {{
 *   interval_ms?: number,
 *   onChange?: function,
 *   appendEventRecord?: function,
 *   inputAggregator?: object,
 *   inputFlushIntervalMs?: number
 * }} options
 */
function startActiveWindowWatcher(options) {
  if (!options || typeof options !== 'object') options = {};

  const interval_ms =
    (typeof options.interval_ms === 'number' && options.interval_ms > 0)
      ? options.interval_ms
      : DEFAULT_INTERVAL_MS;

  const onChange =
    typeof options.onChange === 'function' ? options.onChange : null;

  const appendEventRecord =
    typeof options.appendEventRecord === 'function' ? options.appendEventRecord : null;

  // Accept an InputAggregator instance via duck-typing (no import needed)
  const inputAggregator =
    (options.inputAggregator &&
     typeof options.inputAggregator.flush === 'function' &&
     typeof options.inputAggregator.setActiveWindow === 'function')
      ? options.inputAggregator
      : null;

  // Accept a DwellEngine instance via duck-typing (no import needed)
  const dwellEngine =
    (options.dwellEngine &&
     typeof options.dwellEngine.onActiveWindow === 'function' &&
     typeof options.dwellEngine.flushFinal === 'function')
      ? options.dwellEngine
      : null;

  // Stop any existing watcher (and its aggregator) before starting a new one
  stopActiveWindowWatcher();

  // Reset change-detection state so first poll always fires onChange if a window exists
  _lastWindowKey = null;

  // Store aggregator and dwell engine references for stopActiveWindowWatcher
  _currentAggregator  = inputAggregator;
  _currentDwellEngine = dwellEngine;
  _currentAppendFn    = appendEventRecord;

  // Start periodic flush for the aggregator (only if we also have a writer)
  if (_currentAggregator && appendEventRecord) {
    _currentAggregator.startPeriodicFlush(appendEventRecord, options.inputFlushIntervalMs);
  }

  _watcherTimer = setInterval(async () => {
    let windowData;
    try {
      windowData = await getActiveWindow();
    } catch (err) {
      console.error('[activeWindow] Poll error:', err.message);
      return;
    }

    if (!windowData) return;

    // Change detection: compare app_name + sanitized window_title
    const windowKey = `${windowData.app_name}|${windowData.window_title}`;
    if (windowKey === _lastWindowKey) {
      // Window unchanged — do NOT emit duplicate event
      return;
    }

    _lastWindowKey = windowKey;

    // Step 1: Flush pending input_summary BEFORE emitting the new active_window.
    // This preserves the invariant that input_summary.active_window_id always
    // references the window during which the input occurred.
    if (_currentAggregator && appendEventRecord) {
      _currentAggregator.flush(appendEventRecord);
    }

    // Step 2: Notify listener
    if (onChange) {
      try {
        onChange(windowData);
      } catch (err) {
        console.error('[activeWindow] onChange error:', err.message);
      }
    }

    // Step 3: Persist active_window event and update aggregator reference
    if (appendEventRecord) {
      try {
        const record = _buildEventRecord(windowData);
        appendEventRecord(record);
        // Step 4: Tell the aggregator which window is now active so future
        // input_summary records carry the correct active_window_id.
        if (_currentAggregator) {
          _currentAggregator.setActiveWindow(record.event_id, record.monotonic_ms);
        }

        // Step 5: Notify the dwell engine. It will close the previous window's
        // dwell segment and open a new one for this record.
        if (_currentDwellEngine) {
          _currentDwellEngine.onActiveWindow(record, appendEventRecord);
        }
      } catch (err) {
        console.error('[activeWindow] appendEventRecord error:', err.message);
      }
    }
  }, interval_ms);
}

/**
 * Stops the active window watcher and releases all references.
 *
 * Per spec: clears interval, releases references, prevents memory leaks.
 * Also stops any InputAggregator periodic flush timer if one is attached.
 * Safe to call multiple times.
 */
function stopActiveWindowWatcher() {
  if (_watcherTimer !== null) {
    clearInterval(_watcherTimer);
    _watcherTimer = null;
  }
  if (_currentAggregator) {
    _currentAggregator.stopPeriodicFlush();
    _currentAggregator = null;
  }
  if (_currentDwellEngine) {
    try {
      _currentDwellEngine.flushFinal(_currentAppendFn);
    } catch (err) {
      console.error('[activeWindow] dwellEngine.flushFinal error:', err.message);
    }
    _currentDwellEngine = null;
  }
  _currentAppendFn = null;
  _lastWindowKey = null;
}

// ─── EventRecordV1 Builder ────────────────────────────────────────────────────

/**
 * Constructs an `active_window` event record (schema_version 1.1.0).
 *
 * This event is purely contextual — it records a window/application change.
 * Input metrics are intentionally absent; they belong in `input_summary`
 * events emitted by InputAggregator (M-03-AW-FIX).
 *
 * Required fields:
 *   type, schema_version, event_id, session_id, seq, created_at,
 *   timezone_offset, timestamp, monotonic_ms, app_name, window_title,
 *   trigger_reason
 *
 * Optional fields (when present in windowData):
 *   bundle_id, process_name
 *
 * event_id uses crypto.randomUUID() — no external uuid dependency.
 * monotonic_ms is captured at poll time (not at record construction time).
 *
 * @param {{
 *   timestamp: number,
 *   monotonic_ms: number,
 *   app_name: string,
 *   window_title: string,
 *   bundle_id?: string,
 *   process_name?: string
 * }} windowData - Sanitized window data from getActiveWindow()
 * @returns {object} active_window event record
 */
function _buildEventRecord(windowData) {
  const now = new Date();

  /** @type {object} */
  const record = {
    schema_version:  SCHEMA_VERSION,
    type:            'active_window',
    event_id:        crypto.randomUUID(),
    session_id:      _SESSION_ID,
    seq:             _seq++,                          // internal ordering field
    created_at:      now.toISOString(),               // ISO-8601 UTC
    timezone_offset: -now.getTimezoneOffset(),        // minutes from UTC
    timestamp:       windowData.timestamp,            // epoch ms from poll time
    monotonic_ms:    windowData.monotonic_ms,         // monotonic clock from poll time
    app_name:        windowData.app_name,
    window_title:    windowData.window_title,         // ALREADY sanitized
    trigger_reason:  'WINDOW_CHANGE',
  };

  // Optional fields
  if (windowData.bundle_id !== undefined) {
    record.bundle_id = windowData.bundle_id;
  }
  if (windowData.process_name !== undefined) {
    record.process_name = windowData.process_name;
  }

  return record;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Public API (INTERFACES.md §2A)
  getActiveWindow,
  startActiveWindowWatcher,
  stopActiveWindowWatcher,

  // Exported for unit testing (not part of the public contract)
  sanitizeWindowTitle,
  _buildEventRecord,
};
