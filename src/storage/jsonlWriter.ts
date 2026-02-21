/**
 * jsonlWriter.ts
 *
 * Append-only JSONL writer with file rotation, atomic checkpointing,
 * and automatic crash recovery on construction.
 *
 * Guarantees (per spec):
 *   - Each append produces exactly: JSON.stringify(record) + "\n"
 *   - No partial lines written
 *   - Appends are serialized (single-process; awaited sequentially)
 *   - Recovery runs automatically in the constructor (via an async init promise)
 *   - Rotation on date change OR file size exceeds maxBytes
 *   - Checkpoint updated after every periodic flush
 *
 * File naming:
 *   Primary:  events-YYYYMMDD.jsonl
 *   Rotated:  events-YYYYMMDD.1.jsonl, events-YYYYMMDD.2.jsonl, ...
 *
 * Checkpoint file: dirty_state.json  (written atomically via tmp+fsync+rename)
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import {
  EventRecord,
  CURRENT_SCHEMA_VERSION,
  validateEventRecord,
  getTimezoneOffsetMinutes,
} from "./eventRecord";
import { Checkpoint } from "./checkpoint";
import { getSessionId, nextSeq, currentSeq } from "./sessionManager";
import { runRecovery, RecoveryResult } from "./recovery";

export interface JsonlWriterOptions {
  /**
   * Maximum file size in bytes before a size-triggered rotation.
   * Default: 50 MB.
   */
  maxBytes?: number;
  /**
   * Minimum interval (ms) between automatic checkpoint flushes during appends.
   * An explicit flush() always writes the checkpoint immediately.
   * Default: 60_000 (60 seconds).
   */
  checkpointIntervalMs?: number;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_CHECKPOINT_INTERVAL_MS = 60_000;

/** Formats a Date as a YYYYMMDD string in local time (for file naming). */
function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** "events-YYYYMMDD.jsonl" */
function baseFilename(dateKey: string): string {
  return `events-${dateKey}.jsonl`;
}

/** "events-YYYYMMDD.N.jsonl" for rotation index N >= 1 */
function rotatedFilename(dateKey: string, index: number): string {
  return `events-${dateKey}.${index}.jsonl`;
}

