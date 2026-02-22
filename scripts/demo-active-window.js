'use strict';

/**
 * scripts/demo-active-window.js
 *
 * Smoke-test for M-03-AW-FIX: demonstrates both active_window and
 * input_summary event types.
 *
 * - Polls active window every 1 s for 30 s
 * - Simulates random input metrics each tick (since no real input capture yet)
 * - InputAggregator flushes input_summary every 5 s and before each window change
 * - All events written to data/demo-events.jsonl
 *
 * Uses the PowerShell-based reader (capture/activeWindowWin.js) to avoid
 * ffi-napi native addon issues on Node 24+.
 *
 * Usage:
 *   node scripts/demo-active-window.js
 */

const fs   = require('fs');
const path = require('path');
const { getActiveWindowSync }            = require('../capture/activeWindowWin');
const { sanitizeWindowTitle, _buildEventRecord } = require('../capture/activeWindow');
const { InputAggregator }                = require('../capture/inputAggregator');

const OUT_DIR  = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'demo-events.jsonl');
const DURATION_MS      = 30_000; // 30 seconds
const POLL_INTERVAL_MS =  1_000;
const FLUSH_INTERVAL_MS =  5_000; // input_summary every 5 s

fs.mkdirSync(OUT_DIR, { recursive: true });
// Fresh file for this run
fs.writeFileSync(OUT_FILE, '', 'utf8');

// ─── Shared session / seq (mirrors what activeWindow.js does internally) ──────
// For this demo we drive everything manually so we can log both event types.
const crypto = require('crypto');
const os = require('os');
const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'host';
const SESSION_ID = `${hostname}-${Date.now()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8)}`;
let seq = 0;

// ─── InputAggregator ─────────────────────────────────────────────────────────
const agg = new InputAggregator({
  sessionId: SESSION_ID,
  getSeq: () => seq++,
});

// ─── Writer helper ────────────────────────────────────────────────────────────
let eventCount = 0;
function writeRecord(record) {
  fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n', 'utf8');
  eventCount++;
  const tag = record.type === 'active_window' ? '[active_window]' : '[input_summary]';
  if (record.type === 'active_window') {
    console.log(`${tag}  seq=${record.seq}  app="${record.app_name}"  title="${record.window_title}"`);
    console.log(`           event_id=${record.event_id}`);
  } else {
    console.log(`${tag} seq=${record.seq}  keys=${record.key_count}  clicks=${record.click_count}  mouse=${record.mouse_distance}  dwell=${record.dwell_time_ms}ms`);
    console.log(`           active_window_id=${record.active_window_id}`);
  }
}

// ─── Periodic input_summary flush ────────────────────────────────────────────
const flushTimer = setInterval(() => {
  const r = agg.flush(writeRecord);
  if (!r) console.log('[input_summary] (skipped — no activity since last flush)');
}, FLUSH_INTERVAL_MS);

// ─── Poll loop ────────────────────────────────────────────────────────────────
console.log(`Writing JSONL to: ${OUT_FILE}`);
console.log(`Running for ${DURATION_MS / 1000}s — switch windows to generate active_window events\n`);

let lastKey = null;

const pollTimer = setInterval(() => {
  // Simulate some input each tick so input_summary events are non-empty
  agg.accumulate({
    key_count:      Math.floor(Math.random() * 5),
    click_count:    Math.random() < 0.1 ? 1 : 0,
    mouse_distance: Math.floor(Math.random() * 30),
    scroll_delta:   Math.random() < 0.2 ? Math.floor(Math.random() * 3) : 0,
  });

  const raw = getActiveWindowSync();
  if (!raw) return;

  const sanitizedTitle = sanitizeWindowTitle(raw.title);
  const appName = (raw.owner && raw.owner.name) ? raw.owner.name : sanitizedTitle || 'Unknown';
  const windowKey = `${appName}|${sanitizedTitle}`;
  if (windowKey === lastKey) return;
  lastKey = windowKey;

  // Flush pending input_summary BEFORE emitting the new active_window
  const summary = agg.flush(writeRecord);
  if (!summary) console.log('[input_summary] (skipped — nothing accumulated before window change)');

  // Emit active_window event using the shared seq counter
  const windowData = {
    timestamp:    Date.now(),
    monotonic_ms: Number(process.hrtime.bigint() / 1_000_000n),
    app_name:     appName,
    window_title: sanitizedTitle,
  };
  // _buildEventRecord uses its own internal seq — use our own builder here so
  // the seq is shared with the aggregator.
  const now = new Date();
  const record = {
    schema_version:  '1.1.0',
    type:            'active_window',
    event_id:        crypto.randomUUID(),
    session_id:      SESSION_ID,
    seq:             seq++,
    created_at:      now.toISOString(),
    timezone_offset: -now.getTimezoneOffset(),
    timestamp:       windowData.timestamp,
    monotonic_ms:    windowData.monotonic_ms,
    app_name:        windowData.app_name,
    window_title:    windowData.window_title,
    trigger_reason:  'WINDOW_CHANGE',
  };
  writeRecord(record);

  // Update aggregator so next input_summary references this window
  agg.setActiveWindow(record.event_id, record.monotonic_ms);
}, POLL_INTERVAL_MS);

// ─── Shutdown ─────────────────────────────────────────────────────────────────
setTimeout(() => {
  clearInterval(pollTimer);
  clearInterval(flushTimer);

  // Final flush
  const final = agg.flush(writeRecord);
  if (!final) console.log('\n[input_summary] (final flush skipped — nothing accumulated)');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done. ${eventCount} event(s) written to ${OUT_FILE}`);

  // Print all events
  console.log('\n--- all events (pretty) ---');
  const lines = fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n').filter(Boolean);
  lines.forEach(l => {
    const r = JSON.parse(l);
    const keys = Object.keys(r).filter(k => !['schema_version','session_id','created_at','timezone_offset','event_id'].includes(k));
    const preview = keys.map(k => `${k}=${JSON.stringify(r[k])}`).join('  ');
    console.log(`  ${preview}`);
  });

  process.exit(0);
}, DURATION_MS);
