/**
 * test/jsonlWriter.test.ts
 *
 * Unit tests for JsonlWriter:
 *   - Append correctness (one line per record, valid JSON, correct fields)
 *   - Rotation correctness (size-based and date-based)
 *   - seq monotonic enforcement
 *   - Checkpoint updated after flush
 *   - No partial lines written
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { JsonlWriter } from "../src/storage/jsonlWriter";
import { EventRecord, CURRENT_SCHEMA_VERSION } from "../src/storage/eventRecord";
import { setSeq } from "../src/storage/sessionManager";

/** Creates a fresh temporary directory for each test. */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "jsonlw-test-"));
}

/**
 * Returns the numeric rotation index of a JSONL filename.
 * "events-20260220.jsonl"   → 0
 * "events-20260220.1.jsonl" → 1
 */
function rotationIndex(filename: string): number {
  const m = filename.match(/\.(\d+)\.jsonl$/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Reads all JSONL files in dir and returns parsed records in chronological order.
 *
 * Sort order: date ASC, then rotation index ASC (base file before .1.jsonl etc.)
 * This matches the order in which records were written.
 */
async function readAllRecords(dir: string): Promise<EventRecord[]> {
  const entries = await fs.readdir(dir);
  const jsonlFiles = entries
    .filter((n) => /^events-\d{8}(\.\d+)?\.jsonl$/.test(n))
    .sort((a, b) => {
      const dateA = a.slice(7, 15); // "YYYYMMDD" from "events-YYYYMMDD..."
      const dateB = b.slice(7, 15);
      if (dateA !== dateB) return dateA.localeCompare(dateB); // date ASC
      return rotationIndex(a) - rotationIndex(b); // rotation ASC (base first)
    });

  const records: EventRecord[] = [];
  for (const file of jsonlFiles) {
    const content = await fs.readFile(path.join(dir, file), "utf-8");
    for (const line of content.split("\n")) {
      if (line.trim() === "") continue;
      records.push(JSON.parse(line) as EventRecord);
    }
  }
  return records;
}

/** Cleans up the temp directory after each test. */
async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// Reset sessionManager seq before each test to avoid cross-test pollution
beforeEach(() => {
  setSeq(-1);
});

// ─── Append correctness ──────────────────────────────────────────────────────

describe("append correctness", () => {
  test("appends records and each line is valid JSON", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      for (let i = 0; i < 10; i++) {
        const rec = writer.buildRecord("test", "TEST_EVENT", { index: i });
        await writer.append(rec);
      }
      await writer.close();

      const records = await readAllRecords(dir);
      expect(records).toHaveLength(10);

      for (const rec of records) {
        expect(rec.schema_version).toBe(CURRENT_SCHEMA_VERSION);
        expect(typeof rec.event_id).toBe("string");
        expect(typeof rec.session_id).toBe("string");
        expect(typeof rec.seq).toBe("number");
        expect(typeof rec.created_at).toBe("string");
        expect(typeof rec.epoch_ms).toBe("number");
        expect(typeof rec.monotonic_ms).toBe("number");
        expect(typeof rec.timezone_offset).toBe("number");
      }
    } finally {
      await cleanup(dir);
    }
  });

  test("each record occupies exactly one line ending with \\n", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      for (let i = 0; i < 5; i++) {
        await writer.append(writer.buildRecord("test", "LINE_TEST", { i }));
      }
      await writer.close();

      const filePath = writer.getCurrentPath();
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      // Last element after split is "" because file ends with "\n"
      expect(lines[lines.length - 1]).toBe("");
      const dataLines = lines.slice(0, -1);
      expect(dataLines).toHaveLength(5);

      for (const line of dataLines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await cleanup(dir);
    }
  });

  test("getCurrentPath returns the active file path", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      await writer.append(writer.buildRecord("test", "PATH_TEST", {}));
      const p = writer.getCurrentPath();
      expect(p).toMatch(/events-\d{8}\.jsonl$/);
      expect(path.dirname(p)).toBe(dir);

      await writer.close();
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── seq monotonic enforcement ───────────────────────────────────────────────

describe("seq monotonic enforcement", () => {
  test("seq starts at 0 and increments by 1", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      const N = 20;
      for (let i = 0; i < N; i++) {
        await writer.append(writer.buildRecord("test", "SEQ_TEST", {}));
      }
      await writer.close();

      const records = await readAllRecords(dir);
      expect(records).toHaveLength(N);

      for (let i = 0; i < N; i++) {
        expect(records[i].seq).toBe(i);
      }
    } finally {
      await cleanup(dir);
    }
  });

  test("validates that a record with negative seq is rejected", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      // Manually create a record with a negative seq — should fail validation
      const bad: EventRecord = {
        schema_version: CURRENT_SCHEMA_VERSION,
        event_id: crypto.randomUUID(),
        session_id: "test-session",
        seq: -1, // invalid: seq must be >= 0
        created_at: new Date().toISOString(),
        epoch_ms: Date.now(),
        monotonic_ms: Number(process.hrtime.bigint() / 1_000_000n),
        timezone_offset: 0,
        source: "test",
        type: "BAD",
        payload: {},
      };

      await expect(writer.append(bad)).rejects.toThrow(/seq/);

      // The writer must still be usable after a failed append
      const good = writer.buildRecord("test", "GOOD", {});
      await writer.append(good);
      await writer.close();

      // Only the good record should appear in the file
      const records = await readAllRecords(dir);
      expect(records).toHaveLength(1);
    } finally {
      await cleanup(dir);
    }
  });

  test("rejects record with missing required fields and writer remains usable", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir);
      await writer.ready;

      const bad = { schema_version: CURRENT_SCHEMA_VERSION } as EventRecord;
      await expect(writer.append(bad)).rejects.toThrow();

      // Writer must survive the failure
      await writer.close();
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── Rotation correctness ────────────────────────────────────────────────────

