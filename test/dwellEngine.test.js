'use strict';

/**
 * test/dwellEngine.test.js
 *
 * Unit tests for capture/dwellEngine.js — M-04-DWELL.
 *
 * Coverage:
 *   - Constructor validation
 *   - onActiveWindow: first window (no dwell), second window (dwell emitted)
 *   - dwell_time_ms correctness and non-negativity
 *   - window_dwell event schema completeness
 *   - No duplicate dwell for same window
 *   - appendEventRecord error isolation
 *   - flushFinal: emits dwell, clears state, no-op when empty
 *   - Heartbeat: periodic emission and segment reset
 *   - Integration: heartbeat stops on window change and flushFinal
 *   - seq monotonically increases across events
 */

const { DwellEngine, DEFAULT_HEARTBEAT_INTERVAL_MS } = require('../capture/dwellEngine');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal active_window event record for testing. */
function makeRecord(overrides = {}) {
  return {
    event_id:    overrides.event_id    ?? 'aw-' + Math.random().toString(36).slice(2),
    app_name:    overrides.app_name    ?? 'TestApp',
    window_title: overrides.window_title ?? 'Test Window',
    monotonic_ms: overrides.monotonic_ms ?? 0,
  };
}

/** Create a DwellEngine with a simple auto-incrementing seq counter. */
function makeEngine(overrides = {}) {
  let seq = 0;
  return new DwellEngine({
    sessionId:            'test-session-dwell',
    getSeq:               () => seq++,
    heartbeatIntervalMs:  overrides.heartbeatIntervalMs,
    ...overrides,
  });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  jest.useRealTimers();
});

// ─── Constructor ─────────────────────────────────────────────────────────────

describe('DwellEngine constructor', () => {
  test('throws when sessionId is missing', () => {
    expect(() => new DwellEngine({ sessionId: '', getSeq: () => 0 })).toThrow(/sessionId/);
    expect(() => new DwellEngine({ getSeq: () => 0 })).toThrow(/sessionId/);
  });

  test('throws when getSeq is not a function', () => {
    expect(() => new DwellEngine({ sessionId: 'sid', getSeq: 42 })).toThrow(/getSeq/);
    expect(() => new DwellEngine({ sessionId: 'sid' })).toThrow(/getSeq/);
  });

  test('accepts a valid configuration', () => {
    expect(() => makeEngine()).not.toThrow();
  });

  test('DEFAULT_HEARTBEAT_INTERVAL_MS is a reasonable positive number', () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});

// ─── onActiveWindow — basic flow ─────────────────────────────────────────────

describe('onActiveWindow', () => {
  test('does NOT emit window_dwell when the first window opens', () => {
    const engine = makeEngine();
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 1000 }), appendFn);

    expect(appendFn).not.toHaveBeenCalled();
  });

  test('emits exactly one window_dwell when the second window opens', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-1', monotonic_ms: 1000 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-2', monotonic_ms: 4000 }), appendFn);

    expect(appendFn).toHaveBeenCalledTimes(1);
    expect(appendFn.mock.calls[0][0].type).toBe('window_dwell');
  });

  test('dwell_time_ms equals the monotonic delta between consecutive windows', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-1', monotonic_ms: 1000 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-2', monotonic_ms: 4500 }), appendFn);

    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.dwell_time_ms).toBe(3500); // 4500 - 1000
  });

  test('start_monotonic_ms and end_monotonic_ms are correct', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-1', monotonic_ms: 500 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-2', monotonic_ms: 2500 }), appendFn);

    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.start_monotonic_ms).toBe(500);
    expect(dwell.end_monotonic_ms).toBe(2500);
  });

  test('window_event_id references the PREVIOUS active_window event_id', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-first', monotonic_ms: 100 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-second', monotonic_ms: 200 }), appendFn);

    expect(appendFn.mock.calls[0][0].window_event_id).toBe('aw-first');
  });

  test('app_name and normalized_window_title come from the PREVIOUS record', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(
      makeRecord({ event_id: 'aw-1', app_name: 'Chrome', window_title: 'GitHub', monotonic_ms: 0 }),
      appendFn
    );
    engine.onActiveWindow(
      makeRecord({ event_id: 'aw-2', app_name: 'Slack', window_title: 'General', monotonic_ms: 1000 }),
      appendFn
    );

    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.app_name).toBe('Chrome');
    expect(dwell.normalized_window_title).toBe('GitHub');
  });

  test('emits separate dwell records for each window transition', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-1', monotonic_ms: 0 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-2', monotonic_ms: 1000 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-3', monotonic_ms: 3000 }), appendFn);

    expect(appendFn).toHaveBeenCalledTimes(2);
    expect(appendFn.mock.calls[0][0].window_event_id).toBe('aw-1');
    expect(appendFn.mock.calls[0][0].dwell_time_ms).toBe(1000);
    expect(appendFn.mock.calls[1][0].window_event_id).toBe('aw-2');
    expect(appendFn.mock.calls[1][0].dwell_time_ms).toBe(2000);
  });

  test('dwell_time_ms is 0, not negative, when monotonic_ms regresses', () => {
    // Defensive: monotonic clocks should not regress, but guard anyway
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 5000 }), appendFn);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 3000 }), appendFn); // earlier!

    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.dwell_time_ms).toBe(0);
  });

  test('does NOT emit when appendEventRecord is null (tracking only)', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }),    null);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 2000 }), null);
    // No crash, no output — state tracking still works
    expect(() =>
      engine.onActiveWindow(makeRecord({ monotonic_ms: 5000 }), null)
    ).not.toThrow();
  });

  test('does not throw when appendEventRecord throws', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const throwingFn = jest.fn(() => { throw new Error('disk full'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }),    throwingFn);
    expect(() =>
      engine.onActiveWindow(makeRecord({ monotonic_ms: 1000 }), throwingFn)
    ).not.toThrow();

    spy.mockRestore();
  });
});

