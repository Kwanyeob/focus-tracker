import type { NormalizeResult, TitleNormalizer } from "./titleNormalizer";

const DOMAIN_RE = /\b([a-z0-9-]+\.(com|org|net|io|dev|ai|app|co|edu|gov))\b/i;
const WHITESPACE_RE = /\s+/g;
const TAB_COUNT_RE = /^[\(\[]\d+[\)\]]\s*/;
const BADGE_RE = /^[\u2022\u25cf\u00b7\s]+|[\u2022\u25cf\u00b7\s]+$/g;
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const VIEW_COUNT_RE = /\b\d+(?:[\.,]\d+)?\s*(?:k|m|b)?\s*(?:views?|watching|watchers?)\b/g;
const BRACKET_NUMBER_RE = /[\(\[]\s*\d+\s*[\)\]]/g;
const BRACKET_TAG_RE = /[\(\[]\s*(?:4k|8k|hd|uhd|live|new)\s*[\)\]]/g;
const LONG_ID_RE =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{10,})\b/gi;

// Browser app suffix patterns — strip UI chrome from title
const TRAILING_SUFFIX_RE = /\s*-\s*(youtube|google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|safari|brave|opera)\s*$/i;
// Standalone platform tokens to strip when they appear as isolated segments
const PLATFORM_TOKENS = new Set(["chrome", "edge", "firefox", "safari", "brave", "opera"]);

const LEADING_NOISE_RE = /^(watch later|home|for you|trending|subscriptions)\s*-\s*/i;

function stripTrailingSuffixes(input: string): string {
  let s = input;
  while (TRAILING_SUFFIX_RE.test(s)) {
    s = s.replace(TRAILING_SUFFIX_RE, "");
  }
  return s.trim();
}

function cleanCommonNoise(input: string): string {
  let s = input;
  s = s.replace(TAB_COUNT_RE, "");
  s = s.replace(BADGE_RE, "");
  s = s.replace(BRACKET_NUMBER_RE, " ");
  s = s.replace(BRACKET_TAG_RE, " ");
  s = s.replace(TIME_RE, " ");
  s = s.replace(VIEW_COUNT_RE, " ");
  s = s.replace(LONG_ID_RE, " ");
  s = s.replace(WHITESPACE_RE, " ").trim();
  return s;
}

export class TitleNormalizerImpl implements TitleNormalizer {
  normalize(appName: string, windowTitle: string): NormalizeResult {
    const appLower = appName.toLowerCase().trim();
    const rawTitle = (windowTitle || "").toLowerCase().trim();

    const domainMatch = rawTitle.match(DOMAIN_RE);
    const domainHint = domainMatch ? domainMatch[1].toLowerCase() : null;

    let title = cleanCommonNoise(rawTitle);
    title = stripTrailingSuffixes(title);
    title = title.replace(LEADING_NOISE_RE, "").trim();

    // Strip standalone browser/platform tokens that add no semantic value
    title = title
      .split(/\s*-\s*/)
      .filter(Boolean)
      .filter((part) => !PLATFORM_TOKENS.has(part.trim()))
      .join(" ");

    title = title.replace(WHITESPACE_RE, " ").trim();

    let normalizedText = title || appLower;
    if (normalizedText.length > 180) normalizedText = normalizedText.slice(0, 180);

    return {
      normalizedText,
      rawAppName: appName,
      rawWindowTitle: windowTitle,
      domainHint,
    };
  }
}