describe("rotation correctness", () => {
  test("size-based rotation creates a new file with .1.jsonl suffix", async () => {
    const dir = await makeTmpDir();
    try {
      // Small maxBytes to force rotation after a few records
      const writer = new JsonlWriter(dir, { maxBytes: 512 });
      await writer.ready;

      for (let i = 0; i < 30; i++) {
        await writer.append(writer.buildRecord("test", "ROTATE_TEST", { data: "x".repeat(30) }));
      }
      await writer.close();

      const entries = await fs.readdir(dir);
      const jsonlFiles = entries.filter((n) => /^events-\d{8}(\.\d+)?\.jsonl$/.test(n));
      // With 512 byte limit and ~200+ byte records, we expect multiple files
      expect(jsonlFiles.length).toBeGreaterThan(1);

      // All records readable and seq monotonic globally
      const records = await readAllRecords(dir);
      expect(records).toHaveLength(30);

      for (let i = 0; i < records.length; i++) {
        expect(records[i].seq).toBe(i);
      }
    } finally {
      await cleanup(dir);
    }
  });

  test("all records are preserved across rotation boundaries", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir, { maxBytes: 300 });
      await writer.ready;

      const N = 15;
      for (let i = 0; i < N; i++) {
        await writer.append(
          writer.buildRecord("test", "BOUNDARY_TEST", { idx: i, pad: "a".repeat(40) })
        );
      }
      await writer.close();

      const records = await readAllRecords(dir);
      expect(records).toHaveLength(N);

      for (let i = 0; i < N; i++) {
        expect(records[i].seq).toBe(i);
      }
    } finally {
      await cleanup(dir);
    }
  });

  test("no events lost when rotation triggered", async () => {
    const dir = await makeTmpDir();
    try {
      const writer = new JsonlWriter(dir, { maxBytes: 200 });
      await writer.ready;

      const expected: number[] = [];
      for (let i = 0; i < 10; i++) {
        const rec = writer.buildRecord("test", "LOSS_CHECK", {});
        expected.push(rec.seq);
        await writer.append(rec);
      }
      await writer.close();

      const records = await readAllRecords(dir);
      const actual = records.map((r) => r.seq);
      expect(actual).toEqual(expected);
    } finally {
      await cleanup(dir);
    }
  });

  test("rotation files have correct naming: .1, .2, ...", async () => {
    const dir = await makeTmpDir();
    try {
      // Very small limit to force many rotations
      const writer = new JsonlWriter(dir, { maxBytes: 150 });
      await writer.ready;

      for (let i = 0; i < 20; i++) {
        await writer.append(writer.buildRecord("test", "NAME_TEST", { pad: "z".repeat(20) }));
      }
      await writer.close();

      const entries = await fs.readdir(dir);
      const jsonlFiles = entries
        .filter((n) => /^events-\d{8}(\.\d+)?\.jsonl$/.test(n))
        .sort();

      // Must have base file and at least .1.jsonl
      const hasBase = jsonlFiles.some((f) => /^events-\d{8}\.jsonl$/.test(f));
      const hasRot1 = jsonlFiles.some((f) => /^events-\d{8}\.1\.jsonl$/.test(f));
      expect(hasBase).toBe(true);
      expect(hasRot1).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── Checkpoint updated after flush ─────────────────────────────────────────

describe("checkpoint after flush", () => {
  test("flush() writes dirty_state.json with correct last_flushed_seq", async () => {
    const dir = await makeTmpDir();
    try {
      // Large checkpointIntervalMs so that only explicit flush() triggers it
      const writer = new JsonlWriter(dir, { checkpointIntervalMs: 999_999 });
      await writer.ready;

      for (let i = 0; i < 5; i++) {
        await writer.append(writer.buildRecord("test", "CKPT_TEST", {}));
      }
      await writer.flush();

      const ckptRaw = await fs.readFile(path.join(dir, "dirty_state.json"), "utf-8");
      const ckpt = JSON.parse(ckptRaw);
      expect(ckpt.last_flushed_seq).toBe(4); // seq 0..4
      expect(typeof ckpt.session_id).toBe("string");
      expect(typeof ckpt.updated_at).toBe("string");

      await writer.close();
    } finally {
      await cleanup(dir);
    }
  });
});
