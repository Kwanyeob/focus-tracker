'use strict';

/**
 * src/reports/weeklyReport.js
 *
 * Weekly summary report — M-07-REPORTS.
 *
 * Delegates to dailyReport for each of the 7 days ending on `date`.
 * Aggregates totals and emits trend data (one entry per day).
 */

const { dailyReport } = require('./dailyReport');

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a 7-day weekly summary ending on `date` (inclusive).
 *
 * @param {{
 *   date?: string,  - End date "YYYY-MM-DD" (default: today local)
 * }} [options]
 *
 * @returns {{
 *   period_start:            string,
 *   period_end:              string,
 *   total_deep_work_ms:      number,
 *   total_context_switches:  number,
 *   category_totals_ms:      object,
 *   trend_data:              Array<object>,
 *   days:                    Array<object>,
 * }}
 */
function weeklyReport({ date } = {}) {
  // Build 7 local date strings: [endDate - 6 days, ..., endDate]
  const endDate = date ? new Date(`${date}T12:00:00Z`) : new Date();
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toLocaleDateString('sv');
    days.push(dailyReport({ date: dateStr }));
  }

  // Aggregate totals
  const totals = { code: 0, docs: 0, video: 0, social: 0, game: 0, other: 0 };
  let totalDeepWorkMs       = 0;
  let totalContextSwitches  = 0;

  for (const day of days) {
    for (const cat of Object.keys(totals)) {
      totals[cat] += day.category_totals_ms[cat] || 0;
    }
    totalDeepWorkMs      += day.deep_work_time_ms;
    totalContextSwitches += day.context_switch_count;
  }

  // Trend data: one compact entry per day
  const trendData = days.map(d => ({
    date:             d.date,
    deep_work_ms:     d.deep_work_time_ms,
    code_ms:          d.category_totals_ms.code,
    docs_ms:          d.category_totals_ms.docs,
    video_ms:         d.category_totals_ms.video,
    social_ms:        d.category_totals_ms.social,
    game_ms:          d.category_totals_ms.game,
    other_ms:         d.category_totals_ms.other,
    context_switches: d.context_switch_count,
    window_count:     d.window_count,
  }));

  return {
    period_start:           days[0]?.date,
    period_end:             days[days.length - 1]?.date,
    total_deep_work_ms:     totalDeepWorkMs,
    total_context_switches: totalContextSwitches,
    category_totals_ms:     totals,
    trend_data:             trendData,
    days,
  };
}

module.exports = { weeklyReport };
