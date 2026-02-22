# DECISION LOG

This document records architectural and strategic decisions.
`INTERFACES.md` defines system contracts.
`ARCHITECTURE.md` defines technical implementation.
This file records why decisions were made.

---

## D-003 - SQLite as Primary Storage (Deprecated)

**Date:** 2026-02-12  
**Status:** Superseded  
**Superseded By:** D-006

### Original Decision

Adopt SQLite as the primary local storage engine.

### Reason for Supersession

System crash safety and long-term rebuildability require an append-only canonical event log. Analytics and aggregation needs still justify SQLite, but not as the source of truth.

---

## D-006 - Hybrid Storage Architecture

**Date:** 2026-02-17  
**Status:** Approved

### Decision

Adopt a hybrid storage model:

- JSONL = Canonical append-only event store
- SQLite = Derived aggregate database
- SQLite MUST be fully reconstructible from JSONL
- JSONL is the single source of truth

### Rationale

1. Append-only logs maximize crash safety.
2. JSONL allows auditability and replay.
3. SQLite enables efficient aggregation queries.
4. Supports long-session analytics without sacrificing durability.
5. Enables future ML replay, recalibration, and drift detection.

### Architecture Rules

- All raw events MUST be written to JSONL first.
- SQLite writes MUST be derived from JSONL ingestion.
- No data may exist exclusively in SQLite.
- If SQLite becomes corrupted, it MUST be rebuildable.

### Impacted Documents

- `INTERFACES.md` (Canonical store definition)
- `ARCHITECTURE.md` (Storage Strategy section)
- `SCOPE.md` (Remove "choose one" wording)

### Migration Required

Yes - remove ambiguity in storage strategy across documentation.

**Approved By:** CTO

---

## D-004 - Time Model Design

**Date:** 2026-02-22  
**Status:** Approved

### Context

The system requires reliable event ordering, accurate local-time analytics, and safe duration calculations under:

- DST transitions
- Timezone changes (travel)
- Manual system clock adjustments
- NTP corrections
- Long-running sessions

Using a single wall-clock timestamp is insufficient for correctness.

### Decision

The system will store four time representations per event:

- `created_at` (UTC ISO-8601)
- `timezone_offset` (minutes)
- `timestamp` (epoch ms)
- `monotonic_ms` (monotonic clock)

Duration calculations MUST use `monotonic_ms`.

Local time reconstruction MUST use:

```text
local_time = created_at + timezone_offset
```

### Consequences

**Positive**

- Accurate local analytics
- Clock-change resilience
- Travel-safe event reconstruction
- Reliable dwell-time computation
- Production-grade temporal correctness

**Negative**

- Slight redundancy in stored time fields
- Increased event payload size

This redundancy is intentional and required for correctness.
