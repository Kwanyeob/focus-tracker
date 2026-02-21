/**
 * recovery.ts
 *
 * Startup recovery logic for the JSONL persistence layer.
 *
 * JSONL is the source of truth. Checkpoint is a hint. They are reconciled here.
 *
 * Recovery algorithm (per spec §6):
 *
 *   1. Load checkpoint → read last_flushed_seq
 *   2. Find the most recent JSONL file in baseDir
 *   3. Read the last VALID line of that file
 *      - An empty file → last seq = -1 (no records)
 *      - A partial / corrupt last line → truncate the file at the last complete newline
 *   4. Compare JSONL tail seq with checkpoint seq:
 *
 *      Case A: JSONL seq == checkpoint seq
 *        → Consistent. No action needed.
 *
 *      Case B: JSONL seq > checkpoint seq
 *        → Checkpoint is stale. Update checkpoint to JSONL seq.
 *
 *      Case C: JSONL seq < checkpoint seq
 *        → Checkpoint is ahead (crash during append / checkpoint write race).
 *          Accept JSONL as truth. Update checkpoint to JSONL seq.
 *
 *   5. Advance the sessionManager seq counter to JSONL seq so that the next
 *      nextSeq() call correctly continues the sequence.
 *
 * Recovery MUST NEVER create duplicate or skipped seq values.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Checkpoint } from "./checkpoint";
import { EventRecord } from "./eventRecord";
import { setSeq } from "./sessionManager";

/**
 * Result returned by runRecovery() for introspection and testing.
 */
export interface RecoveryResult {
  /** The seq found at the tail of the JSONL file, or -1 if the file was empty/absent. */
  jsonlTailSeq: number;
  /** The last_flushed_seq from the checkpoint, or -1 if no checkpoint existed. */
  checkpointSeq: number;
  /**
   * Whether the JSONL file was truncated because the last line was corrupt/partial.
   */
  truncated: boolean;
  /**
   * Whether the checkpoint was updated to reflect the JSONL tail.
   */
  checkpointUpdated: boolean;
}

/**
 * Parses the rotation index from a JSONL filename.
 * "events-20260220.jsonl"   → 0
 * "events-20260220.1.jsonl" → 1
 * "events-20260220.2.jsonl" → 2
 */
function parseRotationIndex(filename: string): number {
  const m = filename.match(/\.(\d+)\.jsonl$/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Locates the most recently written JSONL file in `baseDir`.
 *
 * Filename format: events-YYYYMMDD.jsonl  or  events-YYYYMMDD.N.jsonl
 *
 * Sort order: date DESC (lexicographic, safe for YYYYMMDD), then rotation index DESC.
 * This returns the file that was written to last.
 *
 * Returns null if no JSONL file is found.
 */
export async function findLatestJsonlFile(baseDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return null;
  }

  const jsonlFiles = entries.filter((name) =>
    /^events-\d{8}(\.\d+)?\.jsonl$/.test(name)
  );

  if (jsonlFiles.length === 0) {
    return null;
  }

  // Sort: date DESC, then rotation index DESC so the latest-written file is first
  jsonlFiles.sort((a, b) => {
    const dateA = a.slice(7, 15); // "events-YYYYMMDD..."
    const dateB = b.slice(7, 15);
    if (dateA !== dateB) {
      // YYYYMMDD strings sort correctly as plain strings (DESC)
      return dateB.localeCompare(dateA);
    }
    // Same date — sort by rotation index DESC (higher = newer)
    return parseRotationIndex(b) - parseRotationIndex(a);
  });

  return path.join(baseDir, jsonlFiles[0]);
}

/**
 * Reads the last *valid* (complete, non-empty) line from a file.
 *
 * "Valid" means:
 *   - The line ends with '\n'
 *   - The line parses as JSON with a numeric `seq` field
 *
 * If the file ends with a partial/corrupt line (no trailing newline or bad JSON),
 * that line is removed and the file is physically truncated.
 *
 * Returns an object describing:
 *   - `record`    — the parsed EventRecord of the last valid line, or null
 *   - `truncated` — whether the file was physically truncated
 */
export async function readLastValidLine(
  filePath: string
): Promise<{ record: EventRecord | null; truncated: boolean }> {
  let stat: { size: number };
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { record: null, truncated: false };
  }

  if (stat.size === 0) {
    return { record: null, truncated: false };
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { record: null, truncated: false };
  }

  // Split on newlines. If the file ends with "\n", the last element is "".
  const lines = raw.split("\n");
  const trailingPartial = lines[lines.length - 1];

  let truncated = false;

  if (trailingPartial !== "") {
    // File does not end with "\n" — last line is partial/corrupt.
    // Truncate to the byte offset just after the last complete newline.
    const lastNewlinePos = raw.lastIndexOf("\n");
    if (lastNewlinePos === -1) {
      // No complete line at all — wipe the file
      await fs.truncate(filePath, 0);
      return { record: null, truncated: true };
    }

    const truncateAt = lastNewlinePos + 1;
    await fs.truncate(filePath, truncateAt);
    truncated = true;

    const truncatedContent = raw.slice(0, truncateAt);
    const goodLines = truncatedContent.split("\n");
    goodLines.pop(); // remove trailing ""
    return parseLastValidLine(goodLines, filePath, truncated);
  }

  // File ends with "\n" — pop the trailing empty element
  lines.pop();
  return parseLastValidLine(lines, filePath, truncated);
}

