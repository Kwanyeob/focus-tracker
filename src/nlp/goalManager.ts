import type { ActiveGoal } from "./types";

export interface SetGoalInput {
  todoText: string;
  appHint?: string;
}

export interface GoalManager {
  setActiveGoal(input: SetGoalInput): Promise<ActiveGoal>;
  getActiveGoal(): Promise<ActiveGoal | null>;
  clearActiveGoal(): Promise<void>;
}
