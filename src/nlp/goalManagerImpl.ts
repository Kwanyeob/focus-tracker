import type { GoalManager, SetGoalInput } from "./goalManager";
import type { ActiveGoal } from "./types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDb } = require("../storage/sqlite/db");

/** Fixed model identifier stored alongside every goal record. */
const DEFAULT_MODEL_ID = "paraphrase-multilingual-MiniLM-L12-v2";

/** Fixed primary key — enforces the single-active-goal invariant. */
const ACTIVE_ROW_ID = "active";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS active_goal (
    id              TEXT PRIMARY KEY,
    text            TEXT NOT NULL,
    todo_text       TEXT NOT NULL DEFAULT '',
    app_hint        TEXT,
    normalized_text TEXT NOT NULL,
    model_id        TEXT NOT NULL,
    created_at_utc  TEXT NOT NULL,
    updated_at_utc  TEXT NOT NULL
  )
`;

const UPSERT_SQL = `
  INSERT INTO active_goal (id, text, todo_text, app_hint, normalized_text, model_id, created_at_utc, updated_at_utc)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    text            = excluded.text,
    todo_text       = excluded.todo_text,
    app_hint        = excluded.app_hint,
    normalized_text = excluded.normalized_text,
    model_id        = excluded.model_id,
    updated_at_utc  = excluded.updated_at_utc
`;

const SELECT_SQL = `SELECT id, text, todo_text, app_hint, normalized_text, model_id, created_at_utc, updated_at_utc
                    FROM active_goal WHERE id = ?`;

const DELETE_SQL = `DELETE FROM active_goal WHERE id = ?`;

function ensureTable(): void {
  getDb().exec(CREATE_TABLE_SQL);
}

function normalizeTodoText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function rowToActiveGoal(row: {
  id: string;
  text: string;
  todo_text: string;
  app_hint: string | null;
  normalized_text: string;
  model_id: string;
  created_at_utc: string;
  updated_at_utc: string;
}): ActiveGoal {
  return {
    id:             row.id,
    text:           row.text,
    todoText:       row.todo_text,
    appHint:        row.app_hint,
    normalizedText: row.normalized_text,
    modelId:        row.model_id,
    createdAtUtc:   row.created_at_utc,
    updatedAtUtc:   row.updated_at_utc,
  };
}

export class GoalManagerImpl implements GoalManager {
  async setActiveGoal(input: SetGoalInput): Promise<ActiveGoal> {
    ensureTable();

    const todoText      = input.todoText.trim();
    const appHint       = input.appHint?.trim() || null;
    const normalizedText = normalizeTodoText(todoText);
    // text = human-readable display string
    const text = appHint ? `${todoText} [app: ${appHint}]` : todoText;
    const now  = new Date().toISOString();

    const existing = getDb().prepare(SELECT_SQL).get(ACTIVE_ROW_ID) as
      | { created_at_utc: string }
      | undefined;
    const createdAt = existing ? existing.created_at_utc : now;

    getDb()
      .prepare(UPSERT_SQL)
      .run(ACTIVE_ROW_ID, text, todoText, appHint, normalizedText, DEFAULT_MODEL_ID, createdAt, now);

    const row = getDb().prepare(SELECT_SQL).get(ACTIVE_ROW_ID) as {
      id: string; text: string; todo_text: string; app_hint: string | null;
      normalized_text: string; model_id: string; created_at_utc: string; updated_at_utc: string;
    };

    return rowToActiveGoal(row);
  }

  async getActiveGoal(): Promise<ActiveGoal | null> {
    ensureTable();

    const row = getDb().prepare(SELECT_SQL).get(ACTIVE_ROW_ID) as
      | { id: string; text: string; todo_text: string; app_hint: string | null;
          normalized_text: string; model_id: string; created_at_utc: string; updated_at_utc: string }
      | undefined;

    return row ? rowToActiveGoal(row) : null;
  }

  async clearActiveGoal(): Promise<void> {
    ensureTable();
    getDb().prepare(DELETE_SQL).run(ACTIVE_ROW_ID);
  }
}
