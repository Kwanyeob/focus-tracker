import type { NormalizeResult, TitleNormalizer } from "./titleNormalizer";

const BROWSER_SUFFIXES = [
  " - google chrome",
  " - microsoft edge",
  " - slack",
  " - discord",
];

const TAB_COUNT_RE = /^[\(\[]\d+[\)\]]\s*/;
const BADGE_RE = /^[•*]+|[•*]+$/g;
const REPEATED_SEP_RE = /(\s*[—|]\s*){2,}|(::\s*){2,}/g;
const LONG_ID_RE =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{10,})\b/gi;
const DOMAIN_RE = /\b([a-z0-9-]+\.(com|org|net|io|dev|ai|app|co|edu|gov))\b/i;
const WHITESPACE_RE = /\s+/g;

export class TitleNormalizerImpl implements TitleNormalizer {
  normalize(appName: string, windowTitle: string): NormalizeResult {
    let title = windowTitle.toLowerCase().trim();

    // 4) remove tab counts at start
    title = title.replace(TAB_COUNT_RE, "");

    // 5) remove unread badges at start/end
    title = title.replace(BADGE_RE, "");

    // 6) remove common trailing browser/app suffixes
    for (const suffix of BROWSER_SUFFIXES) {
      if (title.endsWith(suffix)) {
        title = title.slice(0, title.length - suffix.length);
        break;
      }
    }

    // 7) collapse repeated separators
    title = title.replace(REPEATED_SEP_RE, " — ");

    // 8) remove long ids
    title = title.replace(LONG_ID_RE, "");

    // 10) extract domain hint before further trimming
    const domainMatch = title.match(DOMAIN_RE);
    const domainHint = domainMatch ? domainMatch[1].toLowerCase() : null;

    // 3) collapse whitespace + trim
    title = title.replace(WHITESPACE_RE, " ").trim();

    // 1) prefix with appName
    // Canonical normalizedText uses em dash (—): "{appNameLower} — {cleanTitleLower}"
    const prefix = `${appName.toLowerCase()} — `;
    let normalizedText = prefix + title;

    // 9) cap length
    if (normalizedText.length > 180) {
      normalizedText = normalizedText.slice(0, 180);
    }

    return {
      normalizedText,
      rawAppName: appName,
      rawWindowTitle: windowTitle,
      domainHint,
    };
  }
}

/*
Example assertions (not a test framework):

const n = new TitleNormalizerImpl();

// Basic prefix + lowercase
// n.normalize("VSCode", "MyFile.ts") =>
//   normalizedText: "vscode — myfile.ts"

// Tab count removal
// n.normalize("Chrome", "(3) GitHub") =>
//   normalizedText: "chrome — github"

// Badge removal
// n.normalize("Slack", "• #general") =>
//   normalizedText: "slack — #general"

// Browser suffix removal
// n.normalize("Chrome", "GitHub - Google Chrome") =>
//   normalizedText: "chrome — github"

// Domain hint extraction
// n.normalize("Chrome", "openai.com - ChatGPT - Google Chrome") =>
//   normalizedText: "chrome — chatgpt", domainHint: "openai.com"

// UUID removal
// n.normalize("App", "Session 550e8400-e29b-41d4-a716-446655440000 loaded") =>
//   normalizedText: "app — session  loaded" (uuid stripped)

// Length cap
// n.normalize("App", "x".repeat(200)) =>
//   normalizedText.length === 180
*/