/** Returns the numeric rotation index of a JSONL filename, or 0 for the base file. */
function rotationIndex(filename: string): number {
  const m = filename.match(/\.(\d+)\.jsonl$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Returns the current size of `filePath`, or 0 if the file does not exist. */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Append-only JSONL writer.
 *
 * Usage:
 *   const writer = new JsonlWriter("/path/to/data");
 *   await writer.ready;           // wait for recovery to complete (optional but recommended)
 *   await writer.append(record);  // append() also awaits ready internally
 *   await writer.flush();
 *   await writer.close();
 */
export class JsonlWriter {
  private readonly baseDir: string;
  private readonly maxBytes: number;
  private readonly checkpointIntervalMs: number;
  private readonly checkpoint: Checkpoint;

  /** Absolute path to the currently open JSONL file, or "" if none is open. */
  private currentPath: string = "";

  /** Open file handle, or null if no file is currently open. */
  private fileHandle: fs.FileHandle | null = null;

  /** Approximate number of bytes written to the current file by this writer instance. */
  private writtenBytes: number = 0;

  /** Date key (YYYYMMDD) of the currently open file. */
  private currentDateKey: string = "";

  /** Timestamp of the last checkpoint flush (Date.now()). */
  private lastCheckpointFlushAt: number = 0;

  /**
   * Resolves when the async constructor (recovery) completes.
   * Callers may await `writer.ready` before the first append.
   * append() awaits this internally, so it is safe to call without waiting.
   */
  public readonly ready: Promise<RecoveryResult>;

  /**
   * Serialize all appends. Each append chains onto this promise.
   * The queue always settles RESOLVED (never rejected) so that a single
   * bad append does not poison subsequent writes or close().
   */
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(baseDir: string, options?: JsonlWriterOptions) {
    this.baseDir = baseDir;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.checkpointIntervalMs =
      options?.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.checkpoint = new Checkpoint(baseDir);

    // Kick off async initialization immediately.
    this.ready = this._initialize();
  }

  /** Creates the base directory and runs recovery. */
  private async _initialize(): Promise<RecoveryResult> {
    await fs.mkdir(this.baseDir, { recursive: true });
    return this.recoverIfNeeded();
  }

  /**
   * Runs recovery: reconcile JSONL tail with checkpoint and advance the seq counter.
   *
   * Public for testing. The constructor calls this automatically — callers must
   * NOT invoke it again after construction.
   */
  public async recoverIfNeeded(): Promise<RecoveryResult> {
    return runRecovery(this.baseDir, this.checkpoint, getSessionId());
  }

  /** Returns the absolute path of the currently open JSONL file, or "" if none. */
  public getCurrentPath(): string {
    return this.currentPath;
  }

  /**
   * Appends a single EventRecord to the JSONL file.
   *
   * Guarantees:
   *   - Waits for recovery to complete
   *   - Validates the record; rejects if invalid
   *   - Produces exactly one line: JSON.stringify(record) + "\n"
   *   - Rotates on date change or size overflow
   *   - Serializes concurrent callers via the append queue
   *   - A failed append does NOT poison subsequent appends or close()
   */
  public append(record: EventRecord): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Chain onto the queue but ensure the queue always resolves even on error
      this.appendQueue = this.appendQueue.then(async () => {
        try {
          await this._doAppend(record);
          resolve();
        } catch (err) {
          reject(err);
          // Do NOT rethrow — the queue must stay alive for future appends
        }
      });
    });
  }

  private async _doAppend(record: EventRecord): Promise<void> {
    // Ensure recovery completed before the first write
    await this.ready;

    // Validate the record
    validateEventRecord(record);

    const dateKey = formatDateKey(new Date());

    // Date change → close old file and open the new date's file
    if (this.fileHandle !== null && dateKey !== this.currentDateKey) {
      await this._closeCurrent();
      await this._openFileForDate(dateKey);
    }

    // Initial open (first append after construction)
    if (this.fileHandle === null) {
      await this._openFileForDate(dateKey);
    }

    const line = JSON.stringify(record) + "\n";
    const lineBytes = Buffer.byteLength(line, "utf-8");

    // Size-triggered rotation: only when the current file already has content.
    // We never rotate an empty file (that would loop forever for oversized single records).
    if (this.writtenBytes > 0 && this.writtenBytes + lineBytes > this.maxBytes) {
      await this._sizeRotate(dateKey);
    }

    // Write exactly one line
    await this.fileHandle!.write(line, null, "utf-8");
    this.writtenBytes += lineBytes;

    // Periodic checkpoint flush
    const now = Date.now();
    if (now - this.lastCheckpointFlushAt >= this.checkpointIntervalMs) {
      await this._flushCheckpoint(record.seq);
    }
  }

  // ─── File management ────────────────────────────────────────────────────────

  /**
   * Opens the correct JSONL file for `dateKey`.
   *
   * Strategy:
   *   - Find the latest existing file for this date (by rotation index DESC).
   *   - If none: create the base file.
   *   - If existing file is not full (size < maxBytes): resume appending.
   *   - If existing file is full (size >= maxBytes): create the next rotation file.
   */
  private async _openFileForDate(dateKey: string): Promise<void> {
    const latestFile = await this._findLatestFileForDate(dateKey);
    let targetPath: string;

    if (latestFile === null) {
      // No file for this date yet
      targetPath = path.join(this.baseDir, baseFilename(dateKey));
    } else {
      const size = await getFileSize(latestFile);
      if (size < this.maxBytes) {
        // Has room — resume
        targetPath = latestFile;
      } else {
        // Full — create next rotation file
        targetPath = this._nextRotationFilePath(dateKey, latestFile);
      }
    }

    this.fileHandle = await fs.open(targetPath, "a");
    this.currentPath = targetPath;
    this.currentDateKey = dateKey;
    this.writtenBytes = await getFileSize(targetPath);
  }

  /**
   * Size-triggered rotation: closes the current file and directly opens the
   * next rotation file, bypassing the "find latest" logic used by _openFileForDate.
   *
   * This avoids the bug where _openFileForDate would reopen the old file
   * (because its on-disk size hasn't yet exceeded maxBytes — we pre-check before write).
   */
  private async _sizeRotate(dateKey: string): Promise<void> {
    const prevPath = this.currentPath; // capture before close
    await this._closeCurrent();
    const nextPath = this._nextRotationFilePath(dateKey, prevPath);
    this.fileHandle = await fs.open(nextPath, "a");
    this.currentPath = nextPath;
    // currentDateKey is unchanged (same date)
    this.writtenBytes = 0; // new file is empty
  }

  /**
   * Closes the current file handle (with fsync).
   * Resets fileHandle, currentPath, currentDateKey, writtenBytes.
   */
  private async _closeCurrent(): Promise<void> {
    if (this.fileHandle !== null) {
      await this.fileHandle.datasync();
      await this.fileHandle.close();
      this.fileHandle = null;
    }
    this.currentPath = "";
    this.currentDateKey = "";
    this.writtenBytes = 0;
  }

  /**
   * Finds the file with the highest rotation index for `dateKey` in baseDir.
   * Returns null if no file for this date exists.
   */
  private async _findLatestFileForDate(dateKey: string): Promise<string | null> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch {
      return null;
    }

    const files = entries.filter((n) => {
      const m = n.match(/^events-(\d{8})(?:\.(\d+))?\.jsonl$/);
      return m !== null && m[1] === dateKey;
    });

    if (files.length === 0) return null;

    // Sort by rotation index DESC; highest = most recently created for this date
    files.sort((a, b) => rotationIndex(b) - rotationIndex(a));

    return path.join(this.baseDir, files[0]);
  }

  /**
   * Computes the path for the next rotation file after `currentFilePath`.
   * "events-YYYYMMDD.jsonl"   → "events-YYYYMMDD.1.jsonl"
   * "events-YYYYMMDD.1.jsonl" → "events-YYYYMMDD.2.jsonl"
   */
  private _nextRotationFilePath(dateKey: string, currentFilePath: string): string {
    const currentRot = rotationIndex(path.basename(currentFilePath));
    const nextRot = currentRot + 1;
    return path.join(this.baseDir, rotatedFilename(dateKey, nextRot));
  }

  // ─── Flush, checkpoint, close ────────────────────────────────────────────────

  /**
   * Flushes OS buffers for the current file and writes a checkpoint.
   * Waits for any pending append to complete first.
   */
  public async flush(): Promise<void> {
    // Drain the append queue before fsyncing
    await this.appendQueue;

    if (this.fileHandle !== null) {
      await this.fileHandle.datasync();
    }

    const seq = currentSeq();
    if (seq >= 0) {
      await this._flushCheckpoint(seq);
    }
  }

  /** Atomically writes the checkpoint for `seq`. */
  private async _flushCheckpoint(seq: number): Promise<void> {
    await this.checkpoint.markFlushed(getSessionId(), seq);
    this.lastCheckpointFlushAt = Date.now();
  }

  /**
   * Flushes and closes the writer.
   * After close(), this instance must not be used.
   */
  public async close(): Promise<void> {
    await this.flush();

    if (this.fileHandle !== null) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  // ─── Convenience factory ─────────────────────────────────────────────────────

  /**
   * Builds a minimal EventRecord envelope ready for append.
   *
   * Callers supply `source`, `type`, and `payload`. All infrastructure fields
   * (event_id, session_id, seq, timestamps) are populated automatically.
   *
   * monotonic_ms is derived from process.hrtime.bigint() as required by spec.
   */
  public buildRecord(
    source: string,
    type: string,
    payload: Record<string, unknown>
  ): EventRecord {
    const now = new Date();
    // Spec: monotonic_ms MUST be Number(hrtime / 1_000_000n), not from wall clock
    const monotonicMs = Number(process.hrtime.bigint() / 1_000_000n);

    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      event_id: crypto.randomUUID(),
      session_id: getSessionId(),
      seq: nextSeq(),
      created_at: now.toISOString(),
      epoch_ms: now.getTime(),
      monotonic_ms: monotonicMs,
      timezone_offset: getTimezoneOffsetMinutes(),
      source,
      type,
      payload,
    };
  }
}
