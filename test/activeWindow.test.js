'use strict';

/**
 * test/activeWindow.test.js
 *
 * Unit tests for capture/activeWindow.js — M-02-AW.
 *
 * Test coverage:
 *   - sanitizeWindowTitle: URL, email, file path, length truncation
 *   - getActiveWindow: returns sanitized data, handles null/error
 *   - startActiveWindowWatcher: change detection, no duplicate emission
 *   - stopActiveWindowWatcher: clears interval, releases state
 *   - _buildEventRecord: EventRecordV1 schema compliance
 *
 * active-win is mocked throughout — no OS dependency needed.
 */

// ─── Mock active-win BEFORE requiring the module under test ──────────────────
// Jest hoists jest.mock() calls, so the mock is in place when activeWindow.js
// executes its require('active-win') at module load time.
jest.mock('active-win', () => jest.fn());

const activeWinMock = require('active-win');

const {
  getActiveWindow,
  startActiveWindowWatcher,
  stopActiveWindowWatcher,
  sanitizeWindowTitle,
  _buildEventRecord,
} = require('../capture/activeWindow');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a minimal valid active-win result for a given app and title. */
function makeRawWindow(appName, title, extra = {}) {
  return {
    title,
    owner: {
      name: appName,
      processName: appName,
      bundleId: extra.bundleId,
      processId: 1234,
      path: `/Applications/${appName}.app`,
    },
    id: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    memoryUsage: 0,
    ...extra,
  };
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  stopActiveWindowWatcher();
  jest.useRealTimers();
});

// ─── sanitizeWindowTitle ──────────────────────────────────────────────────────

describe('sanitizeWindowTitle', () => {
  describe('URL sanitization', () => {
    test('replaces https URL with domain only', () => {
      const result = sanitizeWindowTitle(
        'Visit https://mail.google.com/mail/u/0/#inbox for mail'
      );
      expect(result).toBe('Visit mail.google.com for mail');
    });

    test('replaces http URL with domain only', () => {
      const result = sanitizeWindowTitle('Go to http://example.com/path?q=1&r=2');
      expect(result).toBe('Go to example.com');
    });

    test('replaces URL with query params with domain only', () => {
      const result = sanitizeWindowTitle(
        'https://accounts.google.com/o/oauth2/auth?client_id=123&redirect_uri=https://app.com'
      );
      // The outer URL is sanitized first: accounts.google.com
      expect(result).toContain('accounts.google.com');
      expect(result).not.toContain('/o/oauth2/auth');
      expect(result).not.toContain('client_id');
    });

    test('handles multiple URLs in one title', () => {
      const result = sanitizeWindowTitle(
        'Comparing https://github.com/owner/repo and https://gitlab.com/other/proj'
      );
      expect(result).toBe('Comparing github.com and gitlab.com');
    });

    test('does not alter title with no URLs', () => {
      const result = sanitizeWindowTitle('My Document - Word');
      expect(result).toBe('My Document - Word');
    });

    test('result never contains a raw URL path', () => {
      const result = sanitizeWindowTitle('https://mail.google.com/mail/u/0/#inbox');
      expect(result).not.toContain('/mail/u/0/');
      expect(result).not.toContain('#inbox');
    });
  });

  describe('email sanitization', () => {
    test('masks local part of email', () => {
      const result = sanitizeWindowTitle('Contact john.doe@gmail.com for help');
      expect(result).toBe('Contact ***@gmail.com for help');
    });

    test('preserves domain of email', () => {
      const result = sanitizeWindowTitle('user@company.co.uk signed in');
      expect(result).toBe('***@company.co.uk signed in');
    });

    test('masks multiple emails', () => {
      const result = sanitizeWindowTitle(
        'From: alice@foo.com To: bob@bar.org'
      );
      expect(result).toBe('From: ***@foo.com To: ***@bar.org');
    });

    test('never stores the raw local part of an email', () => {
      const result = sanitizeWindowTitle('john.doe@gmail.com');
      expect(result).not.toContain('john.doe');
      expect(result).toContain('***');
      expect(result).toContain('@gmail.com');
    });
  });

  describe('file path sanitization', () => {
    test('reduces Windows absolute path to filename only', () => {
      const result = sanitizeWindowTitle(
        'Editing C:\\Users\\John\\Documents\\report.docx'
      );
      expect(result).toBe('Editing report.docx');
    });

    test('reduces Unix absolute path to filename only', () => {
      const result = sanitizeWindowTitle(
        'Error opening /home/john/documents/todo.txt'
      );
      expect(result).toBe('Error opening todo.txt');
    });

    test('handles deep Unix paths', () => {
      const result = sanitizeWindowTitle('/var/log/nginx/access.log');
      expect(result).toBe('access.log');
    });

    test('does not alter single-segment Unix path (/tmp style)', () => {
      // "/tmp" has only one segment after root — should NOT be changed
      const result = sanitizeWindowTitle('Temp dir: /tmp');
      expect(result).toBe('Temp dir: /tmp');
    });

    test('never contains user directory names from Windows path', () => {
      const result = sanitizeWindowTitle(
        'C:\\Users\\JohnSecret\\Desktop\\budget.xlsx'
      );
      expect(result).not.toContain('JohnSecret');
      expect(result).toBe('budget.xlsx');
    });

    test('never contains user directory names from Unix path', () => {
      const result = sanitizeWindowTitle('/home/secretuser/projects/app.js');
      expect(result).not.toContain('secretuser');
      expect(result).toBe('app.js');
    });
  });

  describe('length truncation', () => {
    test('truncates title exceeding 512 characters', () => {
      const long = 'A'.repeat(600);
      const result = sanitizeWindowTitle(long);
      expect(result.length).toBe(512);
    });

    test('does not truncate title of exactly 512 characters', () => {
      const exact = 'B'.repeat(512);
      const result = sanitizeWindowTitle(exact);
      expect(result.length).toBe(512);
    });

    test('does not alter title shorter than 512 characters', () => {
      const short = 'Short title';
      const result = sanitizeWindowTitle(short);
      expect(result).toBe('Short title');
    });
  });

  describe('edge cases', () => {
    test('returns empty string for empty input', () => {
      expect(sanitizeWindowTitle('')).toBe('');
    });

    test('returns empty string for null input', () => {
      expect(sanitizeWindowTitle(null)).toBe('');
    });

    test('returns empty string for undefined input', () => {
      expect(sanitizeWindowTitle(undefined)).toBe('');
    });

    test('handles mixed URL + email + path in one title', () => {
      const title =
        'Report from john@example.com: https://s3.amazonaws.com/bucket/file.pdf ' +
        '(local: C:\\Users\\Admin\\Downloads\\report.pdf)';
      const result = sanitizeWindowTitle(title);
      expect(result).not.toContain('john@');
      expect(result).not.toContain('bucket/file.pdf');
      expect(result).not.toContain('Admin');
      expect(result).toContain('***@example.com');
      expect(result).toContain('s3.amazonaws.com');
      expect(result).toContain('report.pdf');
    });
  });
});

