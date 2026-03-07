export type SemanticLabel = "on_goal" | "related" | "off_goal" | "unknown";
export type Confidence = "low" | "medium" | "high";

export interface ActiveGoal {
  id: string;
  text: string;
  todoText: string;
  appHint: string | null;
  normalizedText: string;
  modelId: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface SemanticInput {
  appName: string;
  windowTitle: string;
  tsUtc: string;
  timezoneOffset: number;
  monotonicMs: number;
  dwellMs?: number;
}

export interface SemanticOutput {
  goalId: string | null;
  normalizedText: string;
  simScore: number;
  finalScore: number;
  label: SemanticLabel;
  confidence: Confidence;
  thresholdsUsed?: { tOn: number; tOff: number };
}
