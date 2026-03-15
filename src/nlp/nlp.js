'use strict';

/**
 * nlp.js - NLP relevance scoring
 *
 * Uses local TF-IDF + cosine similarity from the `natural` library.
 * Optionally enhances scoring with Claude API if ANTHROPIC_API_KEY is set.
 */

const natural = require('natural');

const { WordTokenizer, PorterStemmer } = natural;

const tokenizer = new WordTokenizer();

// Extended English stopwords
const STOPWORDS = new Set([
  ...(natural.stopwords?.words ?? []),
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'then',
  'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either',
  'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'that', 'this', 'these', 'those', 'its', 'my', 'your', 'our',
  'their', 'i', 'me', 'we', 'you', 'he', 'she', 'it', 'they', 'them',
]);

/**
 * Tokenize, lowercase, remove stopwords, and stem a text string.
 * @param {string} text
 * @returns {string[]}
 */
function preprocessText(text) {
  if (!text || typeof text !== 'string') return [];
  const tokens = tokenizer.tokenize(text.toLowerCase()) ?? [];
  return tokens
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => PorterStemmer.stem(t));
}

/**
 * Compute cosine similarity between two term-frequency maps.
 * @param {Map<string,number>} vecA
 * @param {Map<string,number>} vecB
 * @returns {number} 0-1
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA.size || !vecB.size) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weight] of vecA) {
    normA += weight * weight;
    if (vecB.has(term)) {
      dot += weight * vecB.get(term);
    }
  }
  for (const [, weight] of vecB) {
    normB += weight * weight;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build a simple term-frequency map from a token array.
 * @param {string[]} tokens
 * @returns {Map<string,number>}
 */
function buildTfMap(tokens) {
  const map = new Map();
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return map;
}

/**
 * Compute keyword overlap ratio (Jaccard-like).
 * @param {string[]} goalTokens
 * @param {string[]} activityTokens
 * @returns {number} 0-1
 */
function keywordOverlap(goalTokens, activityTokens) {
  if (!goalTokens.length || !activityTokens.length) return 0;
  const goalSet = new Set(goalTokens);
  const actSet = new Set(activityTokens);
  let intersection = 0;
  for (const t of goalSet) {
    if (actSet.has(t)) intersection++;
  }
  const union = new Set([...goalSet, ...actSet]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Analyze how relevant an activity's context text is to the user goal.
 *
 * @param {string} goalText       - User-defined goal string
 * @param {string} activityText   - Concatenated activity context
 * @param {number} [threshold=0.15] - Score threshold for isRelevant
 * @returns {{ score: number, isRelevant: boolean, explanation: string, method: string }}
 */
function analyzeRelevance(goalText, activityText, threshold = 0.15) {
  if (!goalText || typeof goalText !== 'string') {
    return { score: 0, isRelevant: false, explanation: 'Goal is empty or invalid.', method: 'local-nlp' };
  }

  if (!activityText || typeof activityText !== 'string') {
    return { score: 0, isRelevant: false, explanation: 'No activity context available to analyze.', method: 'local-nlp' };
  }

  const goalTokens = preprocessText(goalText);
  const actTokens = preprocessText(activityText);

  if (!goalTokens.length) {
    return { score: 0, isRelevant: false, explanation: 'Goal contains no meaningful keywords after processing.', method: 'local-nlp' };
  }

  if (!actTokens.length) {
    return { score: 0, isRelevant: false, explanation: 'Activity context has no analyzable content.', method: 'local-nlp' };
  }

  const goalVec = buildTfMap(goalTokens);
  const actVec = buildTfMap(actTokens);
  const cosine = cosineSimilarity(goalVec, actVec);
  const overlap = keywordOverlap(goalTokens, actTokens);

  // Weighted combination: cosine (60%) + overlap (40%)
  const score = Math.min(1, cosine * 0.6 + overlap * 0.4);

  const matchedKeywords = goalTokens.filter((t) => actVec.has(t));
  const isRelevant = score >= threshold;

  let explanation;
  if (matchedKeywords.length > 0) {
    explanation = `Matched keywords: [${matchedKeywords.join(', ')}]. Score: ${score.toFixed(3)}.`;
  } else {
    explanation = `No direct keyword match found. Cosine similarity: ${cosine.toFixed(3)}.`;
  }

  return { score, isRelevant, explanation, method: 'local-nlp' };
}

/**
 * Optional: enhance relevance result using Claude API if ANTHROPIC_API_KEY is set.
 * Falls back to local NLP if API call fails or fetch is unavailable.
 *
 * @param {string} goalText
 * @param {string} activityText
 * @param {object} localResult
 * @returns {Promise<object>}
 */
async function analyzeRelevanceWithAPI(goalText, activityText, localResult) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return localResult;

  const fetchFn = globalThis.fetch;
  if (!fetchFn) return localResult;

  try {
    const prompt = `You are an activity relevance analyzer. Determine if the current computer activity is relevant to the user's goal.

User goal: "${goalText}"
Current activity context: "${activityText}"

Respond with ONLY a JSON object: {"score": 0.0-1.0, "isRelevant": true/false, "explanation": "brief reason"}
Where score 0=completely irrelevant, 1=directly working on the goal.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return localResult;

    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return localResult;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : localResult.score,
      isRelevant: typeof parsed.isRelevant === 'boolean' ? parsed.isRelevant : localResult.isRelevant,
      explanation: parsed.explanation ?? localResult.explanation,
      method: 'api-nlp',
    };
  } catch {
    return localResult;
  }
}

module.exports = { preprocessText, cosineSimilarity, keywordOverlap, analyzeRelevance, analyzeRelevanceWithAPI };