// ─── getActiveWindow ──────────────────────────────────────────────────────────

describe('getActiveWindow', () => {
  test('returns sanitized window data', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Google Chrome', 'https://mail.google.com/inbox - Gmail')
    );

    const result = await getActiveWindow();

    expect(result).not.toBeNull();
    expect(result.app_name).toBe('Google Chrome');
    // URL must be sanitized
    expect(result.window_title).not.toContain('/inbox');
    expect(result.window_title).toContain('mail.google.com');
    expect(typeof result.timestamp).toBe('number');
    expect(typeof result.monotonic_ms).toBe('number');
    expect(result.monotonic_ms).toBeGreaterThanOrEqual(0);
  });

  test('returns null when active-win returns null/undefined', async () => {
    activeWinMock.mockResolvedValue(undefined);
    const result = await getActiveWindow();
    expect(result).toBeNull();
  });

  test('returns null and logs error when active-win throws', async () => {
    activeWinMock.mockRejectedValue(new Error('Permission denied'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getActiveWindow();
    expect(result).toBeNull();
    spy.mockRestore();
  });

  test('includes bundle_id on macOS when present', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Safari', 'Apple', { bundleId: 'com.apple.Safari' })
    );

    const result = await getActiveWindow();
    expect(result.bundle_id).toBe('com.apple.Safari');
  });

  test('includes process_name when present', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Code', 'editor.ts - VS Code')
    );

    const result = await getActiveWindow();
    expect(result.process_name).toBe('Code');
  });

  test('window_title is always sanitized (never raw)', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Browser', 'john.doe@company.com - Inbox')
    );

    const result = await getActiveWindow();
    expect(result.window_title).not.toContain('john.doe');
    expect(result.window_title).toContain('***');
  });
});

