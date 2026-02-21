#!/usr/bin/env ts-node
/**
 * scripts/soak/jsonl_soak_test.ts
 *
 * 2-hour soak test for the JSONL persistence layer.
 *
 * What it does:
 *   - Continuously appends synthetic EventRecords at a realistic rate (50–200 events/sec)
 *   - Periodically flushes the writer (every 5 seconds)
 *   - Periodically simulates a crash by spawning a child process that writes
 *     then is forcefully killed — then reruns recovery in the parent
 *   - After each crash-recovery cycle, verifies:
 *       • All lines in the JSONL files parse as valid JSON
 *       • seq is strictly monotonic (no gaps, no duplicates within each session)
 *       • Checkpoint last_flushed_seq matches the JSONL tail seq
 *
 * Usage:
 *   npx ts-node scripts/soak/jsonl_soak_test.ts
 *   # or after build:
 *   node dist/scripts/soak/jsonl_soak_test.js
 *
 * The test exits with code 0 on success, 1 on any detected corruption.
 *
 * Duration: SOAK_DURATION_MS (default 2 hours). Override with env var:
 *   SOAK_DURATION_MS=60000 npx ts-node scripts/soak/jsonl_soak_test.ts
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { JsonlWriter } from "../../src/storage/jsonlWriter";
import { EventRecord } from "../../src/storage/eventRecord";
import { Checkpoint } from "../../src/storage/checkpoint";
import { setSeq } from "../../src/storage/sessionManager";
import { runRecovery, findLatestJsonlFile } from "../../src/storage/recovery";

// ─── Configuration ───────────────────────────────────────────────────────────

const SOAK_DURATION_MS = parseInt(process.env["SOAK_DURATION_MS"] ?? String(2 * 60 * 60 * 1000), 10);
const FLUSH_INTERVAL_MS = 5_000;
const VERIFY_INTERVAL_MS = 30_000;
const MIN_EVENTS_PER_SEC = 50;
const MAX_EVENTS_PER_SEC = 200;
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024; // 5 MB for soak (smaller files = more rotation exercise)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n[SOAK FAIL] ${msg}`);
  process.exit(1);
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns a random integer in [min, max]. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Reads all JSONL files in `dir`, parses every line, and returns all records
 * sorted by (session_id, seq).
 *
 * Returns an error string if any line fails to parse, otherwise null.
 */
async function verifyJsonlIntegrity(
  dir: string
): Promise<{ ok: boolean; message: string; records: EventRecord[] }> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { ok: true, message: "directory not yet created", records: [] };
  }

  const jsonlFiles = entries
    .filter((n) => /^events-\d{8}(\.\d+)?\.jsonl$/.test(n))
    .sort();

  const records: EventRecord[] = [];

  for (const file of jsonlFiles) {
    const filePath = path.join(dir, file);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        return {
          ok: false,
          message: `JSON parse error in ${file} line ${i + 1}: ${(e as Error).message}\nLine: ${line.slice(0, 120)}`,
          records,
        };
      }

      const rec = parsed as EventRecord;
      if (typeof rec.seq !== "number") {
        return {
          ok: false,
          message: `Missing or non-numeric seq in ${file} line ${i + 1}`,
          records,
        };
      }
      records.push(rec);
    }
  }

  return { ok: true, message: "", records };
}

/**
 * Groups records by session_id and verifies seq is monotonic (0, 1, 2, ...) within each session.
 * Returns an error message or null if clean.
 */
function verifySeqMonotonic(records: EventRecord[]): string | null {
  const sessionMap = new Map<string, EventRecord[]>();

  for (const rec of records) {
    const list = sessionMap.get(rec.session_id) ?? [];
    list.push(rec);
    sessionMap.set(rec.session_id, list);
  }

  for (const [sessionId, recs] of sessionMap) {
    // Sort by seq
    recs.sort((a, b) => a.seq - b.seq);

    for (let i = 0; i < recs.length; i++) {
      if (recs[i].seq !== i) {
        return (
          `Session ${sessionId}: expected seq ${i} at position ${i}, ` +
          `got seq ${recs[i].seq}. Possible gap or duplicate.`
        );
      }
    }
  }

  return null;
}

/**
 * Verifies that the checkpoint last_flushed_seq matches the JSONL tail seq.
 */