// ─── window_dwell schema ─────────────────────────────────────────────────────

describe('window_dwell event schema', () => {
  function getOneDwellRecord() {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();
    engine.onActiveWindow(makeRecord({ event_id: 'aw-src', app_name: 'VS Code', window_title: 'main.ts', monotonic_ms: 100 }), appendFn);
    engine.onActiveWindow(makeRecord({ event_id: 'aw-next', monotonic_ms: 5100 }), appendFn);
    return appendFn.mock.calls[0][0];
  }

  test('type is "window_dwell"', () => {
    expect(getOneDwellRecord().type).toBe('window_dwell');
  });

  test('schema_version is a non-empty string', () => {
    const r = getOneDwellRecord();
    expect(typeof r.schema_version).toBe('string');
    expect(r.schema_version).not.toBe('');
  });

  test('event_id is a valid UUID v4', () => {
    const r = getOneDwellRecord();
    expect(r.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('each call produces a unique event_id', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();
    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }),    appendFn);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 1000 }), appendFn);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 2000 }), appendFn);

    const ids = appendFn.mock.calls.map(c => c[0].event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('session_id matches the one provided to the constructor', () => {
    const r = getOneDwellRecord();
    expect(r.session_id).toBe('test-session-dwell');
  });

  test('seq is a non-negative integer', () => {
    const r = getOneDwellRecord();
    expect(typeof r.seq).toBe('number');
    expect(Number.isInteger(r.seq)).toBe(true);
    expect(r.seq).toBeGreaterThanOrEqual(0);
  });

  test('created_at is a valid ISO-8601 UTC string', () => {
    const r = getOneDwellRecord();
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(isNaN(Date.parse(r.created_at))).toBe(false);
  });

  test('timezone_offset is an integer', () => {
    const r = getOneDwellRecord();
    expect(typeof r.timezone_offset).toBe('number');
    expect(Number.isInteger(r.timezone_offset)).toBe(true);
  });

  test('timestamp is a positive number (wall-clock epoch ms)', () => {
    const r = getOneDwellRecord();
    expect(typeof r.timestamp).toBe('number');
    expect(r.timestamp).toBeGreaterThan(0);
  });

  test('all required spec fields are present', () => {
    const r = getOneDwellRecord();
    const required = [
      'type', 'event_id', 'session_id', 'window_event_id',
      'app_name', 'normalized_window_title',
      'start_monotonic_ms', 'end_monotonic_ms', 'dwell_time_ms',
      'created_at', 'timezone_offset',
    ];
    for (const field of required) {
      expect(r).toHaveProperty(field);
    }
  });

  test('record is JSON-serializable (no bigint or circular refs)', () => {
    const r = getOneDwellRecord();
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  test('seq increments across consecutive dwell events', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }),    appendFn);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 1000 }), appendFn);
    engine.onActiveWindow(makeRecord({ monotonic_ms: 2000 }), appendFn);

    const [r1, r2] = appendFn.mock.calls.map(c => c[0]);
    expect(r2.seq).toBe(r1.seq + 1);
  });
});

