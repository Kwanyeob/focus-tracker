/**
 * test/recovery.test.ts
 *
 * Unit tests for recovery logic:
 *   - Case A: JSONL and checkpoint agree → no update
 *   - Case B: JSONL ahead of checkpoint → checkpoint updated
 *   - Case C: Checkpoint ahead of JSONL → checkpoint updated to JSONL
 *   - Corrupt last line → truncated and seq reconciled
 *   - Empty JSONL file → seq = -1
 *   - No JSONL file → seq = -1
 *   - Partial line (no trailing newline) → truncated
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { runRecovery, findLatestJsonlFile, readLastValidLine } from "../src/storage/recovery";
import { Checkpoint } from "../src/storage/checkpoint";
import { EventRecord, CURRENT_SCHEMA_VERSION } from "../src/storage/eventRecord";
import { setSeq, currentSeq } from "../src/storage/sessionManager";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "recovery-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Writes N valid JSONL records to a file, returning the last seq written. */
async function writeJsonlRecords(filePath: string, count: number, startSeq = 0): Promise<number> {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i;
    const rec: EventRecord = {
      schema_version: CURRENT_SCHEMA_VERSION,
      event_id: crypto.randomUUID(),
      session_id: "test-session",
      seq,
      created_at: new Date().toISOString(),
      epoch_ms: Date.now(),
      monotonic_ms: Number(process.hrtime.bigint() / 1_000_000n),
      timezone_offset: 0,
      source: "test",
      type: "TEST",
      payload: {},
    };
    lines.push(JSON.stringify(rec));
  }
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
  return startSeq + count - 1;
}

/** Returns today's JSONL filename. */
function todayFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `events-${y}${m}${day}.jsonl`;
}

beforeEach(() => {
  setSeq(-1);
});

// ─── findLatestJsonlFile ──────────────────────────────────────────────────────

