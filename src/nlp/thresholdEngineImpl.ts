import type { ThresholdEngine } from "./thresholdEngine";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDb } = require("../storage/sqlite/db");

const FIXED_T_ON  = 0.62;
const FIXED_T_OFF = 0.48;
const T_ON_FLOOR  = 0.50;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS semantic_calibration (
    goal_id        TEXT NOT NULL,
    day_utc        TEXT NOT NULL,
    t_on           REAL NOT NULL,
    t_off          REAL NOT NULL,
    sample_count   INTEGER NOT NULL,
    created_at_utc TEXT NOT NULL,
    PRIMARY KEY (goal_id, day_utc)
  )
`;

const UPSERT_SQL = `
  INSERT INTO semantic_calibration (goal_id, day_utc, t_on, t_off, sample_count, created_at_utc)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(goal_id, day_utc) DO UPDATE SET
    t_on           = excluded.t_on,
    t_off          = excluded.t_off,
    sample_count   = excluded.sample_count,
    created_at_utc = excluded.created_at_utc
`;

const SELECT_SQL = `
  SELECT t_on, t_off FROM semantic_calibration
  WHERE goal_id = ? AND day_utc = ?
`;

function ensureTable(): void {
  getDb().exec(CREATE_TABLE_SQL);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export class ThresholdEngineImpl implements ThresholdEngine {
  async getThresholds(
    goalId: string
  ): Promise<{ tOn: number; tOff: number; mode: "fixed" | "calibrated" }> {
    ensureTable();
    const row = getDb().prepare(SELECT_SQL).get(goalId, todayUtc()) as
      | { t_on: number; t_off: number }
      | undefined;

    if (row) {
      return { tOn: row.t_on, tOff: row.t_off, mode: "calibrated" };
    }
    return { tOn: FIXED_T_ON, tOff: FIXED_T_OFF, mode: "fixed" };
  }

  async updateDailyCalibration(
    goalId: string,
    dayUtc: string,
    scores: number[]
  ): Promise<void> {
    if (scores.length < 100) return;

    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (avg < 0.30) return; // distraction day — skip calibration

    const sorted = [...scores].sort((a, b) => a - b);
    let tOn  = percentile(sorted, 80);
    const tOff = percentile(sorted, 50);

    if (tOn < T_ON_FLOOR) tOn = T_ON_FLOOR;

    ensureTable();
    getDb()
      .prepare(UPSERT_SQL)
      .run(goalId, dayUtc, tOn, tOff, scores.length, new Date().toISOString());
  }
}
