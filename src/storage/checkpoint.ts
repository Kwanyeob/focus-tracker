/**
 * checkpoint.ts
 *
 * Atomic checkpoint protocol for the JSONL persistence layer.
 *
 * Checkpoint file: dirty_state.json
 *
 * CRITICAL: All writes use the atomic tmp + fsync + rename protocol:
 *   1. Write full content to dirty_state.json.tmp
 *   2. fsync the temporary file (flush OS page cache to disk)
 *   3. Rename tmp -> dirty_state.json  (atomic on POSIX; best-effort on Windows)
 *   4. Attempt directory fsync (suppressed on Windows where it is not supported)
 *
 * This guarantees that dirty_state.json is NEVER partially written.
 *
 * JSONL is the source of truth. The checkpoint is a performance hint only.
 * If checkpoint disagrees with the JSONL tail, recovery trusts the JSONL.
 */

import * as fs from "fs/promises";
import * as path from "path";

/** Schema version for the checkpoint file itself. */
const CHECKPOINT_SCHEMA_VERSION = "1.0.0";

/**
 * The persisted shape of dirty_state.json.
 */
export interface CheckpointState {
  /** Schema version for forward-compatibility. */
  schema_version: string;
  /** Session ID that wrote this checkpoint. */
  session_id: string;
  /**
   * The seq of the last record that was successfully flushed to JSONL.
   * -1 means no records have been flushed yet in this session.
   */
  last_flushed_seq: number;
  /** ISO-8601 UTC timestamp of when this checkpoint was written. */
  updated_at: string;
}

/**
 * Manages atomic reads and writes of dirty_state.json.
 */
export class Checkpoint {
  private readonly checkpointPath: string;
  private readonly tmpPath: string;
  private readonly dirPath: string;

  constructor(baseDir: string) {
    this.dirPath = baseDir;
    this.checkpointPath = path.join(baseDir, "dirty_state.json");
    this.tmpPath = path.join(baseDir, "dirty_state.json.tmp");
  }

  /**
   * Reads and parses dirty_state.json.
   * Returns null if the file does not exist or cannot be parsed.
   */
  async loadCheckpoint(): Promise<CheckpointState | null> {
    try {
      const content = await fs.readFile(this.checkpointPath, "utf-8");
      const parsed = JSON.parse(content) as CheckpointState;
      // Basic sanity: last_flushed_seq must be a number
      if (typeof parsed.last_flushed_seq !== "number") {
        return null;
      }
      return parsed;
    } catch {
      // File missing, empty, or corrupt — treat as no checkpoint
      return null;
    }
  }

  /**
   * Atomically writes a new checkpoint marking `seq` as the last flushed sequence.
   *
   * Write order:
   *   write(tmp) -> fdatasync(tmp) -> close(tmp) -> rename(tmp, final) -> [dir fsync]
   */
  async markFlushed(sessionId: string, seq: number): Promise<void> {
    const state: CheckpointState = {
      schema_version: CHECKPOINT_SCHEMA_VERSION,
      session_id: sessionId,
      last_flushed_seq: seq,
      updated_at: new Date().toISOString(),
    };

    const data = JSON.stringify(state, null, 2) + "\n";

    // Step 1 & 2: Write to tmp and fdatasync
    const fd = await fs.open(this.tmpPath, "w");
    try {
      await fd.write(data, 0, "utf-8");
      // fdatasync flushes file data (and enough metadata for recovery)
      await fd.datasync();
    } finally {
      await fd.close();
    }

    // Step 3: Atomic rename
    await fs.rename(this.tmpPath, this.checkpointPath);

    // Step 4: Directory fsync — ensures the rename is visible after a crash.
    // Not supported on Windows (EBADF / EINVAL on directory fds), so we suppress errors.
    try {
      const dirFd = await fs.open(this.dirPath, "r");
      try {
        await dirFd.datasync();
      } finally {
        await dirFd.close();
      }
    } catch {
      // Suppress: Windows does not support directory fsync
    }
  }

  /**
   * Alias for loadCheckpoint(); provided for the explicit "recoverCheckpoint" API surface.
   */
  async recoverCheckpoint(): Promise<CheckpointState | null> {
    return this.loadCheckpoint();
  }

  /**
   * Deletes the checkpoint file (and any leftover .tmp).
   * Used in tests to reset state.
   */
  async deleteCheckpoint(): Promise<void> {
    for (const p of [this.checkpointPath, this.tmpPath]) {
      try {
        await fs.unlink(p);
      } catch {
        // Ignore if not found
      }
    }
  }
}
