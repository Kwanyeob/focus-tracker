# M-01 - JSONL Foundation (INTERFACES.md Compliant)

- ID: `M-01`
- Status: `Planned`
- Type: `Feature`
- Depends on: _None_

## Goal

Implement a crash-safe, append-only JSONL persistence layer fully compliant with `INTERFACES.md`.

This includes:

- `EventRecord` schema compliant with `INTERFACES.md`
- Append-only `jsonlWriter` with rotation and session management
- Atomic checkpoint protocol
- Robust crash recovery logic
- 2-hour soak test validating durability and recovery

This implementation serves as the foundation for all future storage engines (including SQLite migration).

## Compliance Requirement

This module **MUST** comply with:

- `docs/INTERFACES.md`
- `docs/DECISION.md`
- `docs/ARCHITECTURE.md`

If any ambiguity exists, `INTERFACES.md` takes precedence.

## 1. EventRecord Schema (MANDATORY)

File: `src/storage/eventRecord.ts`

Each record **MUST** contain:

```ts
interface EventRecord {
  schema_version: number; // REQUIRED. Start at 1
  event_id: string; // globally unique id (uuid or monotonic)
  session_id: string; // generated at session start
  seq: number; // monotonic per session, starts at 0
  created_at: string; // ISO-8601 UTC timestamp
  epoch_ms: number; // same time as created_at, epoch ms
  monotonic_ms: number; // REQUIRED, from process monotonic clock
  timezone_offset: number; // REQUIRED, minutes offset from UTC
  source: string; // module name
  type: string; // event type
  payload: object; // event-specific data
}
```

Example timestamp: `2026-02-20T21:15:32.123Z`

Validation rules:

- All required fields must exist
- `seq` must be integer `>= 0`
- `epoch_ms` must be finite integer
- `monotonic_ms` must be monotonic increasing
- Record must be JSON serializable

## 2. Session Management

File: `src/storage/sessionManager.ts`

Requirements:

- Generate new `session_id` at process start
- Recommended format:

```txt
session_id = hostname + "-" + process_start_epoch + "-" + random
```

Example:

```txt
macbook-1708452399123-ab12cd
```

Rules:

- `seq` MUST start at `0` for each session
- `seq` MUST increment exactly by `1`
- `seq` MUST NEVER decrease
- `seq` MUST NEVER skip values during normal operation

Expose API:

- `getSessionId(): string`
- `nextSeq(): number`

## 3. JSONL Writer

File: `src/storage/jsonlWriter.ts`

Append-only writer.

Each append MUST produce exactly one line:

```txt
JSON.stringify(record) + "\n"
```

Writer MUST NEVER produce partial lines.

Required API:

- `constructor(baseDir: string, options?)`
- `append(record: EventRecord): Promise<void>`
- `flush(): Promise<void>`
- `close(): Promise<void>`
- `recoverIfNeeded(): Promise<void>`
- `getCurrentPath(): string`

## 4. File Naming and Rotation

Base format:

```txt
events-YYYYMMDD.jsonl
```

Example:

```txt
events-20260220.jsonl
```

If rotated due to size limit:

```txt
events-20260220.1.jsonl
events-20260220.2.jsonl
events-20260220.3.jsonl
```

Rotation triggers:

- Date change
- OR file size exceeds configured `max_bytes`

Rotation MUST:

- Close current file safely
- Open new file safely
- NOT lose buffered events

## 5. Atomic Checkpoint Protocol

File: `src/storage/checkpoint.ts`

Checkpoint file name:

```txt
dirty_state.json
```

Structure:

```json
{
  "schema_version": 1,
  "session_id": "...",
  "last_flushed_seq": 12345,
  "updated_at": "ISO timestamp"
}
```

### CRITICAL: Atomic Write Requirement

Checkpoint MUST use atomic rename protocol.

Write sequence:

1. Write to temporary file: `dirty_state.json.tmp`
2. `fsync` temporary file
3. Rename temporary file to final file: `dirty_state.json.tmp -> dirty_state.json`

This guarantees atomic replacement.

At no point may `dirty_state.json` be partially written.

Required API:

- `loadCheckpoint(): Promise<CheckpointState>`
- `markFlushed(seq: number): Promise<void>`
- `recoverCheckpoint(): Promise<void>`

## 6. Recovery Logic (CRITICAL)

File: `src/storage/recovery.ts` (or integrated into `jsonlWriter`)

Executed at process startup.

Goal:

- Ensure consistency between JSONL file tail and checkpoint `last_flushed_seq`

Recovery algorithm:

1. Load checkpoint
   - Read `last_flushed_seq`
   - Read `session_id`
2. Read last JSONL file
   - Read last valid line safely
   - Must handle empty file, partial last line, corrupted last line
   - If last line is corrupted, truncate safely to last valid newline
3. Compare `seq`

Case A:

- JSONL `seq == checkpoint seq`
- System is consistent

Case B:

- JSONL `seq > checkpoint seq`
- Checkpoint is stale
- Update checkpoint to JSONL `seq`

Case C:

- JSONL `seq < checkpoint seq`
- Checkpoint is ahead of JSONL (crash occurred during append)
- Accept JSONL as source of truth
- Update checkpoint to JSONL `seq`

Recovery MUST NEVER:

- Create duplicate `seq`
- Skip `seq`

## 7. Filesystem Safety Requirements

Writer MUST ensure:

- Directory exists before writing
- File handles properly closed
- Append operations serialized
- No concurrent writes without mutex

Concurrent append MUST NOT corrupt file.

## 8. Validation Rules

Before append:

- Validate required fields
- Validate `seq` monotonic
- Validate `schema_version`

Reject invalid records.

## 9. Soak Test (2 Hours)

File: `scripts/soak/jsonl_soak_test.ts`

Test behavior:

- Generate synthetic events
- Realistic rate (50-200 events/sec)
- Periodically flush
- Periodically simulate crash

Crash simulation:

- Force process exit
- Restart writer
- Run recovery

Success criteria:

- No JSON parse errors
- `seq` strictly monotonic per session
- No duplicate `seq`
- No missing `seq` except last incomplete batch
- Checkpoint consistent with JSONL

## 10. Required Unit Tests

Files:

- `test/jsonlWriter.test.ts`
- `test/checkpoint.test.ts`
- `test/recovery.test.ts`

Test scenarios:

- Append correctness
- Rotation correctness
- Checkpoint atomicity
- Recovery correctness
- Corrupted tail recovery
- `seq` monotonic enforcement

## 11. Acceptance Criteria

All conditions MUST be satisfied:

- `npm test` passes
- Soak test runs 2 hours without corruption
- Forced crash recovery works correctly
- Checkpoint remains consistent
- `INTERFACES.md` fully respected

## 12. Non-Goals

This task does **NOT** include:

- SQLite implementation
- Compression
- Cloud sync
- Indexing

These will be implemented in future milestones.

