'use strict';

/**
 * capture/dwellEngine.js
 *
 * Dwell Time Engine — M-04-DWELL.
 *
 * Tracks how long the user stays in each active window and emits
 * `window_dwell` events derived from consecutive `active_window` events.
 *
 * Key invariants:
 *   - dwell_time_ms is ALWAYS >= 0 (never negative)
 *   - Duration uses ONLY monotonic_ms — never wall-clock timestamps
 *   - Each active_window event produces at most one closing window_dwell
 *     per window-change or flushFinal call (no duplicates)
 *   - A periodic heartbeat limits data loss on crash to at most
 *     DEFAULT_HEARTBEAT_INTERVAL_MS milliseconds
 *
 * Integration:
 *   Pass a DwellEngine instance to startActiveWindowWatcher({ dwellEngine }).
 *   activeWindow.js calls onActiveWindow() on every new active_window event
 *   and flushFinal() when the watcher stops.
 *
 * Runtime: Node.js (CommonJS)
 * OS: Windows + macOS
 */

const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = '1.1.0';

/**
 * Default heartbeat interval (30 s).
 * Every N ms the current open window emits a partial window_dwell and
 * resets its segment baseline, so a crash loses at most N ms of dwell data.
 * Must be > 0.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

// ─── DwellEngine ─────────────────────────────────────────────────────────────

class DwellEngine {
  /**
   * @param {{
   *   sessionId: string,
   *   getSeq: () => number,
   *   heartbeatIntervalMs?: number
   * }} options
   *   sessionId           — shared session identifier (same as activeWindow.js)
   *   getSeq              — callback that returns and advances the seq counter
   *   heartbeatIntervalMs — periodic flush interval (default 30 000 ms)
   */
  constructor({ sessionId, getSeq, heartbeatIntervalMs } = {}) {
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('[DwellEngine] sessionId must be a non-empty string');
    }
    if (typeof getSeq !== 'function') {
      throw new Error('[DwellEngine] getSeq must be a function');
    }

    this._sessionId = sessionId;
    this._getSeq    = getSeq;
    this._heartbeatIntervalMs =
      (typeof heartbeatIntervalMs === 'number' && heartbeatIntervalMs > 0)
        ? heartbeatIntervalMs
        : DEFAULT_HEARTBEAT_INTERVAL_MS;

    /** @type {object|null} — the currently open active_window event record */
    this._currentRecord = null;

    /**
     * monotonic_ms at which the current tracking segment started.
     * Resets after each heartbeat flush to limit data loss on crash.
     */
    this._segmentStartMonotonicMs = null;

    /** Heartbeat setInterval handle, or null when stopped. */
    this._heartbeatTimer = null;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Called by activeWindow.js immediately after a new `active_window` event
   * is persisted.
   *
   * Behaviour:
   *   1. If a previous window was open, emit its closing `window_dwell` event.
   *   2. Open a new tracking segment for `record`.
   *   3. Restart the heartbeat timer (only when appendEventRecord is provided).
   *
   * @param {object}        record            - The new active_window event record
   * @param {function|null} appendEventRecord - Writer callback; null = track only
   */
  onActiveWindow(record, appendEventRecord) {
    const endMonotonic = record.monotonic_ms;

    // Close the previous window segment if one is open.
    // This is the primary dwell-emission path (on window change).
    if (this._currentRecord !== null) {
      this._emitDwell(endMonotonic, appendEventRecord);
    }

    // Open new segment
    this._currentRecord           = record;
    this._segmentStartMonotonicMs = record.monotonic_ms;

    // Restart heartbeat for the new window
    this._stopHeartbeat();
    if (appendEventRecord) {
      this._startHeartbeat(appendEventRecord);
    }
  }

  /**
   * Close the currently open window and emit its final `window_dwell` event.
   * Called by stopActiveWindowWatcher() for clean shutdown.
   * Also called internally by the heartbeat (with segment reset).
   * Safe to call when no window is open (no-op).
   *
   * After this call the engine holds no references — it is ready for reuse
   * or garbage collection.
   *
   * @param {function|null} appendEventRecord
   */
  flushFinal(appendEventRecord) {
    this._stopHeartbeat();

    if (this._currentRecord !== null) {
      const nowMonotonic = Number(process.hrtime.bigint() / 1_000_000n);
      this._emitDwell(nowMonotonic, appendEventRecord);
    }

    this._currentRecord           = null;
    this._segmentStartMonotonicMs = null;
  }

  // ─── Heartbeat ─────────────────────────────────────────────────────────────

  /**
   * Start a periodic heartbeat that emits partial window_dwell events and
   * resets the segment baseline. Limits crash data loss to heartbeatIntervalMs.
   *
   * @param {function} appendEventRecord
   */
  _startHeartbeat(appendEventRecord) {
    this._heartbeatTimer = setInterval(() => {
      if (this._currentRecord === null) return;

      const nowMonotonic = Number(process.hrtime.bigint() / 1_000_000n);

      // Emit the completed segment
      this._emitDwell(nowMonotonic, appendEventRecord);

      // Re-baseline so the next segment starts from now
      this._segmentStartMonotonicMs = nowMonotonic;
    }, this._heartbeatIntervalMs);
  }

  /** Stop the heartbeat timer. Safe to call when not running. */
  _stopHeartbeat() {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Build and emit one `window_dwell` record.
   *
   * Guarantees:
   *   - dwell_time_ms >= 0 (monotonic clock regressions silently floored to 0)
   *   - appendEventRecord errors are caught and logged; they do NOT throw
   *
   * @param {number}        endMonotonicMs
   * @param {function|null} appendEventRecord
   * @returns {object} The built window_dwell record
   */
  _emitDwell(endMonotonicMs, appendEventRecord) {
    const record  = this._currentRecord;
    const startMs = this._segmentStartMonotonicMs;
    const dwellMs = Math.max(0, endMonotonicMs - startMs);

    const now = new Date();

    /** @type {object} */
    const dwellRecord = {
      schema_version:          SCHEMA_VERSION,
      type:                    'window_dwell',
      event_id:                crypto.randomUUID(),
      session_id:              this._sessionId,
      seq:                     this._getSeq(),
      created_at:              now.toISOString(),
      timezone_offset:         -now.getTimezoneOffset(),
      timestamp:               Date.now(),
      window_event_id:         record.event_id,
      app_name:                record.app_name,
      // normalized_window_title: uses sanitized window_title from active_window.
      // A normalization layer (deduplication of micro-title-changes) is a future
      // concern; for now the sanitized title IS the normalized title.
      normalized_window_title: record.window_title,
      start_monotonic_ms:      startMs,
      end_monotonic_ms:        endMonotonicMs,
      dwell_time_ms:           dwellMs,
    };

    if (typeof appendEventRecord === 'function') {
      try {
        appendEventRecord(dwellRecord);
      } catch (err) {
        console.error('[dwellEngine] appendEventRecord error:', err.message);
      }
    }

    return dwellRecord;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { DwellEngine, DEFAULT_HEARTBEAT_INTERVAL_MS };