// ─── startActiveWindowWatcher / stopActiveWindowWatcher ───────────────────────

describe('startActiveWindowWatcher', () => {
  test('calls onChange when window changes', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('VS Code', 'index.ts - VS Code')
    );

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });

    await jest.advanceTimersByTimeAsync(100);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        app_name: 'VS Code',
        window_title: expect.any(String),
        timestamp: expect.any(Number),
        monotonic_ms: expect.any(Number),
      })
    );
  });

  test('does NOT emit duplicate event when window is unchanged', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Terminal', 'bash - Terminal')
    );

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });

    // First poll — change detected
    await jest.advanceTimersByTimeAsync(100);
    // Second poll — same window, no change
    await jest.advanceTimersByTimeAsync(100);
    // Third poll — still same
    await jest.advanceTimersByTimeAsync(100);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('emits again when window changes a second time', async () => {
    activeWinMock
      .mockResolvedValueOnce(makeRawWindow('App A', 'App A - Window'))
      .mockResolvedValueOnce(makeRawWindow('App A', 'App A - Window'))
      .mockResolvedValueOnce(makeRawWindow('App B', 'App B - Window'));

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });

    await jest.advanceTimersByTimeAsync(100); // App A detected
    await jest.advanceTimersByTimeAsync(100); // App A unchanged
    await jest.advanceTimersByTimeAsync(100); // App B — change

    expect(onChange).toHaveBeenCalledTimes(2);
    const calls = onChange.mock.calls;
    expect(calls[0][0].app_name).toBe('App A');
    expect(calls[1][0].app_name).toBe('App B');
  });

  test('does NOT call onChange when active window is null', async () => {
    activeWinMock.mockResolvedValue(undefined);

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });

    await jest.advanceTimersByTimeAsync(300);

    expect(onChange).not.toHaveBeenCalled();
  });

  test('calls appendEventRecord with EventRecordV1 on window change', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Slack', 'General - Slack')
    );

    const appendEventRecord = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord });

    await jest.advanceTimersByTimeAsync(100);

    expect(appendEventRecord).toHaveBeenCalledTimes(1);
    const record = appendEventRecord.mock.calls[0][0];

    // EventRecordV1 required fields (INTERFACES.md §3A)
    expect(record.schema_version).toBe('1.0.0');
    expect(typeof record.event_id).toBe('string');
    expect(record.event_id.trim()).not.toBe('');
    expect(typeof record.session_id).toBe('string');
    expect(typeof record.created_at).toBe('string');
    expect(isNaN(Date.parse(record.created_at))).toBe(false);
    expect(typeof record.timezone_offset).toBe('number');
    expect(Number.isInteger(record.timezone_offset)).toBe(true);
    expect(typeof record.timestamp).toBe('number');
    expect(typeof record.monotonic_ms).toBe('number');
    expect(record.monotonic_ms).toBeGreaterThanOrEqual(0);
    expect(record.app_name).toBe('Slack');
    expect(typeof record.window_title).toBe('string');
    expect(record.key_count).toBe(0);
    expect(record.click_count).toBe(0);
    expect(record.mouse_distance).toBe(0);
    expect(record.scroll_delta).toBe(0);
    expect(record.idle_ms).toBe(0);
    expect(record.dwell_time_ms).toBe(0);
    expect(record.trigger_reason).toBe('WINDOW_CHANGE');
  });

  test('does NOT call appendEventRecord for duplicate windows', async () => {
    activeWinMock.mockResolvedValue(
      makeRawWindow('Finder', 'Documents')
    );

    const appendEventRecord = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, appendEventRecord });

    await jest.advanceTimersByTimeAsync(500); // 5 polls, same window

    expect(appendEventRecord).toHaveBeenCalledTimes(1);
  });

  test('restarts cleanly when called a second time', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('App', 'Title'));

    const onChange1 = jest.fn();
    const onChange2 = jest.fn();

    startActiveWindowWatcher({ interval_ms: 100, onChange: onChange1 });
    await jest.advanceTimersByTimeAsync(100); // onChange1 fires

    // Start again — previous watcher must be stopped
    startActiveWindowWatcher({ interval_ms: 100, onChange: onChange2 });
    await jest.advanceTimersByTimeAsync(100); // onChange2 fires (new watcher)

    // onChange1 should NOT fire again after the restart
    // onChange2 should have fired once (first detection by new watcher)
    expect(onChange2).toHaveBeenCalledTimes(1);
  });

  test('uses default 1000ms interval when interval_ms not provided', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('App', 'Title'));

    const onChange = jest.fn();
    startActiveWindowWatcher({ onChange });

    // Only 900ms elapsed — should not have polled yet
    await jest.advanceTimersByTimeAsync(900);
    expect(onChange).not.toHaveBeenCalled();

    // At 1000ms — should poll
    await jest.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('stopActiveWindowWatcher', () => {
  test('stops polling after stopActiveWindowWatcher is called', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('App', 'Title'));

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });

    stopActiveWindowWatcher();

    await jest.advanceTimersByTimeAsync(500);

    expect(onChange).not.toHaveBeenCalled();
  });

  test('is safe to call when watcher is not running', () => {
    expect(() => stopActiveWindowWatcher()).not.toThrow();
    expect(() => stopActiveWindowWatcher()).not.toThrow();
  });

  test('allows restarting after stop', async () => {
    activeWinMock.mockResolvedValue(makeRawWindow('App', 'Title'));

    const onChange = jest.fn();
    startActiveWindowWatcher({ interval_ms: 100, onChange });
    stopActiveWindowWatcher();

    // Restart
    startActiveWindowWatcher({ interval_ms: 100, onChange });
    await jest.advanceTimersByTimeAsync(100);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ─── _buildEventRecord ────────────────────────────────────────────────────────

describe('_buildEventRecord', () => {
  const sampleWindowData = {
    timestamp: 1708452399000,
    monotonic_ms: 123456,
    app_name: 'TestApp',
    window_title: 'sanitized title',
    bundle_id: 'com.test.app',
    process_name: 'testapp',
  };

  test('produces all required EventRecordV1 fields', () => {
    const record = _buildEventRecord(sampleWindowData);

    expect(record.schema_version).toBe('1.0.0');
    expect(typeof record.event_id).toBe('string');
    expect(record.event_id.trim()).not.toBe('');
    expect(typeof record.session_id).toBe('string');
    expect(typeof record.seq).toBe('number');
    expect(Number.isInteger(record.seq)).toBe(true);
    expect(record.seq).toBeGreaterThanOrEqual(0);
    expect(typeof record.created_at).toBe('string');
    expect(isNaN(Date.parse(record.created_at))).toBe(false);
    expect(typeof record.timezone_offset).toBe('number');
    expect(Number.isInteger(record.timezone_offset)).toBe(true);
    expect(record.timestamp).toBe(sampleWindowData.timestamp);
    expect(record.monotonic_ms).toBe(sampleWindowData.monotonic_ms);
    expect(record.app_name).toBe('TestApp');
    expect(record.window_title).toBe('sanitized title');
    expect(record.bundle_id).toBe('com.test.app');
    expect(record.process_name).toBe('testapp');
    expect(record.key_count).toBe(0);
    expect(record.click_count).toBe(0);
    expect(record.mouse_distance).toBe(0);
    expect(record.scroll_delta).toBe(0);
    expect(record.idle_ms).toBe(0);
    expect(record.dwell_time_ms).toBe(0);
    expect(record.trigger_reason).toBe('WINDOW_CHANGE');
  });

  test('event_id is a valid UUID v4 format', () => {
    const record = _buildEventRecord(sampleWindowData);
    expect(record.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('seq increments strictly by 1 per call', () => {
    const r1 = _buildEventRecord(sampleWindowData);
    const r2 = _buildEventRecord(sampleWindowData);
    const r3 = _buildEventRecord(sampleWindowData);
    expect(r2.seq).toBe(r1.seq + 1);
    expect(r3.seq).toBe(r2.seq + 1);
  });

  test('omits bundle_id when not present in windowData', () => {
    const data = { ...sampleWindowData };
    delete data.bundle_id;
    const record = _buildEventRecord(data);
    expect(record.hasOwnProperty('bundle_id')).toBe(false);
  });

  test('omits process_name when not present in windowData', () => {
    const data = { ...sampleWindowData };
    delete data.process_name;
    const record = _buildEventRecord(data);
    expect(record.hasOwnProperty('process_name')).toBe(false);
  });

  test('record is JSON-serializable (no bigint or circular refs)', () => {
    const record = _buildEventRecord(sampleWindowData);
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  test('created_at is a valid ISO-8601 UTC string', () => {
    const record = _buildEventRecord(sampleWindowData);
    expect(record.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});