/**
 * Iterates lines from the end to find the last one that parses as a valid EventRecord.
 * Rewrites the file to exclude any corrupt trailing lines.
 */
async function parseLastValidLine(
  lines: string[],
  filePath: string,
  alreadyTruncated: boolean
): Promise<{ record: EventRecord | null; truncated: boolean }> {
  let truncated = alreadyTruncated;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Corrupt line — truncate file to lines[0..i-1]
      const kept = lines.slice(0, i);
      const content = kept.length > 0 ? kept.join("\n") + "\n" : "";
      await fs.writeFile(filePath, content, "utf-8");
      truncated = true;
      continue;
    }

    // Must be an object with a numeric integer seq field
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate["seq"] === "number" &&
      Number.isInteger(candidate["seq"])
    ) {
      return { record: parsed as EventRecord, truncated };
    }

    // Parsed JSON but not an EventRecord — treat as corrupt
    const kept = lines.slice(0, i);
    const content = kept.length > 0 ? kept.join("\n") + "\n" : "";
    await fs.writeFile(filePath, content, "utf-8");
    truncated = true;
  }

  return { record: null, truncated };
}

/**
 * Runs the full startup recovery procedure.
 *
 * This function:
 *   1. Loads the checkpoint
 *   2. Finds and reads the tail of the latest JSONL file
 *   3. Truncates corrupt tails
 *   4. Reconciles seq between checkpoint and JSONL
 *   5. Advances the sessionManager seq counter
 *
 * After this returns, the next call to nextSeq() yields (jsonlTailSeq + 1).
 */
export async function runRecovery(
  baseDir: string,
  checkpoint: Checkpoint,
  sessionId: string
): Promise<RecoveryResult> {
  // Step 1: Load checkpoint
  const ckpt = await checkpoint.loadCheckpoint();
  const checkpointSeq = ckpt !== null ? ckpt.last_flushed_seq : -1;

  // Step 2 & 3: Find latest JSONL file and read its tail
  const latestFile = await findLatestJsonlFile(baseDir);
  let jsonlTailSeq = -1;
  let truncated = false;

  if (latestFile !== null) {
    const { record, truncated: wasTruncated } = await readLastValidLine(latestFile);
    truncated = wasTruncated;
    if (record !== null) {
      jsonlTailSeq = record.seq;
    }
  }

  // Step 4: Reconcile
  // Case A: equal → consistent, no update
  // Case B: JSONL ahead → checkpoint stale, update
  // Case C: checkpoint ahead → checkpoint wrong, update to JSONL
  let checkpointUpdated = false;

  if (jsonlTailSeq !== checkpointSeq) {
    await checkpoint.markFlushed(sessionId, jsonlTailSeq);
    checkpointUpdated = true;
  }

  // Step 5: Advance seq counter so next nextSeq() = jsonlTailSeq + 1
  setSeq(jsonlTailSeq);

  return {
    jsonlTailSeq,
    checkpointSeq,
    truncated,
    checkpointUpdated,
  };
}
