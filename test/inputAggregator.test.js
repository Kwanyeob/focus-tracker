'use strict';

/**
 * test/inputAggregator.test.js
 *
 * Unit tests for capture/inputAggregator.js — M-03-AW-FIX.
 *
 * Coverage:
 *   - Constructor validation
 *   - isDirty: false initially, true after accumulate, false after flush
 *   - accumulate: individual and combined metric deltas
 *   - flush: no-op when clean, no-op without active window, record shape,
 *            metrics reset, appendEventRecord callback, error isolation
 *   - setActiveWindow: correct active_window_id in flushed record
 *   - dwell_time_ms: non-negative number derived from monotonic_ms
 *   - startPeriodicFlush / stopPeriodicFlush: timer behaviour
 *   - seq: monotonically increases across flushes
 */

const { InputAggregator, DEFAULT_FLUSH_INTERVAL_MS } = require('../capture/inputAggregator');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgg(overrides = {}) {
  let seq = 0;
  return new InputAggregator({
    sessionId: 'test-session-001',
    getSeq: () => seq++,
    ...overrides,
  });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('InputAggregator constructor', () => {
  test('throws when sessionId is missing', () => {
    expect(() => new InputAggregator({ sessionId: '', getSeq: () => 0 })).toThrow();
    expect(() => new InputAggregator({ getSeq: () => 0 })).toThrow();
  });

  test('throws when getSeq is not a function', () => {
    expect(() => new InputAggregator({ sessionId: 'sid', getSeq: 42 })).toThrow();
    expect(() => new InputAggregator({ sessionId: 'sid' })).toThrow();
  });

  test('initializes with clean metrics (isDirty = false)', () => {
    const agg = makeAgg();
    expect(agg.isDirty()).toBe(false);
  });
});

// ─── isDirty ─────────────────────────────────────────────────────────────────

describe('isDirty', () => {
  test('returns false when all metrics are zero', () => {
    expect(makeAgg().isDirty()).toBe(false);
  });

  test('returns true after key_count accumulation', () => {
    const agg = makeAgg();
    agg.accumulate({ key_count: 1 });
    expect(agg.isDirty()).toBe(true);
  });

  test('returns true after click_count accumulation', () => {
    const agg = makeAgg();
    agg.accumulate({ click_count: 2 });
    expect(agg.isDirty()).toBe(true);
  });

  test('returns true after mouse_distance accumulation', () => {
    const agg = makeAgg();
    agg.accumulate({ mouse_distance: 50 });
    expect(agg.isDirty()).toBe(true);
  });

  test('returns true after scroll_delta accumulation', () => {
    const agg = makeAgg();
    agg.accumulate({ scroll_delta: 3 });
    expect(agg.isDirty()).toBe(true);
  });

  test('returns true after idle_ms accumulation', () => {
    const agg = makeAgg();
    agg.accumulate({ idle_ms: 500 });
    expect(agg.isDirty()).toBe(true);
  });

  test('returns false after flush clears metrics', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 5 });
    agg.flush(null);
    expect(agg.isDirty()).toBe(false);
  });
});

// ─── accumulate ──────────────────────────────────────────────────────────────

describe('accumulate', () => {
  test('sums multiple calls on the same metric', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 10 });
    agg.accumulate({ key_count: 5 });
    const record = agg.flush(null);
    expect(record.key_count).toBe(15);
  });

  test('accumulates all metrics independently', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({
      key_count: 3,
      click_count: 2,
      mouse_distance: 100,
      scroll_delta: 4,
      idle_ms: 200,
    });
    const record = agg.flush(null);
    expect(record.key_count).toBe(3);
    expect(record.click_count).toBe(2);
    expect(record.mouse_distance).toBe(100);
    expect(record.scroll_delta).toBe(4);
    expect(record.idle_ms).toBe(200);
  });

  test('ignores zero and absent fields', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 5 });
    agg.accumulate({ click_count: 0 });
    agg.accumulate({});
    const record = agg.flush(null);
    expect(record.key_count).toBe(5);
    expect(record.click_count).toBe(0);
  });
});

// ─── flush ────────────────────────────────────────────────────────────────────

