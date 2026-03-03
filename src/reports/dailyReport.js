'use strict';

/**
 * src/reports/dailyReport.js
 *
 * Daily summary report — M-07-REPORTS.
 *
 * Reads from:
 *   - features_30s  (category totals, deep work windows, context switches)
 *   - window_dwell  (top 5 apps by dwell time)
 *
 * Local-day boundary strategy:
 *   features_30s.window_start_local is stored as a local ISO string
 *   (YYYY-MM-DDTHH:mm:ss.sss, no Z) so day filtering uses simple string
 *   comparisons — no timezone math needed.
 *
 *   For window_dwell top-apps, we need UTC timestamp_ms boundaries.
 *   We derive them from the timezone_offset of the first features row for
 *   the day.  If no features exist yet, we fall back to a ±14 h UTC window
 *   that covers any timezone.
 */

const { getDb } = require('../storage/sqlite/db');
const { getFeaturesInLocalRange, getTopAppsByDwell } = require('../storage/sqlite/repository');

const WINDOW_MS = 30_000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a daily summary report.
 *
 * @param {{
 *   date?: string,       - Local date string "YYYY-MM-DD" (default: today)
 *   limit?: number,      - Top-apps limit (default: 5)
 *   thresholds?: object  - Deep-work rule overrides (see DEEP_WORK_DEFAULTS)
 * }} [options]
 *
 * @returns {{
 *   date:                 string,
 *   category_totals_ms:   object,
 *   deep_work_time_ms:    number,
 *   context_switch_count: number,
 *   top_apps:             Array<{app_name, total_ms}>,
 *   window_count:         number,
 * }}
 */
function dailyReport({ date, limit = 5 } = {}) {
  const targetDate = date || _todayLocal();
  const dayStart   = `${targetDate}T00:00:00`;
  const dayEnd     = `${targetDate}T23:59:59.999`;

  // ── Category totals + deep work from features_30s ───────────────────────────
  const features = getFeaturesInLocalRange(dayStart, dayEnd);

  const totals = { code: 0, docs: 0, video: 0, social: 0, game: 0, other: 0 };
  let deepWorkWindowCount  = 0;
  let contextSwitchTotal   = 0;

  for (const f of features) {
    totals.code   += f.code_ms;
    totals.docs   += f.docs_ms;
    totals.video  += f.video_ms;
    totals.social += f.social_ms;
    totals.game   += f.game_ms;
    totals.other  += f.other_ms;
    if (f.deep_work_candidate_flag) deepWorkWindowCount++;
    contextSwitchTotal += f.context_switch_count;
  }

  // ── Top apps by dwell (UTC range derived from the first feature's tz offset) ─
  const tzOffset   = features[0]?.timezone_offset ?? 0;
  const utcStartMs = _localDayToUtcMs(targetDate, tzOffset);
  const utcEndMs   = utcStartMs + 24 * 3_600_000;

  const topApps = getTopAppsByDwell(utcStartMs, utcEndMs, limit);

  return {
    date:                 targetDate,
    category_totals_ms:   totals,
    deep_work_time_ms:    deepWorkWindowCount * WINDOW_MS,
    context_switch_count: contextSwitchTotal,
    top_apps:             topApps,
    window_count:         features.length,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Today's date as a local "YYYY-MM-DD" string using the sv locale (ISO-like).
 */
function _todayLocal() {
  return new Date().toLocaleDateString('sv');
}

/**
 * Convert a local date string + timezone offset to a UTC epoch ms boundary.
 *
 * local midnight = UTC midnight - tzOffset minutes
 *   (because local = UTC + tzOffset → UTC = local - tzOffset)
 *
 * @param {string} dateStr    - "YYYY-MM-DD"
 * @param {number} tzOffset   - minutes from UTC (positive = east of UTC)
 * @returns {number}           UTC epoch ms of local midnight on dateStr
 */
function _localDayToUtcMs(dateStr, tzOffset) {
  // Parse as UTC midnight then subtract the offset to reach local midnight in UTC.
  return new Date(`${dateStr}T00:00:00Z`).getTime() - tzOffset * 60_000;
}

module.exports = { dailyReport };