// ─── flushFinal ──────────────────────────────────────────────────────────────

describe('flushFinal', () => {
  test('is a no-op when no window has been opened', () => {
    const engine = makeEngine();
    const appendFn = jest.fn();
    expect(() => engine.flushFinal(appendFn)).not.toThrow();
    expect(appendFn).not.toHaveBeenCalled();
  });

  test('emits the final window_dwell for the currently open window', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-last', monotonic_ms: 0 }), appendFn);
    engine.flushFinal(appendFn);

    expect(appendFn).toHaveBeenCalledTimes(1);
    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.type).toBe('window_dwell');
    expect(dwell.window_event_id).toBe('aw-last');
    expect(dwell.dwell_time_ms).toBeGreaterThanOrEqual(0);
  });

  test('dwell_time_ms from flushFinal is non-negative', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);
    engine.flushFinal(appendFn);

    expect(appendFn.mock.calls[0][0].dwell_time_ms).toBeGreaterThanOrEqual(0);
  });

  test('clears state — second flushFinal is a no-op', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);
    engine.flushFinal(appendFn);
    engine.flushFinal(appendFn); // second call — no window open

    expect(appendFn).toHaveBeenCalledTimes(1);
  });

  test('after flushFinal, onActiveWindow opens a fresh first window (no dwell)', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }),    appendFn);
    engine.flushFinal(appendFn);          // closes window, 1 dwell
    appendFn.mockClear();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 5000 }), appendFn); // fresh start
    expect(appendFn).not.toHaveBeenCalled(); // no dwell for a first window
  });

  test('is safe to call with null appendEventRecord', () => {
    const engine = makeEngine({ heartbeatIntervalMs: 999_999 });
    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), null);
    expect(() => engine.flushFinal(null)).not.toThrow();
  });
});

// ─── Heartbeat ───────────────────────────────────────────────────────────────

describe('heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  test('emits a window_dwell after heartbeatIntervalMs elapses', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 1000 });
    const appendFn = jest.fn();

    // With fake timers: monotonic_ms starts at 0
    engine.onActiveWindow(makeRecord({ event_id: 'aw-hb', monotonic_ms: 0 }), appendFn);
    expect(appendFn).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);

    expect(appendFn).toHaveBeenCalledTimes(1);
    const dwell = appendFn.mock.calls[0][0];
    expect(dwell.type).toBe('window_dwell');
    expect(dwell.window_event_id).toBe('aw-hb');
    expect(dwell.dwell_time_ms).toBeGreaterThanOrEqual(0);
  });

  test('heartbeat sets end_monotonic_ms from process clock at fire time', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 1000 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);
    await jest.advanceTimersByTimeAsync(1000);

    const dwell = appendFn.mock.calls[0][0];
    // With modern Jest fake timers, advancing 1000 ms also advances hrtime by 1000 ms
    expect(dwell.start_monotonic_ms).toBe(0);
    expect(dwell.end_monotonic_ms).toBe(1000);
    expect(dwell.dwell_time_ms).toBe(1000);
  });

  test('heartbeat resets segment baseline — second heartbeat measures from previous beat', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 1000 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);

    await jest.advanceTimersByTimeAsync(1000); // first heartbeat at t=1000
    await jest.advanceTimersByTimeAsync(1000); // second heartbeat at t=2000

    expect(appendFn).toHaveBeenCalledTimes(2);

    const d1 = appendFn.mock.calls[0][0];
    const d2 = appendFn.mock.calls[1][0];

    expect(d1.start_monotonic_ms).toBe(0);
    expect(d1.end_monotonic_ms).toBe(1000);
    expect(d1.dwell_time_ms).toBe(1000);

    expect(d2.start_monotonic_ms).toBe(1000); // reset from previous beat
    expect(d2.end_monotonic_ms).toBe(2000);
    expect(d2.dwell_time_ms).toBe(1000);
  });

  test('heartbeat fires multiple times for a long-lived window', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 500 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);
    await jest.advanceTimersByTimeAsync(2000); // 4 heartbeats

    expect(appendFn).toHaveBeenCalledTimes(4);
  });

  test('heartbeat stops when a new window is detected', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 500 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ event_id: 'aw-1', monotonic_ms: 0 }), appendFn);
    await jest.advanceTimersByTimeAsync(500); // 1 heartbeat fires → 1 dwell

    // Window changes — heartbeat must be stopped and restarted for new window
    engine.onActiveWindow(makeRecord({ event_id: 'aw-2', monotonic_ms: 500 }), appendFn);
    // At this point: 1 heartbeat dwell (aw-1 segment) + 1 window-change dwell (aw-1 closed)
    // = 2 dwell records for aw-1. Then new heartbeat for aw-2 starts.
    appendFn.mockClear();

    await jest.advanceTimersByTimeAsync(500); // 1 heartbeat for aw-2
    // Only the new heartbeat should fire — old timer must be gone
    expect(appendFn).toHaveBeenCalledTimes(1);
    expect(appendFn.mock.calls[0][0].window_event_id).toBe('aw-2');
  });

  test('heartbeat stops after flushFinal', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 500 });
    const appendFn = jest.fn();

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), appendFn);
    engine.flushFinal(appendFn);
    appendFn.mockClear();

    // No more heartbeats should fire
    await jest.advanceTimersByTimeAsync(2000);
    expect(appendFn).not.toHaveBeenCalled();
  });

  test('does NOT start heartbeat when appendEventRecord is null', async () => {
    const engine = makeEngine({ heartbeatIntervalMs: 500 });

    engine.onActiveWindow(makeRecord({ monotonic_ms: 0 }), null);

    // If a heartbeat timer ran it would throw (no append fn) — just verify no crash
    await jest.advanceTimersByTimeAsync(2000);
    // No assertion needed — the test passes if no error occurs and no timer ran
  });
});

