'use strict';

/**
 * src/features/featureBuilder.js
 *
 * 30-second feature window builder — M-06-FEATURES.
 *
 * Reads window_dwell and input_summary from SQLite and writes one row per
 * 30-second bucket into features_30s. Running twice produces the same result
 * (idempotent via INSERT OR REPLACE).
 *
 * Algorithm:
 *   1. Determine the time range to process from window_dwell data.
 *   2. Load all relevant dwell + input rows in bulk.
 *   3. Walk each 30 s window in the range.
 *      a. For each overlapping dwell: distribute dwell_time_ms proportionally
 *         to the overlap length and accumulate into the matching category bucket.
 *      b. For each input_summary whose timestamp_ms falls in the window:
 *         aggregate key/click/scroll/mouse/idle totals.
 *   4. Compute derived features (rates, ratios, flags).
 *   5. Upsert the row.
 *
 * Window anchor: UTC epoch ms floored to the nearest 30 000 ms boundary.
 * Local-time string: UTC ms + timezone_offset minutes, formatted as ISO-like
 *   "YYYY-MM-DDTHH:mm:ss.sss" (no trailing Z) for simple lexicographic range
 *   queries in the reports layer.
 */

const { getDb } = require('../storage/sqlite/db');
const { upsertFeature } = require('../storage/sqlite/repository');
const { categorize } = require('./categoryMap');

const WINDOW_MS  = 30_000;
const WINDOW_SEC = 30;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) features_30s rows for all 30 s windows that have data.
 *
 * @param {{
 *   startMs?: number,  - override range start (epoch ms)
 *   endMs?:   number,  - override range end   (epoch ms)
 * }} [options]
 * @returns {number} Number of feature windows written.
 */
function buildFeatures({ startMs, endMs } = {}) {
  const db = getDb();

  // ── 1. Determine time range ─────────────────────────────────────────────────
  if (!startMs || !endMs) {
    const range = db.prepare(`
      SELECT
        MIN(timestamp_ms - dwell_time_ms) AS min_ts,
        MAX(timestamp_ms)                 AS max_ts
      FROM window_dwell
      WHERE dwell_time_ms > 0
    `).get();

    if (!range || range.min_ts == null) {
      console.log('[featureBuilder] No window_dwell data — nothing to build.');
      return 0;
    }

    startMs = startMs ?? Math.floor(range.min_ts / WINDOW_MS) * WINDOW_MS;
    endMs   = endMs   ?? (Math.floor(range.max_ts / WINDOW_MS) * WINDOW_MS + WINDOW_MS);
  }

  // ── 2. Bulk load data in range ──────────────────────────────────────────────
  const allDwells = db.prepare(`
    SELECT * FROM window_dwell
    WHERE (timestamp_ms - dwell_time_ms) < ? AND timestamp_ms > ?
    ORDER BY timestamp_ms
  `).all(endMs, startMs);

  const allInputs = db.prepare(`
    SELECT * FROM input_summary
    WHERE timestamp_ms >= ? AND timestamp_ms < ?
  `).all(startMs, endMs);

  if (allDwells.length === 0) {
    console.log('[featureBuilder] No overlapping dwell data in range — nothing to build.');
    return 0;
  }

  // ── 3. Walk windows ─────────────────────────────────────────────────────────
  let count = 0;

  for (let ws = startMs; ws < endMs; ws += WINDOW_MS) {
    const we = ws + WINDOW_MS;

    // Filter dwells whose segment [ts - dwell_ms, ts) overlaps [ws, we)
    const dwells = allDwells.filter(d => {
      const ds = d.timestamp_ms - d.dwell_time_ms;
      return ds < we && d.timestamp_ms > ws;
    });

    if (dwells.length === 0) continue; // sparse gap — skip this window

    // Filter inputs with timestamp_ms in [ws, we)
    const inputs = allInputs.filter(i => i.timestamp_ms >= ws && i.timestamp_ms < we);

    const row = _computeWindow(ws, we, dwells, inputs);
    upsertFeature(row);
    count++;
  }

  return count;
}

