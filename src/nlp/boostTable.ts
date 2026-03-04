export interface BoostTable {
  getAppBoost(appName: string, normalizedText: string): number;
  getKeywordBoost(normalizedText: string): number;
}