// ─── Integration with activeWindow.js ────────────────────────────────────────

describe('DwellEngine integration with startActiveWindowWatcher', () => {
  // Mock active-win at the module level
  jest.mock('active-win', () => jest.fn());
  const activeWinMock = require('active-win');
  const { startActiveWindowWatcher, stopActiveWindowWatcher } = require('../capture/activeWindow');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopActiveWindowWatcher();
    jest.useRealTimers();
  });

  function makeRawWindow(appName, title) {
    return {
      title,
      owner: { name: appName, processName: appName, processId: 1 },
      id: 1,
    };
  }

  test('dwellEngine.onActiveWindow is called when a window change is detected', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('Chrome', 'Google'));

    const engine = {
      onActiveWindow: jest.fn(),
      flushFinal: jest.fn(),
    };
    const appendFn = jest.fn();

    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord: appendFn, dwellEngine: engine });
    await jest.advanceTimersByTimeAsync(100);

    expect(engine.onActiveWindow).toHaveBeenCalledTimes(1);
    const [record, fn] = engine.onActiveWindow.mock.calls[0];
    expect(record.type).toBe('active_window');
    expect(fn).toBe(appendFn);
  });

  test('dwellEngine.flushFinal is called when watcher stops', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('Slack', 'General'));

    const appendFn = jest.fn();
    const engine = { onActiveWindow: jest.fn(), flushFinal: jest.fn() };

    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord: appendFn, dwellEngine: engine });
    await jest.advanceTimersByTimeAsync(100);

    stopActiveWindowWatcher();

    expect(engine.flushFinal).toHaveBeenCalledTimes(1);
    expect(engine.flushFinal).toHaveBeenCalledWith(appendFn);
  });

  test('dwellEngine.onActiveWindow is NOT called when window is unchanged', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('Terminal', 'bash'));

    const engine = { onActiveWindow: jest.fn(), flushFinal: jest.fn() };

    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord: jest.fn(), dwellEngine: engine });
    await jest.advanceTimersByTimeAsync(400); // 4 polls, same window

    expect(engine.onActiveWindow).toHaveBeenCalledTimes(1); // first detection only
  });

  test('real DwellEngine emits window_dwell events via appendEventRecord', async () => {
    let seq = 0;
    const engine = new DwellEngine({
      sessionId: 'integration-test',
      getSeq: () => seq++,
      heartbeatIntervalMs: 999_999,
    });

    const appendFn = jest.fn();

    activeWinMock
      .mockResolvedValueOnce(makeRawWindow('App A', 'Window A'))
      .mockResolvedValueOnce(makeRawWindow('App B', 'Window B'));

    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord: appendFn, dwellEngine: engine });

    await jest.advanceTimersByTimeAsync(100); // App A detected
    await jest.advanceTimersByTimeAsync(100); // App B detected → dwell for App A emitted

    const dwellCalls = appendFn.mock.calls.filter(c => c[0].type === 'window_dwell');
    expect(dwellCalls.length).toBe(1);
    const dwell = dwellCalls[0][0];
    expect(dwell.app_name).toBe('App A');
    expect(dwell.dwell_time_ms).toBeGreaterThanOrEqual(0);
  });
});
