'use strict';

const natural = require('natural');
const { detectDistraction } = require('./distraction-detector');

const { PorterStemmer } = natural;

// Signal weights for 7-signal fusion
const WEIGHTS = {
  metaConceptOverlap:    0.27,
  wikidataEntityOverlap: 0.18,
  intentAlignment:       0.18,
  distractionSignal:     0.14,
  sequenceCoherence:     0.09,
  embeddingSimilarity:   0.05,
  dwellConfidence:       0.09,
};

// Sub-type weights for metaConceptOverlap
const SUBTYPE_WEIGHTS = {
  activityTerms:   1.0,
  resourceTypes:   0.8,
  relatedConcepts: 0.5,
  antiPatterns:    -0.5,
};

function stemSet(terms) {
  return new Set(
    terms
      .filter(t => typeof t === 'string' && t.length > 0)
      .flatMap(t => t.toLowerCase().split(/\s+/))
      .map(w => PorterStemmer.stem(w))
  );
}

function jaccardOverlap(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeMetaConceptOverlap(goalIntent, siteTokens) {
  const siteSet = stemSet(siteTokens);

  if (!goalIntent.concept && goalIntent.allRelevantTerms.length === 0) return 0;

  const activitySet = stemSet(goalIntent.conceptTerms || goalIntent.allRelevantTerms || []);
  const resourceSet = stemSet(goalIntent.conceptResourceTypes || []);
  const antiSet = stemSet(goalIntent.conceptAntiPatterns || []);
  const relatedSet = new Set();

  let weightedScore = 0;
  let totalWeight = 0;

  if (activitySet.size > 0) {
    const w = Math.abs(SUBTYPE_WEIGHTS.activityTerms);
    weightedScore += w * jaccardOverlap(activitySet, siteSet);
    totalWeight += w;
  }

  if (resourceSet.size > 0) {
    const w = Math.abs(SUBTYPE_WEIGHTS.resourceTypes);
    weightedScore += w * jaccardOverlap(resourceSet, siteSet);
    totalWeight += w;
  }

  if (relatedSet.size > 0) {
    const w = Math.abs(SUBTYPE_WEIGHTS.relatedConcepts);
    weightedScore += w * jaccardOverlap(relatedSet, siteSet);
    totalWeight += w;
  }

  if (antiSet.size > 0) {
    const antiOverlap = jaccardOverlap(antiSet, siteSet);
    const penalty = Math.abs(SUBTYPE_WEIGHTS.antiPatterns) * antiOverlap;
    weightedScore = Math.max(0, weightedScore - penalty * (totalWeight > 0 ? totalWeight : 1));
  }

  return totalWeight > 0 ? Math.min(1, weightedScore / totalWeight) : 0;
}

function computeWikidataEntityOverlap(wikidataTerms, siteTokens) {
  if (!wikidataTerms || wikidataTerms.length === 0) return 0;
  return jaccardOverlap(stemSet(wikidataTerms), stemSet(siteTokens));
}

function computeIntentAlignment(goalIntent, siteMeta) {
  let score = 0;

  if (goalIntent.domainLabel && siteMeta.inferredDomainLabel) {
    if (goalIntent.domainLabel === siteMeta.inferredDomainLabel) score += 0.5;
  }

  const VERB_PURPOSE_MAP = {
    learn:    ['education', 'reference'],
    build:    ['tool', 'reference', 'education'],
    organize: ['tool', 'reference'],
    improve:  ['education', 'reference', 'tool'],
    plan:     ['tool', 'reference'],
  };

  const allowedPurposes = VERB_PURPOSE_MAP[goalIntent.intentVerb] || [];
  if (allowedPurposes.length > 0 && siteMeta.inferredPurpose) {
    if (allowedPurposes.includes(siteMeta.inferredPurpose)) score += 0.5;
  } else if (!goalIntent.intentVerb) {
    score += 0.25;
  }

  return Math.min(1, score);
}

function computeDistractionSignal(siteMeta, goalDomainLabel, url) {
  const { confidence } = detectDistraction(
    siteMeta.domain,
    url,
    siteMeta.normalizedTokens || [],
    goalDomainLabel
  );
  return Math.max(0, 1 - confidence);
}

function computeSequenceCoherence(currentDomain, currentDomainLabel, recentDomainWindow) {
  if (!recentDomainWindow || recentDomainWindow.length === 0) return 0.5;
  if (!currentDomainLabel || currentDomainLabel === 'unknown') return 0.3;
  const matches = recentDomainWindow.filter(label => label === currentDomainLabel).length;
  return Math.min(1, matches / recentDomainWindow.length + 0.1);
}

function computeEmbeddingSimilarity(goalTokens, siteTokens) {
  if (goalTokens.length === 0 || siteTokens.length === 0) return 0;
  const goalSet = new Set(goalTokens);
  const siteSet = new Set(siteTokens);
  let hits = 0;
  for (const t of goalSet) {
    if (siteSet.has(t)) hits++;
  }
  return (2 * hits) / (goalSet.size + siteSet.size);
}

function computeDwellConfidence(dwellMs = 0) {
  if (dwellMs >= 120_000) return 1.0;
  if (dwellMs >= 30_000)  return 0.8;
  if (dwellMs >= 5_000)   return 0.5;
  return 0.2;
}

function buildGoalTokens(goalIntent) {
  const terms = [
    ...(goalIntent.allRelevantTerms || []),
    ...(goalIntent.wikidataTerms || []),
    goalIntent.entity || '',
    goalIntent.domainLabel || '',
  ].filter(Boolean);
  return [...stemSet(terms)];
}

/**
 * Compute relevance score for an activity record against a goal.
 *
 * @param {object} goalIntent - result of parseGoal()
 * @param {object} activityRecord - { url: string, siteMeta: object, dwellMs?: number }
 * @param {string[]} recentDomainWindow
 * @returns {{ score: number, signals: object, isDistraction: boolean, distractionConfidence: number, label: string }}
 */
function computeRelevance(goalIntent, activityRecord, recentDomainWindow = []) {
  const { url, siteMeta } = activityRecord;

  if (!siteMeta) {
    return { score: 0, signals: {}, isDistraction: false, distractionConfidence: 0, label: 'unknown' };
  }

  const siteTokens = siteMeta.normalizedTokens || [];
  const goalDomainLabel = goalIntent.domainLabel || '';

  const s1 = computeMetaConceptOverlap(goalIntent, siteTokens);
  const s2 = computeWikidataEntityOverlap(goalIntent.wikidataTerms, siteTokens);
  const s3 = computeIntentAlignment(goalIntent, siteMeta);
  const s4 = computeDistractionSignal(siteMeta, goalDomainLabel, url || '');
  const s5 = computeSequenceCoherence(siteMeta.domain, siteMeta.inferredDomainLabel, recentDomainWindow);
  const goalTokens = buildGoalTokens(goalIntent);
  const s6 = computeEmbeddingSimilarity(goalTokens, siteTokens);
  const s7 = computeDwellConfidence(activityRecord.dwellMs);

  const signals = {
    metaConceptOverlap:    s1,
    wikidataEntityOverlap: s2,
    intentAlignment:       s3,
    distractionSignal:     s4,
    sequenceCoherence:     s5,
    embeddingSimilarity:   s6,
    dwellConfidence:       s7,
  };

  const score = Math.min(1, Math.max(0,
    s1 * WEIGHTS.metaConceptOverlap +
    s2 * WEIGHTS.wikidataEntityOverlap +
    s3 * WEIGHTS.intentAlignment +
    s4 * WEIGHTS.distractionSignal +
    s5 * WEIGHTS.sequenceCoherence +
    s6 * WEIGHTS.embeddingSimilarity +
    s7 * WEIGHTS.dwellConfidence
  ));

  const distractionResult = detectDistraction(siteMeta.domain, url || '', siteTokens, goalDomainLabel);

  let label;
  if (distractionResult.isDistraction && score < 0.35) {
    label = 'distraction';
  } else if (score >= 0.6) {
    label = 'highly_relevant';
  } else if (score >= 0.35) {
    label = 'relevant';
  } else {
    label = 'irrelevant';
  }

  return {
    score,
    signals,
    isDistraction: distractionResult.isDistraction,
    distractionConfidence: distractionResult.confidence,
    distractionReasons: distractionResult.reasons,
    label,
  };
}

module.exports = { computeRelevance };
