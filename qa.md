# Code Analysis Report

## PASS (Conditional)

The implementation is fundamentally sound and aligns with the spec. However, there are several issues that should be addressed for production readiness.

---

## 1. Bug Risks

### 1.1 Race Condition: Input Counter Reset (Low Risk)
**Location:** `src/main.js:38-41`

```javascript
const capturedKeystrokes = keystrokes;
const capturedMouseClicks = mouseClicks;
keystrokes = 0;
mouseClicks = 0;
```

**Analysis:** While JavaScript is single-threaded, the `uIOhook` events fire asynchronously. An input event could theoretically fire between the capture and reset lines, causing that input to be lost.

**Risk Level:** Low ??In practice, the 1ms window makes this extremely unlikely, and Node.js event loop semantics make this effectively atomic for this use case.

**Recommendation:** Acceptable as-is. If paranoid, wrap in a mutex or use a single object swap pattern.

---

### 1.2 Unhandled Promise Rejection (Medium Risk)
**Location:** `src/main.js:28`

```javascript
const win = await activeWin();
```

**Issue:** `activeWin()` can throw or reject (e.g., on permission denied, especially macOS). This unhandled rejection will crash the polling loop silently in Node 14.

**Fix:**
```javascript
setInterval(async () => {
  try {
    const win = await activeWin();
    if (!win) return;
    // ... rest of logic
  } catch (err) {
    console.error('Failed to get active window:', err.message);
  }
}, POLL_INTERVAL);
```

---

### 1.3 File I/O Error Handling (Medium Risk)
**Location:** `src/main.js:55-57`

```javascript
const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
logs.push(entry);
fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
```

**Issues:**
1. If `focus_logs.json` is corrupted (invalid JSON), `JSON.parse` throws and crashes the app
2. No write error handling (disk full, permissions)
3. File grows unbounded ??will eventually cause memory issues on `readFileSync`

**Fix:**
```javascript
try {
  const raw = fs.readFileSync(LOG_FILE, 'utf-8');
  const logs = JSON.parse(raw);
  logs.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
} catch (err) {
  console.error('File I/O error:', err.message);
  // Optionally: reinitialize file if JSON is corrupted
}
```

---

## 2. Missing Pieces Based on Spec

### 2.1 Idle State Detection (Clarification Needed)
**Spec states:** "?쒖뒪?쒖씠 ?좏쑕 ?곹깭硫?'Idle' ?곹깭濡쒖꽌 蹂꾨룄濡?湲곕줉?섏? ?딆뒿?덈떎"

**Current behavior:** If no window change AND no input, the interval returns early ??this matches the spec's intent (no logging during idle).

**Status:** ??Correctly implemented via early return.

---

### 2.2 SIGINT Handler on Windows
**Location:** `src/main.js:62-65`

**Issue:** `SIGINT` works differently on Windows. The handler may not trigger properly via `Ctrl+C` in CMD.

**Recommendation:** Add `SIGTERM` and Windows-specific handling:
```javascript
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    uIOhook.stop();
    process.exit(0);
  });
});
```

---

## 3. Privacy Risks

### 3.1 Sensitive Window Title Logging (High Risk)
**Location:** `src/main.js:45` ??`title: currentTitle`

**Issue:** Window titles often contain sensitive data:
- Browser tabs: `"Bank Account - Chase.com"`, `"Password Reset - Gmail"`
- Editors: `"secrets.env - VS Code"`, `"private_key.pem"`
- Messaging: `"Chat with John Doe - Slack"`

**Recommendation:** Implement title sanitization or opt-in detailed logging:
```javascript
// Option 1: Truncate/hash titles
const sanitizedTitle = currentTitle.substring(0, 50); // or hash it

// Option 2: Configurable privacy mode
const PRIVACY_MODE = process.env.PRIVACY_MODE === 'true';
const title = PRIVACY_MODE ? '[redacted]' : currentTitle;
```

---

## 4. Atomic State Management

### 4.1 lastSavedState Update (Correct)
**Location:** `src/main.js:59`

```javascript
lastSavedState = { app: currentApp, title: currentTitle };
```

**Analysis:** This is correctly placed AFTER the file write succeeds. If the write fails, the state won't update, and the next interval will attempt to write again.

**Status:** ??Correctly implemented.

---

### 4.2 Counter Atomicity (Acceptable)
The capture-then-reset pattern is the correct approach for JavaScript. Object reference swap would be marginally safer but unnecessary here.

**Status:** ??Acceptable.

---

## Summary Table

| Issue | Severity | Status |
|-------|----------|--------|
| activeWin() error handling | Medium | ??Missing |
| File I/O error handling | Medium | ??Missing |
| JSON corruption recovery | Medium | ??Missing |
| Privacy (window titles) | High | ?좑툘 Risk exists |
| Race condition (counters) | Low | ??Acceptable |
| Idle state handling | N/A | ??Correct |
| Atomic state management | N/A | ??Correct |
| Windows SIGINT | Low | ?좑툘 May not work |

---

## Verdict

**PASS** for spec compliance. The core logic correctly implements:
- 1-second polling interval
- Window change detection
- Input activity detection
- Conditional persistence (skip if idle)
- Atomic counter reset pattern

**Recommended fixes before production:**
1. Add try-catch around `activeWin()` call
2. Add try-catch around file I/O operations
3. Consider privacy implications of logging window titles
