export interface ThresholdEngine {
  getThresholds(goalId: string): Promise<{ tOn: number; tOff: number; mode: "fixed" | "calibrated" }>;
  updateDailyCalibration(goalId: string, dayUtc: string, scores: number[]): Promise<void>;
}
