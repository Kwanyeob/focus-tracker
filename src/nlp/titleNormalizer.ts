export interface NormalizeResult {
  normalizedText: string;
  rawAppName: string;
  rawWindowTitle: string;
  domainHint?: string | null;
  tokens?: string[];
}

export interface TitleNormalizer {
  normalize(appName: string, windowTitle: string): NormalizeResult;
}
