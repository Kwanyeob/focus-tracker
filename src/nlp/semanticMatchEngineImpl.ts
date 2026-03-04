import type { SemanticMatchEngine } from "./semanticMatchEngine";
import type { SemanticInput, SemanticOutput, Confidence } from "./types";
import type { GoalManager } from "./goalManager";
import type { TitleNormalizer } from "./titleNormalizer";
import type { EmbeddingService } from "./embeddingService";
import type { BoostTable } from "./boostTable";
import type { ThresholdEngine } from "./thresholdEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function getConfidence(dwellMs: number | undefined): Confidence {
  if (dwellMs === undefined || dwellMs < 10_000) return "low";
  if (dwellMs <= 30_000) return "medium";
  return "high";
}

const UNKNOWN_OUTPUT = (normalizedText: string): SemanticOutput => ({
  goalId: null,
  normalizedText,
  simScore: 0,
  finalScore: 0,
  label: "unknown",
  confidence: "low",
});

// ---------------------------------------------------------------------------
// SemanticMatchEngineImpl
// ---------------------------------------------------------------------------

export class SemanticMatchEngineImpl implements SemanticMatchEngine {
  // In-memory goal vector cache: goalId → vector
  private readonly goalVectorCache = new Map<string, number[]>();

  constructor(
    private readonly goalManager: GoalManager,
    private readonly titleNormalizer: TitleNormalizer,
    private readonly embeddingService: EmbeddingService,
    private readonly boostTable: BoostTable,
    private readonly thresholdEngine: ThresholdEngine,
  ) {}

  async evaluate(input: SemanticInput): Promise<SemanticOutput> {
    // 1) Normalize title first (needed for output even on early returns)
    const { normalizedText } = this.titleNormalizer.normalize(
      input.appName,
      input.windowTitle,
    );

    // 1) Get active goal
    const goal = await this.goalManager.getActiveGoal();
    if (!goal) return UNKNOWN_OUTPUT(normalizedText);

    // 3) Dwell guard
    const dwell = input.dwellMs;
    if (dwell !== undefined && dwell < 2_000) {
      return { ...UNKNOWN_OUTPUT(normalizedText), goalId: goal.id };
    }

    // 4) Embeddings
    let goalVector = this.goalVectorCache.get(goal.id);
    if (!goalVector) {
      goalVector = await this.embeddingService.embed(goal.normalizedText);
      this.goalVectorCache.set(goal.id, goalVector);
    }
    const windowVector = await this.embeddingService.embed(normalizedText);

    const simScore = cosine(goalVector, windowVector);

    // 5) Boosts
    const appBoost = this.boostTable.getAppBoost(input.appName, normalizedText);
    const kwBoost  = this.boostTable.getKeywordBoost(normalizedText);
    const finalScore = clamp(simScore + appBoost + kwBoost, 0, 1);

    // 6) Thresholds
    const { tOn, tOff } = await this.thresholdEngine.getThresholds(goal.id);

    // 7) Label
    const label =
      finalScore >= tOn  ? "on_goal"  :
      finalScore >= tOff ? "related"  :
                           "off_goal";

    // 8) Confidence
    const confidence = getConfidence(dwell);

    // 9) Return
    return {
      goalId: goal.id,
      normalizedText,
      simScore,
      finalScore,
      label,
      confidence,
      thresholdsUsed: { tOn, tOff },
    };
  }
}

/*
 * NOTE — DwellEngine integration:
 *
 * For stable labeling, DwellEngine should pass dwellMs at session close
 * (i.e., when emitting a window_dwell event), not on every tick.
 * The recommended pattern:
 *
 *   1. DwellEngine records start_monotonic_ms when a window becomes active.
 *   2. On window change (or heartbeat), it computes:
 *        dwellMs = end_monotonic_ms - start_monotonic_ms
 *   3. It constructs a SemanticInput with the final dwellMs and calls
 *        semanticMatchEngine.evaluate(input)
 *      so the label benefits from the full dwell duration.
 *   4. Short dwell guards (< 2 s) protect against flicker / accidental focus.
 *   5. Only sessions with dwellMs > 10 s receive medium/high confidence labels
 *      — these are the records worth persisting for daily calibration.
 */
