import type { BoostTable } from "./boostTable";

const POSITIVE_KEYWORDS = ["leetcode", "pull request", "jira", "design doc", "sql"];
const NEGATIVE_KEYWORDS = ["youtube", "shorts", "netflix", "tiktok", "instagram"];

export class BoostTableImpl implements BoostTable {
  getAppBoost(appName: string, normalizedText: string): number {
    const app = appName.toLowerCase();

    if (app.includes("vscode") || app.includes("visual studio code")) return 0.15;
    if (app.includes("intellij")) return 0.15;
    if (app.includes("terminal") || app.includes("powershell") || app.includes("cmd")) return 0.12;
    if (app.includes("chrome") && normalizedText.includes("leetcode")) return 0.20;
    if (app.includes("youtube")) return -0.30;
    if (app.includes("netflix")) return -0.40;

    return 0;
  }

  getKeywordBoost(normalizedText: string): number {
    const text = normalizedText.toLowerCase();

    for (const kw of POSITIVE_KEYWORDS) {
      if (text.includes(kw)) return 0.10;
    }

    for (const kw of NEGATIVE_KEYWORDS) {
      if (text.includes(kw)) return -0.15;
    }

    return 0;
  }
}
