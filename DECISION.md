## D-003 — Local Storage Engine: SQLite

**Date:** 2026-02-12  
**Status:** Approved  

---

### Context

The system requires structured local persistence for:

- Event capture logs
- Derived feature records
- Focus score history
- Calibration parameters
- Long-session stability

The storage layer must support:
- Efficient querying for analytics (daily/weekly reports)
- Log integrity under long-running sessions
- Controlled file growth
- Low overhead
- On-device only operation

---

### Options Considered

#### Option A — JSONL (Append-only log files)

Pros:
- Extremely simple to implement
- Human-readable
- Good for early prototyping

Cons:
- Difficult to query for analytics
- Requires full-file scans for aggregation
- Harder to manage file growth
- Risk of corrupted entries during crashes
- No indexing support

---

#### Option B — SQLite (Embedded Relational Database)

Pros:
- ACID-compliant (safe writes)
- Structured schema enforcement
- Efficient indexed queries
- Suitable for long-term analytics
- Handles file growth gracefully
- Native Node.js support

Cons:
- Slightly more setup complexity
- Requires schema design
- Minor overhead compared to plain append logs

---

### Decision

Adopt **SQLite** as the primary local storage engine.

Rationale:
- Long-term scalability outweighs minimal setup complexity.
- Efficient analytics and trend queries are essential for dashboard and reporting.
- ACID guarantees reduce risk of corrupted logs during crashes.
- Aligns with long-term personalization and drift detection requirements.

---

### Impact

Affects:
- M-01 (Foundation & Smart Save)
- ARCHITECTURE.md — Storage Strategy section
- Future Dashboard querying logic
- Personalization & Drift Detection layer

Performance Impact:
- Negligible for aggregated metric storage.
- Indexed queries will significantly improve dashboard performance.

Privacy Impact:
- No change (data remains fully local).
- Sensitive raw data still forbidden from persistence.

---

### Rollback Plan

If SQLite introduces unexpected performance overhead:

1. Switch to append-only JSONL for raw event logs.
2. Maintain SQLite only for derived features and scores.
3. Re-evaluate hybrid architecture.

---

### Approved By

CTO
