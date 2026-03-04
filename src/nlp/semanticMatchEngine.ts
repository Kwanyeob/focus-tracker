import type { SemanticInput, SemanticOutput } from "./types";

export interface SemanticMatchEngine {
  evaluate(input: SemanticInput): Promise<SemanticOutput>;
}
