# Active Scope — SCOPE-Foundation-M01

> This scope defines the foundational infrastructure required for reliable and privacy-safe event capture.
> No AI, no scoring, no UI beyond debugging utilities.

---

## 1. Context

- Driven Milestone(s): M-01 — Foundation & Smart Save
- Related Epic(s): EPIC-01 (Infrastructure prerequisite)
- Strategic Goal: Build a stable, lossless, low-overhead data capture layer.

---

## 2. Objective (This Phase Only)

Deliver a production-grade event capture engine capable of:

- Reliable global input monitoring
- Accurate active window tracking
- Smart persistence logic
- Zero event loss
- Stable CPU behavior under long sessions

---

## 3. In Scope

Only the following components are allowed:

### Event Capture
- [ ] Active window tracking (app_name + window_title)
- [ ] Global input aggregation (counts only; no content)

### Smart Save Logic
- [ ] Persist only on:
  - window change
  - input > 0
  - optional low-frequency heartbeat
- [ ] Atomic counter reset after persistence

### Schema & Storage
- [ ] Define stable log schema
- [ ] Implement JSONL or SQLite storage (choose one)
- [ ] Log rotation strategy (prevent file growth issues)

### Stability & Safety
- [ ] Race-condition-free implementation
- [ ] Permission failure handling
- [ ] Graceful shutdown logic
- [ ] CPU instrumentation (monitor usage)

### Validation
- [ ] 2-hour continuous session stress test
- [ ] No event drops detected
- [ ] No memory leak detected

---

## 4. Explicitly Out of Scope

The following are strictly forbidden in this scope:

- ❌ Sentence-BERT integration
- ❌ Cosine similarity
- ❌ MediaPipe
- ❌ Scoring logic
- ❌ Dashboard UI
- ❌ Personalization
- ❌ Drift detection
- ❌ Weight tuning
- ❌ Optimization beyond stability fixes

If not listed in "In Scope", it is out of scope.

---

## 5. Success Criteria (Measurable)

- CPU usage average < 2% during idle monitoring
- No crashes during 2-hour test
- No race condition detected
- No corrupted log entries
- All logs contain:
  - timestamp
  - app_name
  - window_title
  - aggregated input metrics

---

## 6. Risks (This Scope)

- OS permission denial
- Native module instability
- File write race conditions
- Log file uncontrolled growth

---

## 7. Deliverables

- Stable index.js (or main process file)
- Defined and versioned schema
- Storage module
- Performance test report
- Updated ARCHITECTURE.md (if needed)

---

## 8. CTO Gate

Before proceeding to M-02:

CTO must confirm:

- [ ] System stable under long session
- [ ] No privacy violations
- [ ] CPU acceptable
- [ ] Logging schema finalized
- [ ] No hidden technical debt introduced

Status:
☐ Approved  
☐ Needs Revision  
☐ Rejected
