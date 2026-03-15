'use strict';

/**
 * scripts/demo-active-window.js
 *
 * 60-second smoke test: active window capture + NLP semantic labeling.
 * Supports A/B model comparison:
 * - Model A: default embedding model (baseline)
 * - Model B: plan B model (default: google/embeddinggemma-300m)
 *
 * Usage:
 *   node scripts/demo-active-window.js
 *
 * Optional env:
 *   NLP_PLAN_B_ENABLED=0
 *   NLP_PLAN_B_MODEL_ID=google/embeddinggemma-300m
 *   NLP_LOG_INTERVAL_MS=3000
 */

try {
  require('ts-node').register({ transpileOnly: true, esm: false });
} catch (e) {
  console.error('[demo] ts-node not available. Run: npm install');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { getActiveWindowSync } = require('../src/capture/activeWindowWin');
const { sanitizeWindowTitle } = require('../src/capture/activeWindow');
const { InputAggregator } = require('../src/capture/inputAggregator');
const { openDb, closeDb } = require('../src/storage/sqlite/db');

const { GoalManagerImpl } = require('../src/nlp/goalManagerImpl');
const { TitleNormalizerImpl } = require('../src/nlp/titleNormalizerImpl');
const { EmbeddingServiceImpl } = require('../src/nlp/embeddingServiceImpl');
const { ThresholdEngineImpl } = require('../src/nlp/thresholdEngineImpl');
const { SemanticMatchEngineImpl } = require('../src/nlp/semanticMatchEngineImpl');
const { BoostTableImpl } = require('../src/nlp/boostTableImpl');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'demo-events.jsonl');
const DURATION_MS = 120_000;
const POLL_MS = 1_000;
const FLUSH_MS = 5_000;
const NLP_LOG_INTERVAL_MS = Number(process.env.NLP_LOG_INTERVAL_MS || '3000');

const ENABLE_PLAN_B = process.env.NLP_PLAN_B_ENABLED !== '0';
const PLAN_B_MODEL_ID = process.env.NLP_PLAN_B_MODEL_ID || 'google/embeddinggemma-300m';
const EMBED_TITLE_ONLY = process.env.NLP_EMBED_TITLE_ONLY === '1';
const MIN_DWELL_MS = Number(process.env.NLP_MIN_DWELL_MS || '2000');

