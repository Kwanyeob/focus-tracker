/**
 * test/checkpoint.test.ts
 *
 * Unit tests for the atomic checkpoint protocol:
 *   - loadCheckpoint returns null when file absent
 *   - markFlushed writes a valid dirty_state.json
 *   - markFlushed is atomic (no .tmp file left behind)
 *   - markFlushed overwrites previous checkpoint correctly
 *   - recoverCheckpoint returns same data as loadCheckpoint
 *   - Checkpoint file is never partially written (simulated by inspecting .tmp absence)
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { Checkpoint, CheckpointState } from "../src/storage/checkpoint";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ckpt-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── loadCheckpoint ───────────────────────────────────────────────────────────

describe("loadCheckpoint", () => {
  test("returns null when dirty_state.json does not exist", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const result = await ckpt.loadCheckpoint();
      expect(result).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });

  test("returns null when dirty_state.json contains invalid JSON", async () => {
    const dir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(dir, "dirty_state.json"), "NOT JSON{{{", "utf-8");
      const ckpt = new Checkpoint(dir);
      const result = await ckpt.loadCheckpoint();
      expect(result).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });

  test("returns null when last_flushed_seq is missing", async () => {
    const dir = await makeTmpDir();
    try {
      await fs.writeFile(
        path.join(dir, "dirty_state.json"),
        JSON.stringify({ schema_version: "1.0.0", session_id: "s1", updated_at: new Date().toISOString() }),
        "utf-8"
      );
      const ckpt = new Checkpoint(dir);
      const result = await ckpt.loadCheckpoint();
      expect(result).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── markFlushed ─────────────────────────────────────────────────────────────

describe("markFlushed", () => {
  test("writes dirty_state.json with correct fields", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("session-abc", 42);

      const raw = await fs.readFile(path.join(dir, "dirty_state.json"), "utf-8");
      const state = JSON.parse(raw) as CheckpointState;

      expect(state.session_id).toBe("session-abc");
      expect(state.last_flushed_seq).toBe(42);
      expect(typeof state.schema_version).toBe("string");
      expect(typeof state.updated_at).toBe("string");
      // updated_at must be a valid ISO date
      expect(isNaN(Date.parse(state.updated_at))).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("no .tmp file remains after markFlushed", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("session-xyz", 7);

      const entries = await fs.readdir(dir);
      const tmpFiles = entries.filter((n) => n.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await cleanup(dir);
    }
  });

  test("overwrites previous checkpoint atomically", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);

      await ckpt.markFlushed("session-1", 10);
      await ckpt.markFlushed("session-1", 20);
      await ckpt.markFlushed("session-1", 30);

      const state = await ckpt.loadCheckpoint();
      expect(state).not.toBeNull();
      expect(state!.last_flushed_seq).toBe(30);

      // Only one checkpoint file should exist
      const entries = await fs.readdir(dir);
      const ckptFiles = entries.filter((n) => n === "dirty_state.json");
      expect(ckptFiles).toHaveLength(1);
    } finally {
      await cleanup(dir);
    }
  });

  test("roundtrip: markFlushed then loadCheckpoint returns identical data", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("roundtrip-session", 99);

      const loaded = await ckpt.loadCheckpoint();
      expect(loaded).not.toBeNull();
      expect(loaded!.session_id).toBe("roundtrip-session");
      expect(loaded!.last_flushed_seq).toBe(99);
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── recoverCheckpoint ───────────────────────────────────────────────────────

describe("recoverCheckpoint", () => {
  test("returns same data as loadCheckpoint", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("recover-session", 55);

      const viaLoad = await ckpt.loadCheckpoint();
      const viaRecover = await ckpt.recoverCheckpoint();

      expect(viaRecover).toEqual(viaLoad);
    } finally {
      await cleanup(dir);
    }
  });

  test("returns null when no checkpoint exists", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      const result = await ckpt.recoverCheckpoint();
      expect(result).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });
});

// ─── Atomicity invariant ─────────────────────────────────────────────────────

describe("atomicity invariant", () => {
  test("dirty_state.json always contains complete valid JSON after markFlushed", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);

      // Write many checkpoints rapidly
      for (let i = 0; i < 50; i++) {
        await ckpt.markFlushed(`session-${i}`, i * 100);
      }

      const raw = await fs.readFile(path.join(dir, "dirty_state.json"), "utf-8");
      // Must parse without error
      expect(() => JSON.parse(raw)).not.toThrow();

      const state = JSON.parse(raw) as CheckpointState;
      expect(state.last_flushed_seq).toBe(49 * 100);
    } finally {
      await cleanup(dir);
    }
  });

  test("deleteCheckpoint removes dirty_state.json", async () => {
    const dir = await makeTmpDir();
    try {
      const ckpt = new Checkpoint(dir);
      await ckpt.markFlushed("del-session", 5);
      await ckpt.deleteCheckpoint();

      const result = await ckpt.loadCheckpoint();
      expect(result).toBeNull();
    } finally {
      await cleanup(dir);
    }
  });
});
