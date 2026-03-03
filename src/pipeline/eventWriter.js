'use strict';

/**
 * src/pipeline/eventWriter.js
 *
 * Central event dispatcher — M-05-SQLITE.
 *
 * EventWriter.append(record) is the single function passed as the
 * `appendEventRecord` callback throughout the capture layer.  It:
 *
 *   1. Inserts every event into events_raw (canonical store).
 *   2. Inserts window_dwell events into the derived window_dwell table.
 *   3. Inserts input_summary events into the derived input_summary table.
 *   4. Optionally forwards to a JsonlWriter for dual-write / debug output.
 *
 * Errors in any single step are caught and logged so that one bad record
 * never blocks subsequent writes.
 *
 * Usage:
 *   const { openDb } = require('../storage/sqlite/db');
 *   const { EventWriter } = require('../pipeline/eventWriter');
 *
 *   openDb();
 *   const writer = new EventWriter();
 *   startActiveWindowWatcher({ appendEventRecord: r => writer.append(r) });
 */

const { insertRaw, insertWindowDwell, insertInputSummary } = require('../storage/sqlite/repository');

class EventWriter {
  /**
   * @param {{ jsonlWriter?: object }} [options]
   *   jsonlWriter — optional JsonlWriter (or any object with an append(record)
   *                 method) for dual-write during the JSONL → SQLite transition.
   */
  constructor({ jsonlWriter } = {}) {
    this._jsonlWriter =
      jsonlWriter && typeof jsonlWriter.append === 'function'
        ? jsonlWriter
        : null;

    // Bind so callers can pass writer.append directly as a callback.
    this.append = this.append.bind(this);
  }

  /**
   * Persist one event record.
   *
   * This method is intentionally synchronous (better-sqlite3 is sync).
   * Errors are caught per-step so a derived-table failure never loses the
   * raw event, and vice-versa.
   *
   * @param {object} record - Any EventRecordV1-compatible object.
   */
  append(record) {
    // ── Step 1: raw store (always) ──────────────────────────────────────────
    try {
      insertRaw(record);
    } catch (err) {
      console.error('[eventWriter] insertRaw error:', err.message, 'id:', record?.event_id);
    }

    // ── Step 2: derived tables (type-specific) ──────────────────────────────
    try {
      if (record.type === 'window_dwell') {
        insertWindowDwell(record);
      } else if (record.type === 'input_summary') {
        insertInputSummary(record);
      }
    } catch (err) {
      console.error('[eventWriter] derived insert error:', err.message, 'type:', record?.type);
    }

    // ── Step 3: optional JSONL dual-write ───────────────────────────────────
    if (this._jsonlWriter) {
      try {
        this._jsonlWriter.append(record);
      } catch (err) {
        console.error('[eventWriter] jsonlWriter error:', err.message);
      }
    }
  }
}

module.exports = { EventWriter };