function printResult(reason, dwellMs, tag, result) {
  const th = result.thresholdsUsed
    ? ` tOn=${result.thresholdsUsed.tOn.toFixed(2)} tOff=${result.thresholdsUsed.tOff.toFixed(2)}`
    : '';
  console.log(
    `[NLP:${reason}:${tag}] dwell=${dwellMs}ms label=${result.label} ` +
      `sim=${result.simScore.toFixed(3)} ` +
      `final=${result.finalScore.toFixed(3)} ` +
      `conf=${result.confidence}${th}`
  );
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, '', 'utf8');
  openDb();

  const goalMgr = new GoalManagerImpl();
  const titleNorm = new TitleNormalizerImpl();
  const threshEng = new ThresholdEngineImpl();

  const boostTable = new BoostTableImpl();
  const embedSvcA = new EmbeddingServiceImpl();
  const matchEngA = new SemanticMatchEngineImpl(goalMgr, titleNorm, embedSvcA, threshEng, boostTable);

  const embedSvcB = ENABLE_PLAN_B ? new EmbeddingServiceImpl({ modelId: PLAN_B_MODEL_ID }) : null;
  const matchEngB = embedSvcB
    ? new SemanticMatchEngineImpl(goalMgr, titleNorm, embedSvcB, threshEng, boostTable)
    : null;

  let nlpReadyA = false;
  let nlpReadyB = false;

  const goal = await goalMgr.getActiveGoal();
  if (!goal) {
    console.log('[NLP] No active goal set. Labels will be "unknown".');
    console.log('      Set one: node src/cli/index.js goal set "your focus goal"\n');
  } else {
    console.log(`[NLP] Active goal: "${goal.text}"`);

    console.log('[NLP] Initializing model A (baseline)...');
    try {
      await embedSvcA.init();
      nlpReadyA = true;
      console.log('[NLP] Model A ready.');
    } catch (e) {
      console.error(`[NLP] Model A init failed: ${e.message}`);
    }

    if (embedSvcB) {
      console.log(`[NLP] Initializing model B (${PLAN_B_MODEL_ID})...`);
      try {
        await embedSvcB.init();
        nlpReadyB = true;
        console.log('[NLP] Model B ready.');
      } catch (e) {
        console.error(`[NLP] Model B init failed: ${e.message}`);
        if (String(e.message || '').toLowerCase().includes('unauthorized')) {
          console.log('[NLP] Tip: this model may require Hugging Face login/token or access approval.');
        }
      }
    }
    console.log('');
  }

  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'host';
  const SESSION_ID = `${hostname}-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let seq = 0;
  let eventCount = 0;
  let lastKey = null;
  let windowStartMonotonicMs = Number(process.hrtime.bigint() / 1_000_000n);
  let currentAppName = null;
  let currentWindowTitle = null;
  let lastNlpLogMonotonicMs = 0;

  const agg = new InputAggregator({ sessionId: SESSION_ID, getSeq: () => seq++ });

  function writeRecord(record) {
    fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n', 'utf8');
    eventCount++;
  }

  function evaluateNlp(reason, appName, windowTitle, nowMonotonic) {
    if (!goal && !nlpReadyA && !nlpReadyB) return;

    const now = new Date();
    const dwellMs = nowMonotonic - windowStartMonotonicMs;
    const semanticInput = {
      appName,
      windowTitle,
      tsUtc: now.toISOString(),
      timezoneOffset: -now.getTimezoneOffset(),
      monotonicMs: nowMonotonic,
      dwellMs,
    };

    const tasks = [];
    if (!goal || nlpReadyA) {
      tasks.push(matchEngA.evaluate(semanticInput).then((result) => ({ tag: 'A', result })));
    }
    if (matchEngB && (!goal || nlpReadyB)) {
      tasks.push(matchEngB.evaluate(semanticInput).then((result) => ({ tag: 'B', result })));
    }

    Promise.all(tasks)
      .then((outputs) => {
        for (const out of outputs) printResult(reason, dwellMs, out.tag, out.result);
        if (outputs.length === 2) {
          const a = outputs.find((x) => x.tag === 'A')?.result;
          const b = outputs.find((x) => x.tag === 'B')?.result;
          if (a && b) {
            const delta = b.finalScore - a.finalScore;
            console.log(
              `[NLP:DIFF] reason=${reason} dwell=${dwellMs}ms delta_final(B-A)=${delta.toFixed(3)} label_same=${a.label === b.label}`
            );
          }
        }
      })
      .catch((e) => {
        console.log(`[NLP] eval error: ${e.message}`);
      });

    lastNlpLogMonotonicMs = nowMonotonic;
  }

  const flushTimer = setInterval(() => {
    const r = agg.flush(writeRecord);
    if (!r) console.log('[input_summary] skipped (no activity)');
  }, FLUSH_MS);

  console.log(`Writing JSONL to: ${OUT_FILE}`);
  console.log(`Running for ${DURATION_MS / 1000}s\n`);
  console.log(`[NLP] mode: ${EMBED_TITLE_ONLY ? 'title-only' : 'app+title'}, min_dwell_ms=${MIN_DWELL_MS}`);
  console.log(`[NLP] log_interval_ms=${NLP_LOG_INTERVAL_MS}`);

  const pollTimer = setInterval(() => {
    agg.accumulate({
      key_count: Math.floor(Math.random() * 5),
      click_count: Math.random() < 0.1 ? 1 : 0,
      mouse_distance: Math.floor(Math.random() * 30),
      scroll_delta: Math.random() < 0.2 ? Math.floor(Math.random() * 3) : 0,
    });

    const raw = getActiveWindowSync();
    if (!raw) return;

    const sanitizedTitle = sanitizeWindowTitle(raw.title);
    const appName = raw.owner && raw.owner.name ? raw.owner.name : sanitizedTitle || 'Unknown';
    const windowKey = `${appName}|${sanitizedTitle}`;
    const nowMonotonic = Number(process.hrtime.bigint() / 1_000_000n);

    if (windowKey !== lastKey) {
      lastKey = windowKey;
      agg.flush(writeRecord);

      const dwellPrevMs = nowMonotonic - windowStartMonotonicMs;
      windowStartMonotonicMs = nowMonotonic;
      currentAppName = appName;
      currentWindowTitle = sanitizedTitle;

      const now = new Date();
      const record = {
        schema_version: '1.1.0',
        type: 'active_window',
        event_id: crypto.randomUUID(),
        session_id: SESSION_ID,
        seq: seq++,
        created_at: now.toISOString(),
        timezone_offset: -now.getTimezoneOffset(),
        timestamp: Date.now(),
        monotonic_ms: nowMonotonic,
        app_name: appName,
        window_title: sanitizedTitle,
        trigger_reason: 'WINDOW_CHANGE',
      };
      writeRecord(record);
      agg.setActiveWindow(record.event_id, record.monotonic_ms);

      console.log(`\n[active_window] seq=${record.seq} app="${appName}"`);
      console.log(`               title="${sanitizedTitle}"`);
      console.log(`               dwell_prev=${dwellPrevMs}ms`);

      if (!goal || nlpReadyA || nlpReadyB) {
        evaluateNlp('change', currentAppName, currentWindowTitle, nowMonotonic);
      }
      return;
    }

    if (
      currentAppName &&
      currentWindowTitle &&
      (!goal || nlpReadyA || nlpReadyB) &&
      nowMonotonic - lastNlpLogMonotonicMs >= NLP_LOG_INTERVAL_MS
    ) {
      evaluateNlp('tick', currentAppName, currentWindowTitle, nowMonotonic);
    }
  }, POLL_MS);

  setTimeout(async () => {
    clearInterval(pollTimer);
    clearInterval(flushTimer);
    agg.flush(writeRecord);

    try {
      await embedSvcA.shutdown();
    } catch (_) {}
    if (embedSvcB) {
      try {
        await embedSvcB.shutdown();
      } catch (_) {}
    }
    closeDb();

    console.log(`\nDone. ${eventCount} event(s) written to ${OUT_FILE}`);
    process.exit(0);
  }, DURATION_MS);
})().catch((e) => {
  console.error('[demo] Fatal:', e.message);
  process.exit(1);
});