describe("findLatestJsonlFile", () => {
  test("returns null for empty directory", async () => {
    const dir = await makeTmpDir();
    try {
      expect(await findLatestJsonlFile(dir)).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });

  test("returns null for nonexistent directory", async () => {
    expect(await findLatestJsonlFile("/nonexistent/path")).toBeNull();
  });

  test("returns the most recent file", async () => {
    const dir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(dir, "events-20260101.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(dir, "events-20260220.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(dir, "events-20260115.jsonl"), "", "utf-8");

      const result = await findLatestJsonlFile(dir);
      expect(result).toBe(path.join(dir, "events-20260220.jsonl"));
    } finally {
      await cleanup(dir);
    }
  });

  test("treats .1.jsonl as newer than .jsonl for the same date", async () => {
    const dir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(dir, "events-20260220.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(dir, "events-20260220.1.jsonl"), "", "utf-8");

      const result = await findLatestJsonlFile(dir);
      // Rotation index 1 > 0 (base file), so .1.jsonl is returned as the latest
      expect(path.basename(result!)).toBe("events-20260220.1.jsonl");
    } finally {
      await cleanup(dir);
    }
  });

  test("among multiple rotation files picks the highest index", async () => {
    const dir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(dir, "events-20260220.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(dir, "events-20260220.1.jsonl"), "", "utf-8");
      await fs.writeFile(path.join(dir, "events-20260220.2.jsonl"), "", "utf-8");

      const result = await findLatestJsonlFile(dir);
      expect(path.basename(result!)).toBe("events-20260220.2.jsonl");
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── readLastValidLine ────────────────────────────────────────────────────────

describe("readLastValidLine", () => {
  test("returns null for nonexistent file", async () => {
    const { record, truncated } = await readLastValidLine("/nonexistent/file.jsonl");
    expect(record).toBeNull();
    expect(truncated).toBe(false);
  });

  test("returns null and truncated=false for empty file", async () => {
    const dir = await makeTmpDir();
    try {
      const p = path.join(dir, "empty.jsonl");
      await fs.writeFile(p, "", "utf-8");
      const { record, truncated } = await readLastValidLine(p);
      expect(record).toBeNull();
      expect(truncated).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("returns the last record from a valid file", async () => {
    const dir = await makeTmpDir();
    try {
      const p = path.join(dir, "valid.jsonl");
      await writeJsonlRecords(p, 5);
      const { record, truncated } = await readLastValidLine(p);
      expect(record).not.toBeNull();
      expect(record!.seq).toBe(4);
      expect(truncated).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("truncates a partial last line (no trailing newline)", async () => {
    const dir = await makeTmpDir();
    try {
      const p = path.join(dir, "partial.jsonl");
      await writeJsonlRecords(p, 3);
      // Append a partial line without trailing newline
      const handle = await fs.open(p, "a");
      await handle.write('{"partial":true', null, "utf-8");
      await handle.close();

      const { record, truncated } = await readLastValidLine(p);
      expect(record).not.toBeNull();
      expect(record!.seq).toBe(2); // last complete record
      expect(truncated).toBe(true);

      // The file must now end with "\n"
      const content = await fs.readFile(p, "utf-8");
      expect(content.endsWith("\n")).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  test("truncates a corrupt last line (invalid JSON)", async () => {
    const dir = await makeTmpDir();
    try {
      const p = path.join(dir, "corrupt.jsonl");
      await writeJsonlRecords(p, 4);
      // Append a line that looks complete but has bad JSON
      const handle = await fs.open(p, "a");
      await handle.write('CORRUPT_LINE_NOT_JSON\n', null, "utf-8");
      await handle.close();

      const { record, truncated } = await readLastValidLine(p);
      expect(record).not.toBeNull();
      expect(record!.seq).toBe(3);
      expect(truncated).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── runRecovery ─────────────────────────────────────────────────────────────

describe("runRecovery", () => {
  test("Case A: JSONL and checkpoint agree — no update", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const p = path.join(dir, todayFilename());

      await writeJsonlRecords(p, 5); // seq 0..4
      await ckpt.markFlushed("session-A", 4);

      const result = await runRecovery(dir, ckpt, "session-A");
      expect(result.jsonlTailSeq).toBe(4);
      expect(result.checkpointSeq).toBe(4);
      expect(result.checkpointUpdated).toBe(false);
      expect(result.truncated).toBe(false);

      // seq counter must be at 4 so next nextSeq() = 5
      expect(currentSeq()).toBe(4);
    } finally {
      await cleanup(dir);
    }
  });

  test("Case B: JSONL ahead of checkpoint — checkpoint updated", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const p = path.join(dir, todayFilename());

      await writeJsonlRecords(p, 10); // seq 0..9
      await ckpt.markFlushed("session-B", 5); // stale

      const result = await runRecovery(dir, ckpt, "session-B");
      expect(result.jsonlTailSeq).toBe(9);
      expect(result.checkpointSeq).toBe(5);
      expect(result.checkpointUpdated).toBe(true);

      const loaded = await ckpt.loadCheckpoint();
      expect(loaded!.last_flushed_seq).toBe(9);
      expect(currentSeq()).toBe(9);
    } finally {
      await cleanup(dir);
    }
  });

  test("Case C: Checkpoint ahead of JSONL — JSONL wins", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const p = path.join(dir, todayFilename());

      await writeJsonlRecords(p, 3); // seq 0..2
      await ckpt.markFlushed("session-C", 10); // checkpoint claims 10 but JSONL only has 2

      const result = await runRecovery(dir, ckpt, "session-C");
      expect(result.jsonlTailSeq).toBe(2);
      expect(result.checkpointSeq).toBe(10);
      expect(result.checkpointUpdated).toBe(true);

      const loaded = await ckpt.loadCheckpoint();
      expect(loaded!.last_flushed_seq).toBe(2);
      expect(currentSeq()).toBe(2);
    } finally {
      await cleanup(dir);
    }
  });

  test("No JSONL file → seq = -1, checkpoint updated to -1", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("session-D", 5);

      const result = await runRecovery(dir, ckpt, "session-D");
      expect(result.jsonlTailSeq).toBe(-1);
      expect(result.checkpointUpdated).toBe(true);

      const loaded = await ckpt.loadCheckpoint();
      expect(loaded!.last_flushed_seq).toBe(-1);
      expect(currentSeq()).toBe(-1);
    } finally {
      await cleanup(dir);
    }
  });

  test("Empty JSONL file → seq = -1", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await fs.writeFile(path.join(dir, todayFilename()), "", "utf-8");

      const result = await runRecovery(dir, ckpt, "session-E");
      expect(result.jsonlTailSeq).toBe(-1);
      expect(currentSeq()).toBe(-1);
    } finally {
      await cleanup(dir);
    }
  });

  test("Corrupt tail is truncated and seq reconciled", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const p = path.join(dir, todayFilename());

      await writeJsonlRecords(p, 5); // seq 0..4
      // Append a corrupt partial line
      const h = await fs.open(p, "a");
      await h.write("CORRUPT\n", null, "utf-8");
      await h.close();

      const result = await runRecovery(dir, ckpt, "session-F");
      expect(result.truncated).toBe(true);
      expect(result.jsonlTailSeq).toBe(4);
      expect(currentSeq()).toBe(4);
    } finally {
      await cleanup(dir);
    }
  });

  test("After recovery, seq counter is correct for continued writes", async () => {
    const dir = await makeTmpDir();
    try {
      // Simulate: writer ran, wrote seq 0..9, then crashed
      const ckpt = new Checkpoint(dir);
      const p = path.join(dir, todayFilename());
      await writeJsonlRecords(p, 10);
      await ckpt.markFlushed("session-G", 9);

      setSeq(-1); // simulate fresh process start

      await runRecovery(dir, ckpt, "session-G");
      expect(currentSeq()).toBe(9);

      // Next record must have seq = 10
      const { nextSeq } = await import("../src/storage/sessionManager");
      expect(nextSeq()).toBe(10);
    } finally {
      await cleanup(dir);
    }
  });
});
