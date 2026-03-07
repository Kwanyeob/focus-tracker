'use strict';

/**
 * capture/inputAggregator.js
 *
 * Input Metric Aggregation — M-03-AW-FIX.
 *
 * Accumulates input metrics (key_count, click_count, mouse_distance,
 * scroll_delta, idle_ms) and emits `input_summary` events either:
 *   - Periodically (default every 10 seconds, within the 5–30 s spec range)
 *   - Immediately before a window change (flush() called by activeWindow.js)
 *
 * Designed to share session_id and seq counter with activeWindow.js via
 * constructor parameters — no circular dependency.
 *
 * Runtime: Node.js (CommonJS)
 */

const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = '1.1.0';
const DEFAULT_FLUSH_INTERVAL_MS = 10_000; // 10 s (within spec's 5–30 s range)

// ─── InputAggregator ─────────────────────────────────────────────────────────

class InputAggregator {
  /**
   * @param {{
   *   sessionId: string,
   *   getSeq: () => number
   * }} options
   *   sessionId   — shared with the activeWindow module (same session context)
   *   getSeq      — callback that returns the next seq number and advances the
   *                 counter; shared with activeWindow so events interleave
   *                 correctly in the JSONL stream
   */
  constructor({ sessionId, getSeq }) {
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('[InputAggregator] sessionId must be a non-empty string');
    }
    if (typeof getSeq !== 'function') {
      throw new Error('[InputAggregator] getSeq must be a function');
    }

    this._sessionId = sessionId;
    this._getSeq = getSeq;

    /** event_id of the most recent active_window record. */
    this._activeWindowId = null;

    /** monotonic_ms captured when the active window last changed. */
    this._windowStartMonotonic = null;

    /** Periodic flush timer handle, or null when stopped. */
    this._timer = null;

    this._reset();
  }

  // ─── Active window reference ──────────────────────────────────────────────

  /**
   * Called by activeWindow.js immediately after emitting a new active_window
   * event. Updates the reference window_id so subsequent input_summary records
   * point to the correct window, and resets the dwell-time baseline.
   *
   * @param {string} eventId      - event_id of the new active_window record
   * @param {number} monotonicMs  - monotonic_ms of the new active_window record
   */
  setActiveWindow(eventId, monotonicMs) {
    this._activeWindowId = eventId;
    this._windowStartMonotonic = monotonicMs;
  }

  // ─── Metric accumulation ──────────────────────────────────────────────────

  /**
   * Accumulate input metric deltas into the running totals.
   * Values are additive; unspecified or falsy fields are ignored.
   *
   * @param {{
   *   key_count?: number,
   *   click_count?: number,
   *   mouse_distance?: number,
   *   scroll_delta?: number,
   *   idle_ms?: number
   * }} delta
   */
  accumulate(delta) {
    if (delta.key_count)      this._metrics.key_count      += delta.key_count;
    if (delta.click_count)    this._metrics.click_count    += delta.click_count;
    if (delta.mouse_distance) this._metrics.mouse_distance += delta.mouse_distance;
    if (delta.scroll_delta)   this._metrics.scroll_delta   += delta.scroll_delta;
    if (delta.idle_ms)        this._metrics.idle_ms        += delta.idle_ms;
  }

  /**
   * Returns true when at least one metric is non-zero.
   * Used to avoid emitting meaningless zero-value records.
   *
   * @returns {boolean}
   */
  isDirty() {
    const m = this._metrics;
    return m.key_count > 0 || m.click_count > 0 ||
           m.mouse_distance > 0 || m.scroll_delta > 0 || m.idle_ms > 0;
  }

  // ─── Flush ────────────────────────────────────────────────────────────────

  /**
   * Build and emit an `input_summary` event.
   *
   * Rules:
   *   - Returns null (no-op) when isDirty() is false or no active window is set
   *   - dwell_time_ms is computed from monotonic_ms delta (not wall-clock)
   *   - Resets accumulated metrics after a successful build
   *   - Calls appendEventRecord(record) if the function is provided
   *   - Errors from appendEventRecord are caught and logged; they do NOT reset
   *     metrics (so the data is preserved for the next flush attempt)
   *
   * @param {function|null} appendEventRecord
   * @returns {object|null} The emitted record, or null if skipped
   */
  flush(appendEventRecord) {
    if (!this.isDirty() || this._activeWindowId === null) {
      return null;
    }

    const now = new Date();
    const monotonicNow = Number(process.hrtime.bigint() / 1_000_000n);
    const dwellMs = this._windowStartMonotonic !== null
      ? monotonicNow - this._windowStartMonotonic
      : 0;

    const record = {
      schema_version:   SCHEMA_VERSION,
      type:             'input_summary',
      event_id:         crypto.randomUUID(),
      session_id:       this._sessionId,
      seq:              this._getSeq(),
      created_at:       now.toISOString(),
      timezone_offset:  -now.getTimezoneOffset(),
      timestamp:        Date.now(),
      monotonic_ms:     monotonicNow,
      active_window_id: this._activeWindowId,
      key_count:        this._metrics.key_count,
      click_count:      this._metrics.click_count,
      mouse_distance:   this._metrics.mouse_distance,
      scroll_delta:     this._metrics.scroll_delta,
      idle_ms:          this._metrics.idle_ms,
      dwell_time_ms:    dwellMs,
    };

    // Reset BEFORE calling appendEventRecord so metrics are not double-counted
    // even if the writer call throws.
    this._reset();

    if (typeof appendEventRecord === 'function') {
      try {
        appendEventRecord(record);
      } catch (err) {
        console.error('[inputAggregator] appendEventRecord error:', err.message);
      }
    }

    return record;
  }

  // ─── Periodic flush ───────────────────────────────────────────────────────

  /**
   * Start a periodic flush timer.
   * If a timer is already running it is replaced.
   *
   * @param {function|null} appendEventRecord
   * @param {number} [intervalMs=DEFAULT_FLUSH_INTERVAL_MS]
   */
  startPeriodicFlush(appendEventRecord, intervalMs = DEFAULT_FLUSH_INTERVAL_MS) {
    this.stopPeriodicFlush();
    this._timer = setInterval(() => {
      this.flush(appendEventRecord);
    }, intervalMs);
  }

  /**
   * Stop the periodic flush timer. Safe to call when not running.
   */
  stopPeriodicFlush() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _reset() {
    this._metrics = {
      key_count:      0,
      click_count:    0,
      mouse_distance: 0,
      scroll_delta:   0,
      idle_ms:        0,
    };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { InputAggregator, DEFAULT_FLUSH_INTERVAL_MS };
