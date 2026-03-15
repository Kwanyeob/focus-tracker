'use strict';

/**
 * nlp-embeddings.js - Semantic similarity using Xenova/paraphrase-multilingual-MiniLM-L12-v2
 *
 * Produces dense sentence embeddings (384-dim), supports 50+ languages.
 * Cosine similarity on normalized embeddings gives true semantic matching.
 */

let _pipeline = null;
let _importFn = (mod) => import(mod); // injectable for tests

/**
 * Load the embedding pipeline (cached after first call).
 * Downloads ~90MB model on first run, then cached locally.
 * @returns {Promise<Function>}
 */
async function getEmbeddingPipeline() {
  if (_pipeline) return _pipeline;
  const { pipeline } = await _importFn('@xenova/transformers');
  _pipeline = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  return _pipeline;
}

/**
 * Reset cached pipeline (for testing only).
 */
function _resetPipelineForTest() {
  _pipeline = null;
}

/**
 * Override the dynamic import function (for testing only).
 * @param {Function} fn
 */
function _setImportFnForTest(fn) {
  _importFn = fn;
}

/**
 * Get a normalized embedding vector for a text string.
 * @param {Function} extractor
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function embed(extractor, text) {
  const output = await extractor([text], { pooling: 'mean', normalize: true });
  return output.data; // Float32Array of length 384
}

/**
 * Compute cosine similarity between two normalized vectors.
 * Since both are L2-normalized, cosine = dot product.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} -1 to 1
 */
function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Analyze relevance using sentence embeddings.
 * @param {string} goalText
 * @param {string} activityText
 * @param {number} [threshold=0.4]
 * @returns {Promise<{ score: number, isRelevant: boolean, explanation: string, method: string }>}
 */
async function analyzeRelevanceEmbeddings(goalText, activityText, threshold = 0.4) {
  if (!goalText || !activityText) {
    return { score: 0, isRelevant: false, explanation: 'Missing input.', method: 'embeddings' };
  }

  try {
    const extractor = await getEmbeddingPipeline();
    const [goalVec, actVec] = await Promise.all([
      embed(extractor, goalText),
      embed(extractor, activityText),
    ]);

    const raw = dotProduct(goalVec, actVec);
    const score = Math.min(1, Math.max(0, raw));
    const isRelevant = score >= threshold;

    const pct = (score * 100).toFixed(1);
    const explanation = isRelevant
      ? `Semantically similar to goal (${pct}% embedding similarity).`
      : `Low semantic overlap with goal (${pct}% embedding similarity).`;

    return { score, isRelevant, explanation, method: 'embeddings' };
  } catch (err) {
    return { score: 0, isRelevant: false, explanation: `Embedding error: ${err.message}`, method: 'embeddings' };
  }
}

module.exports = { getEmbeddingPipeline, dotProduct, analyzeRelevanceEmbeddings, _resetPipelineForTest, _setImportFnForTest };
