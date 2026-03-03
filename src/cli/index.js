#!/usr/bin/env node
'use strict';

/**
 * src/cli/index.js
 *
 * CLI entry point — M-07-REPORTS.
 *
 * Commands:
 *   daily   [--date YYYY-MM-DD] [--json]   Daily summary report
 *   weekly  [--date YYYY-MM-DD] [--json]   7-day weekly summary
 *   build-features [--start YYYY-MM-DD] [--end YYYY-MM-DD]
 *                                          Build / rebuild features_30s
 *
 * Examples:
 *   node src/cli/index.js daily
 *   node src/cli/index.js daily --date 2026-02-24 --json
 *   node src/cli/index.js weekly --date 2026-03-02
 *   node src/cli/index.js build-features
 */

const { openDb, closeDb } = require('../storage/sqlite/db');
const { buildFeatures }   = require('../features/featureBuilder');
const { dailyReport }     = require('../reports/dailyReport');
const { weeklyReport }    = require('../reports/weeklyReport');

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args    = argv.slice(2);
  const command = args[0];
  const flags   = {};

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--json':
        flags.json = true;
        break;
      case '--date':
        if (args[i + 1]) flags.date = args[++i];
        break;
      case '--start':
        if (args[i + 1]) flags.start = args[++i];
        break;
      case '--end':
        if (args[i + 1]) flags.end = args[++i];
        break;
      default:
        break;
    }
  }

  return { command, flags };
}

// ─── Human-readable formatters ────────────────────────────────────────────────

function _fmt(ms) {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000)    / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function _bar(ms, totalMs, width = 20) {
  if (totalMs <= 0) return ' '.repeat(width);
  const filled = Math.round((ms / totalMs) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printDaily(r) {
  const { date, category_totals_ms: ct, deep_work_time_ms, context_switch_count, top_apps } = r;
  const totalMs = Object.values(ct).reduce((a, b) => a + b, 0);

  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║   Daily Report — ${date}    ║`);
  console.log(`╚══════════════════════════════════╝\n`);

  console.log('Category Breakdown:');
  const cats = ['code', 'docs', 'video', 'social', 'game', 'other'];
  for (const cat of cats) {
    const ms  = ct[cat] || 0;
    if (ms === 0) continue;
    const bar = _bar(ms, totalMs);
    console.log(`  ${cat.padEnd(7)} ${bar} ${_fmt(ms).padStart(8)}`);
  }

  console.log(`\n  Total tracked:   ${_fmt(totalMs)}`);
  console.log(`  Deep work:       ${_fmt(deep_work_time_ms)}`);
  console.log(`  Context switches: ${context_switch_count}`);

  if (top_apps.length > 0) {
    console.log('\nTop Apps:');
    for (const { app_name, total_ms } of top_apps) {
      console.log(`  ${app_name.slice(0, 32).padEnd(33)} ${_fmt(total_ms)}`);
    }
  }

  console.log('');
}

function printWeekly(r) {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Weekly Report — ${r.period_start} to ${r.period_end}  ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  console.log(`  Total deep work:      ${_fmt(r.total_deep_work_ms)}`);
  console.log(`  Total ctx switches:   ${r.total_context_switches}`);

  const ct = r.category_totals_ms;
  console.log(`\n  code:   ${_fmt(ct.code)}   docs: ${_fmt(ct.docs)}   video: ${_fmt(ct.video)}`);
  console.log(`  social: ${_fmt(ct.social)}   game: ${_fmt(ct.game)}   other: ${_fmt(ct.other)}`);

  console.log('\nDaily Trend:');
  console.log('  Date        Deep Work  Code       Ctx±');
  console.log('  ──────────  ─────────  ─────────  ────');
  for (const d of r.trend_data) {
    console.log(
      `  ${d.date}  ` +
      `${_fmt(d.deep_work_ms).padEnd(9)}  ` +
      `${_fmt(d.code_ms).padEnd(9)}  ` +
      `${String(d.context_switches).padStart(4)}`
    );
  }
  console.log('');
}

// ─── Command handlers ─────────────────────────────────────────────────────────

function cmdDaily(flags) {
  const report = dailyReport({ date: flags.date });
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDaily(report);
  }
}

function cmdWeekly(flags) {
  const report = weeklyReport({ date: flags.date });
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printWeekly(report);
  }
}

function cmdBuildFeatures(flags) {
  let options = {};
  if (flags.start) {
    options.startMs = new Date(`${flags.start}T00:00:00Z`).getTime();
  }
  if (flags.end) {
    options.endMs = new Date(`${flags.end}T00:00:00Z`).getTime() + 24 * 3_600_000;
  }
  const count = buildFeatures(options);
  console.log(`[featureBuilder] Wrote ${count} feature windows.`);
}

function printUsage() {
  console.log(`
Usage:
  node src/cli/index.js <command> [options]

Commands:
  daily          Show today's focus summary
  weekly         Show the past 7 days summary
  build-features Generate / refresh features_30s from raw events

Options:
  --date  YYYY-MM-DD   Target date (daily) or week end date (weekly)
  --start YYYY-MM-DD   Start date for build-features
  --end   YYYY-MM-DD   End date   for build-features
  --json               Output raw JSON instead of human-readable text
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { command, flags } = parseArgs(process.argv);

  openDb();

  try {
    switch (command) {
      case 'daily':          cmdDaily(flags);         break;
      case 'weekly':         cmdWeekly(flags);        break;
      case 'build-features': cmdBuildFeatures(flags); break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } finally {
    closeDb();
  }
}

main();
