# DECISION LOG

This document records architectural and strategic decisions.
INTERFACES.md defines system contracts.
ARCHITECTURE.md defines technical implementation.
This file records why decisions were made.

---

## D-003 - SQLite as Primary Storage (Deprecated)

**Date:** 2026-02-12  
**Status:** Superseded  
**Superseded By:** D-006  

### Original Decision
Adopt SQLite as the primary local storage engine.

### Reason for Supersession
System crash safety and long-term rebuildability require an append-only canonical event log.
Analytics and aggregation needs still justify SQLite, but not as the source of truth.

---

## D-006 - Hybrid Storage Architecture

**Date:** 2026-02-17  
**Status:** Approved  

### Decision

Adopt a Hybrid Storage Model:

- JSONL = Canonical append-only event store
- SQLite = Derived aggregate database
- SQLite MUST be fully reconstructible from JSONL
- JSONL is the single source of truth

### Rationale

1. Append-only logs maximize crash safety
2. JSONL allows auditability and replay
3. SQLite enables efficient aggregation queries
4. Supports long-session analytics without sacrificing durability
5. Enables future ML replay, recalibration, and drift detection

### Architecture Rules

- All raw events MUST be written to JSONL first
- SQLite writes MUST be derived from JSONL ingestion
- No data may exist exclusively in SQLite
- If SQLite becomes corrupted, it MUST be rebuildable

### Impacted Documents

- INTERFACES.md (Canonical store definition)
- ARCHITECTURE.md (Storage Strategy section)
- SCOPE.md (Remove "choose one" wording)

### Migration Required

Yes - remove ambiguity in storage strategy across documentation.

---

Approved By  
CTO
