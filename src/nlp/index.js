'use strict';

/**
 * src/nlp/index.js - NLP pipeline entry point
 *
 * Wires together all NLP modules into a single analyzeActivity() function.
 * Future milestone: integrate with featureBuilder.js for goal-relevance scoring.
 */

const { analyzeRelevance, analyzeRelevanceWithAPI } = require('./nlp');
const { analyzeRelevanceEmbeddings } = require('./nlp-embeddings');
const { parseGoal } = require('./goal-parser');
const { computeRelevance } = require('./reasoning-scorer');
const { buildContextText } = require('./enricher');
const { expandEntity } = require('./wikidata-expander');

/**
 * Analyze activity relevance against a user goal.
 *
 * @param {object} activityContext
 * @param {string} [activityContext.appName]
 * @param {string} [activityContext.windowTitle]
 * @param {string} [activityContext.pageTitle]
 * @param {string} [activityContext.domain]
 * @param {string} [activityContext.url]
 * @param {string} [activityContext.websiteName]
 * @param {string} [activityContext.category]
 * @param {string} [activityContext.processName]
 * @param {number} [activityContext.dwellMs]
 * @param {string} goalText - User goal string
 * @param {string[]} [recentDomainWindow] - Recently visited domain labels for sequence coherence
 * @returns {Promise<{ nlp: object, reasoning: object }>}
 */
async function analyzeActivity(activityContext, goalText, recentDomainWindow = []) {
  const contextText = buildContextText(activityContext);
  const goalIntent = parseGoal(goalText);

  const nlp = analyzeRelevance(goalText, contextText);

  const siteMeta = {
    domain: activityContext.domain || '',
    inferredDomainLabel: goalIntent.domainLabel || 'unknown',
    inferredPurpose: 'unknown',
    normalizedTokens: contextText.toLowerCase().split(/\s+/).filter(Boolean),
  };

  const reasoning = computeRelevance(
    goalIntent,
    { url: activityContext.url || '', siteMeta, dwellMs: activityContext.dwellMs },
    recentDomainWindow
  );

  return { nlp, reasoning };
}

module.exports = {
  analyzeActivity,
  analyzeRelevance,
  analyzeRelevanceWithAPI,
  analyzeRelevanceEmbeddings,
  parseGoal,
  computeRelevance,
  buildContextText,
  expandEntity,
};