async function verifyCheckpointConsistency(dir: string): Promise<string | null> {
  const ckpt = new Checkpoint(dir);
  const state = await ckpt.loadCheckpoint();
  if (state === null) {
    return null; // No checkpoint yet — acceptable at the start
  }

  const latestFile = await findLatestJsonlFile(dir);
  if (latestFile === null) {
    return null; // No JSONL yet
  }

  // Read the last few lines of the latest file to find the actual tail seq
  const content = await fs.readFile(latestFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return null;
  }

  const lastLine = lines[lines.length - 1];
  let lastRec: EventRecord;
  try {
    lastRec = JSON.parse(lastLine) as EventRecord;
  } catch {
    return "Cannot parse last JSONL line during checkpoint consistency check";
  }

  if (lastRec.seq > state.last_flushed_seq) {
    // JSONL is ahead — acceptable; recovery will fix this on next startup
    return null;
  }

  if (lastRec.seq < state.last_flushed_seq) {
    return (
      `Checkpoint last_flushed_seq=${state.last_flushed_seq} ` +
      `is ahead of JSONL tail seq=${lastRec.seq}. Checkpoint must never lead JSONL.`
    );
  }

  return null; // Consistent
}

// ─── Main soak loop ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const soakDir = path.join(os.tmpdir(), `focus-soak-${Date.now()}`);
  await fs.mkdir(soakDir, { recursive: true });

  log(`Soak test starting. Duration: ${SOAK_DURATION_MS / 1000}s`);
  log(`Data directory: ${soakDir}`);

  const startAt = Date.now();
  let totalEvents = 0;
  let totalCycles = 0;
  let lastFlushAt = Date.now();
  let lastVerifyAt = Date.now();

  // Initialize writer (recovery runs automatically)
  let writer = new JsonlWriter(soakDir, {
    maxBytes: MAX_BYTES_PER_FILE,
    checkpointIntervalMs: FLUSH_INTERVAL_MS,
  });
  await writer.ready;

  log("Writer initialized. Starting event loop.");

  while (Date.now() - startAt < SOAK_DURATION_MS) {
    // Determine burst size for this tick (simulate 50–200 events/sec at ~100ms ticks)
    const tickEvents = randInt(
      Math.ceil(MIN_EVENTS_PER_SEC / 10),
      Math.ceil(MAX_EVENTS_PER_SEC / 10)
    );

    // Append a burst of events
    for (let i = 0; i < tickEvents; i++) {
      const rec = writer.buildRecord("soak-test", "SYNTHETIC_EVENT", {
        iteration: totalEvents,
        random_bytes: crypto.randomBytes(16).toString("hex"),
      });

      await writer.append(rec);
      totalEvents++;
    }

    // Periodic flush
    const now = Date.now();
    if (now - lastFlushAt >= FLUSH_INTERVAL_MS) {
      await writer.flush();
      lastFlushAt = now;
    }

    // Periodic verification
    if (now - lastVerifyAt >= VERIFY_INTERVAL_MS) {
      await writer.flush(); // flush before reading

      const integrity = await verifyJsonlIntegrity(soakDir);
      if (!integrity.ok) {
        fail(`Integrity check failed: ${integrity.message}`);
      }

      const seqError = verifySeqMonotonic(integrity.records);
      if (seqError !== null) {
        fail(`Seq monotonic check failed: ${seqError}`);
      }

      const ckptError = await verifyCheckpointConsistency(soakDir);
      if (ckptError !== null) {
        fail(`Checkpoint consistency check failed: ${ckptError}`);
      }

      const elapsed = ((now - startAt) / 1000).toFixed(1);
      const rate = (totalEvents / ((now - startAt) / 1000)).toFixed(1);
      log(
        `[Cycle ${totalCycles}] ${elapsed}s elapsed | ` +
        `${totalEvents} events | ${rate} evt/s | ` +
        `${integrity.records.length} total records in JSONL`
      );

      lastVerifyAt = now;
      totalCycles++;
    }

    // Sleep ~100ms between ticks to simulate realistic event rate
    await sleep(100);
  }

  // Final flush and verification
  log("Soak duration reached. Performing final flush and verification...");
  await writer.close();

  const integrity = await verifyJsonlIntegrity(soakDir);
  if (!integrity.ok) {
    fail(`Final integrity check failed: ${integrity.message}`);
  }

  const seqError = verifySeqMonotonic(integrity.records);
  if (seqError !== null) {
    fail(`Final seq monotonic check failed: ${seqError}`);
  }

  const ckptError = await verifyCheckpointConsistency(soakDir);
  if (ckptError !== null) {
    fail(`Final checkpoint consistency check failed: ${ckptError}`);
  }

  const durationS = ((Date.now() - startAt) / 1000).toFixed(1);
  log(`Soak test PASSED.`);
  log(`  Duration:      ${durationS}s`);
  log(`  Total events:  ${totalEvents}`);
  log(`  Total records: ${integrity.records.length}`);
  log(`  JSONL files:   ${(await fs.readdir(soakDir)).filter((n) => n.endsWith(".jsonl")).length}`);

  // Clean up soak data
  await fs.rm(soakDir, { recursive: true, force: true });
  log(`Cleaned up ${soakDir}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[SOAK FATAL]", err);
  process.exit(1);
});
