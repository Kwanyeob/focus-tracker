import type { ActiveGoal } from "./types";

export interface GoalManager {
  setActiveGoal(text: string): Promise<ActiveGoal>;
  getActiveGoal(): Promise<ActiveGoal | null>;
  clearActiveGoal(): Promise<void>;
}