// ─── Window computation ───────────────────────────────────────────────────────

/**
 * Compute all features for one 30 s window.
 *
 * @param {number}   ws      - Window start ms (inclusive)
 * @param {number}   we      - Window end ms   (exclusive)
 * @param {object[]} dwells  - window_dwell rows overlapping [ws, we)
 * @param {object[]} inputs  - input_summary rows with timestamp_ms in [ws, we)
 * @returns {object} Row ready for upsertFeature()
 */
function _computeWindow(ws, we, dwells, inputs) {
  // ── Category ms (proportional overlap) ──────────────────────────────────────
  const catMs  = { code: 0, docs: 0, video: 0, social: 0, game: 0, other: 0 };
  const appMs  = {};

  for (const d of dwells) {
    const dwellStart = d.timestamp_ms - d.dwell_time_ms;
    const overlapMs  = Math.max(0, Math.min(d.timestamp_ms, we) - Math.max(dwellStart, ws));
    if (overlapMs <= 0) continue;

    const cat = categorize(d.app_name);
    catMs[cat] = (catMs[cat] || 0) + overlapMs;
    appMs[d.app_name] = (appMs[d.app_name] || 0) + overlapMs;
  }

  // Top app and category by dwell ms
  const topApp = _topKey(appMs) || '';
  const topCat = _topKey(catMs) || 'other';

  // ── Input aggregates ─────────────────────────────────────────────────────────
  let keyCount = 0, clickCount = 0, scrollDelta = 0, mouseDist = 0, idleMs = 0;
  for (const i of inputs) {
    keyCount    += i.key_count;
    clickCount  += i.click_count;
    scrollDelta += Math.abs(i.scroll_delta);
    mouseDist   += i.mouse_distance;
    idleMs      += i.idle_ms;
  }

  const idleRatio = Math.min(1, Math.max(0, idleMs / WINDOW_MS));

  // ── Context switches ─────────────────────────────────────────────────────────
  // Each dwell row overlapping the window represents one context present in it.
  const contextSwitchCount = dwells.length;

  // ── Deep work candidate (v1 rule) ────────────────────────────────────────────
  const deepWork =
    (catMs.code + catMs.docs) >= 20_000 &&
    idleRatio <= 0.35 &&
    contextSwitchCount <= 1;

  // ── Timestamps ───────────────────────────────────────────────────────────────
  // Use timezone_offset from the first dwell record in the window.
  const tzOffset = dwells[0]?.timezone_offset ?? 0;
  const windowStartUtc   = new Date(ws).toISOString();
  // Local ISO string without trailing Z: UTC ms + offset ms → fake-UTC ISO then strip Z
  const windowStartLocal = new Date(ws + tzOffset * 60_000).toISOString().replace('Z', '');

  return {
    window_start_utc:         windowStartUtc,
    window_start_local:       windowStartLocal,
    timezone_offset:          tzOffset,
    key_rate:                 keyCount    / WINDOW_SEC,
    click_rate:               clickCount  / WINDOW_SEC,
    scroll_rate:              scrollDelta / WINDOW_SEC,
    mouse_speed:              mouseDist   / WINDOW_SEC,
    idle_ratio:               idleRatio,
    context_switch_count:     contextSwitchCount,
    code_ms:                  catMs.code,
    docs_ms:                  catMs.docs,
    video_ms:                 catMs.video,
    social_ms:                catMs.social,
    game_ms:                  catMs.game,
    other_ms:                 catMs.other,
    top_app_name:             topApp,
    top_category:             topCat,
    deep_work_candidate_flag: deepWork ? 1 : 0,
  };
}

/**
 * Return the key with the highest numeric value from an object.
 * Returns undefined when the object is empty.
 *
 * @param {Record<string, number>} obj
 * @returns {string|undefined}
 */
function _topKey(obj) {
  let best = undefined;
  let bestVal = -1;
  for (const [k, v] of Object.entries(obj)) {
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { buildFeatures };