describe('flush', () => {
  test('returns null when not dirty', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    expect(agg.flush(null)).toBeNull();
  });

  test('returns null when dirty but no active window set', () => {
    const agg = makeAgg();
    agg.accumulate({ key_count: 5 });
    expect(agg.flush(null)).toBeNull();
  });

  test('returns an input_summary record when dirty and active window set', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-xyz', 0);
    agg.accumulate({ key_count: 7 });
    const record = agg.flush(null);
    expect(record).not.toBeNull();
    expect(record.type).toBe('input_summary');
  });

  test('record contains all required fields', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-xyz', 0);
    agg.accumulate({ key_count: 1, click_count: 2, mouse_distance: 50, scroll_delta: 1, idle_ms: 100 });
    const record = agg.flush(null);

    expect(record.schema_version).toBe('1.1.0');
    expect(record.type).toBe('input_summary');
    expect(typeof record.event_id).toBe('string');
    expect(record.event_id.trim()).not.toBe('');
    expect(record.session_id).toBe('test-session-001');
    expect(typeof record.seq).toBe('number');
    expect(typeof record.created_at).toBe('string');
    expect(isNaN(Date.parse(record.created_at))).toBe(false);
    expect(typeof record.timezone_offset).toBe('number');
    expect(Number.isInteger(record.timezone_offset)).toBe(true);
    expect(typeof record.timestamp).toBe('number');
    expect(typeof record.monotonic_ms).toBe('number');
    expect(record.monotonic_ms).toBeGreaterThanOrEqual(0);
    expect(record.active_window_id).toBe('aw-xyz');
    expect(record.key_count).toBe(1);
    expect(record.click_count).toBe(2);
    expect(record.mouse_distance).toBe(50);
    expect(record.scroll_delta).toBe(1);
    expect(record.idle_ms).toBe(100);
    expect(typeof record.dwell_time_ms).toBe('number');
    expect(record.dwell_time_ms).toBeGreaterThanOrEqual(0);
  });

  test('event_id is a valid UUID v4 format', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 1 });
    const record = agg.flush(null);
    expect(record.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('record is JSON-serializable', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 1 });
    const record = agg.flush(null);
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  test('resets metrics to zero after flush', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 10, click_count: 3 });
    agg.flush(null);
    expect(agg.isDirty()).toBe(false);
    // Second flush should return null (no new activity)
    expect(agg.flush(null)).toBeNull();
  });

  test('calls appendEventRecord with the built record', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 5 });
    const appendFn = jest.fn();
    agg.flush(appendFn);
    expect(appendFn).toHaveBeenCalledTimes(1);
    expect(appendFn.mock.calls[0][0].type).toBe('input_summary');
  });

  test('does not call appendEventRecord when skipping (not dirty)', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    const appendFn = jest.fn();
    agg.flush(appendFn);
    expect(appendFn).not.toHaveBeenCalled();
  });

  test('does not throw when appendEventRecord throws', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 1 });
    const throwingFn = jest.fn(() => { throw new Error('write failure'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => agg.flush(throwingFn)).not.toThrow();
    spy.mockRestore();
  });

  test('seq increments across multiple flushes', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);

    agg.accumulate({ key_count: 1 });
    const r1 = agg.flush(null);

    agg.accumulate({ key_count: 1 });
    const r2 = agg.flush(null);

    expect(r2.seq).toBe(r1.seq + 1);
  });
});

// ─── setActiveWindow ─────────────────────────────────────────────────────────

describe('setActiveWindow', () => {
  test('sets active_window_id used in flushed records', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-first', 0);
    agg.accumulate({ key_count: 1 });
    const r1 = agg.flush(null);
    expect(r1.active_window_id).toBe('aw-first');

    agg.setActiveWindow('aw-second', 0);
    agg.accumulate({ click_count: 1 });
    const r2 = agg.flush(null);
    expect(r2.active_window_id).toBe('aw-second');
  });

  test('dwell_time_ms is non-negative', () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', Number(process.hrtime.bigint() / 1_000_000n));
    agg.accumulate({ key_count: 1 });
    const record = agg.flush(null);
    expect(record.dwell_time_ms).toBeGreaterThanOrEqual(0);
  });
});

// ─── startPeriodicFlush / stopPeriodicFlush ───────────────────────────────────

describe('startPeriodicFlush / stopPeriodicFlush', () => {
  test('DEFAULT_FLUSH_INTERVAL_MS is between 5000 and 30000 ms', () => {
    expect(DEFAULT_FLUSH_INTERVAL_MS).toBeGreaterThanOrEqual(5000);
    expect(DEFAULT_FLUSH_INTERVAL_MS).toBeLessThanOrEqual(30000);
  });

  test('flushes dirty metrics after interval elapses', async () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    agg.accumulate({ key_count: 5 });

    const appendFn = jest.fn();
    agg.startPeriodicFlush(appendFn, 1000);

    await jest.advanceTimersByTimeAsync(1000);

    expect(appendFn).toHaveBeenCalledTimes(1);
    expect(appendFn.mock.calls[0][0].type).toBe('input_summary');

    agg.stopPeriodicFlush();
  });

  test('does not call appendEventRecord on periodic tick when not dirty', async () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);
    // no accumulate — remains clean

    const appendFn = jest.fn();
    agg.startPeriodicFlush(appendFn, 1000);

    await jest.advanceTimersByTimeAsync(3000);

    expect(appendFn).not.toHaveBeenCalled();

    agg.stopPeriodicFlush();
  });

  test('stops flushing after stopPeriodicFlush', async () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);

    const appendFn = jest.fn();
    agg.startPeriodicFlush(appendFn, 500);
    agg.stopPeriodicFlush();

    agg.accumulate({ key_count: 10 });
    await jest.advanceTimersByTimeAsync(2000);

    expect(appendFn).not.toHaveBeenCalled();
  });

  test('stopPeriodicFlush is safe to call when not running', () => {
    const agg = makeAgg();
    expect(() => agg.stopPeriodicFlush()).not.toThrow();
    expect(() => agg.stopPeriodicFlush()).not.toThrow();
  });

  test('startPeriodicFlush replaces an existing timer', async () => {
    const agg = makeAgg();
    agg.setActiveWindow('aw-001', 0);

    const fn1 = jest.fn();
    const fn2 = jest.fn();

    agg.startPeriodicFlush(fn1, 500);
    // Replace before it fires
    agg.startPeriodicFlush(fn2, 500);

    agg.accumulate({ key_count: 1 });
    await jest.advanceTimersByTimeAsync(500);

    expect(fn1).not.toHaveBeenCalled(); // first timer was replaced
    expect(fn2).toHaveBeenCalledTimes(1);

    agg.stopPeriodicFlush();
  });
});
