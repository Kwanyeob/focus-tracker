export interface BoostTable {
  getAppBoost(appName: string, appHint: string | null): number;
}
