'use strict';

const { computeRelevance } = require('../src/nlp/reasoning-scorer');
const { detectDistraction, isKnownDistractionDomain, KNOWN_DISTRACTION_DOMAINS } = require('../src/nlp/distraction-detector');
const { parseGoal } = require('../src/nlp/goal-parser');

function makeSiteMeta(overrides = {}) {
  return {
    domain: 'example.com',
    inferredDomainLabel: 'unknown',
    inferredPurpose: 'unknown',
    normalizedTokens: [],
    ...overrides,
  };
}

describe('computeRelevance - relevant sites score high', () => {
  test('fitness goal + fitness tracker site scores above 0.3', () => {
    const goal = parseGoal('getting in shape');
    const siteMeta = makeSiteMeta({
      domain: 'myfitnesspal.com',
      inferredDomainLabel: 'fitness',
      inferredPurpose: 'tool',
      normalizedTokens: ['calori', 'workout', 'nutrit', 'diet', 'exercis', 'track', 'fit'],
    });
    const result = computeRelevance(goal, { url: 'https://myfitnesspal.com', siteMeta }, ['fitness']);
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.isDistraction).toBe(false);
  });

  test('finance goal + budgeting site scores above 0.3', () => {
    const goal = parseGoal('managing my money');
    const siteMeta = makeSiteMeta({
      domain: 'mint.com',
      inferredDomainLabel: 'finance',
      inferredPurpose: 'tool',
      normalizedTokens: ['budget', 'expens', 'save', 'spend', 'financ', 'track', 'invest'],
    });
    const result = computeRelevance(goal, { url: 'https://mint.com', siteMeta }, ['finance']);
    expect(result.score).toBeGreaterThan(0.3);
  });

  test('tech goal + github site scores above 0.3', () => {
    const goal = parseGoal('building an app');
    const siteMeta = makeSiteMeta({
      domain: 'github.com',
      inferredDomainLabel: 'tech',
      inferredPurpose: 'tool',
      normalizedTokens: ['code', 'repositori', 'commit', 'pull', 'develop', 'programm', 'api'],
    });
    const result = computeRelevance(goal, { url: 'https://github.com', siteMeta }, ['tech']);
    expect(result.score).toBeGreaterThan(0.3);
  });

  test('education goal + khan academy site scores above 0.3', () => {
    const goal = parseGoal('studying for exams');
    const siteMeta = makeSiteMeta({
      domain: 'khanacademy.org',
      inferredDomainLabel: 'education',
      inferredPurpose: 'education',
      normalizedTokens: ['cours', 'learn', 'lesson', 'exercis', 'math', 'scienc', 'student'],
    });
    const result = computeRelevance(goal, { url: 'https://khanacademy.org', siteMeta }, ['education']);
    expect(result.score).toBeGreaterThan(0.3);
  });

  test('career goal + linkedin scores above 0.3', () => {
    const goal = parseGoal('getting a job in tech');
    const siteMeta = makeSiteMeta({
      domain: 'linkedin.com',
      inferredDomainLabel: 'career',
      inferredPurpose: 'social',
      normalizedTokens: ['job', 'recru', 'hir', 'profil', 'career', 'network', 'employ'],
    });
    const result = computeRelevance(goal, { url: 'https://linkedin.com/jobs', siteMeta }, ['career']);
    expect(result.score).toBeGreaterThan(0.3);
  });
});

describe('computeRelevance - distraction sites score low', () => {
  test('fitness goal + youtube scores below 0.35 and flagged', () => {
    const goal = parseGoal('getting in shape');
    const siteMeta = makeSiteMeta({
      domain: 'youtube.com',
      inferredDomainLabel: 'entertainment',
      inferredPurpose: 'entertainment',
      normalizedTokens: ['video', 'watch', 'subscrib', 'stream', 'entertain'],
    });
    const result = computeRelevance(goal, { url: 'https://youtube.com/watch?v=xyz', siteMeta }, ['entertainment']);
    expect(result.score).toBeLessThan(0.35);
    expect(result.isDistraction).toBe(true);
  });

  test('finance goal + netflix scores below 0.35 and flagged', () => {
    const goal = parseGoal('managing my money');
    const siteMeta = makeSiteMeta({
      domain: 'netflix.com',
      inferredDomainLabel: 'entertainment',
      inferredPurpose: 'entertainment',
      normalizedTokens: ['show', 'movi', 'stream', 'watch', 'episod'],
    });
    const result = computeRelevance(goal, { url: 'https://netflix.com', siteMeta }, []);
    expect(result.score).toBeLessThan(0.35);
    expect(result.isDistraction).toBe(true);
  });

  test('study goal + twitter scores below 0.35', () => {
    const goal = parseGoal('studying for exams');
    const siteMeta = makeSiteMeta({
      domain: 'twitter.com',
      inferredDomainLabel: 'social',
      inferredPurpose: 'social',
      normalizedTokens: ['tweet', 'follow', 'feed', 'post', 'like', 'retweet'],
    });
    const result = computeRelevance(goal, { url: 'https://twitter.com', siteMeta }, []);
    expect(result.score).toBeLessThan(0.35);
  });

  test('productivity goal + reddit scores below 0.35', () => {
    const goal = parseGoal('getting organized');
    const siteMeta = makeSiteMeta({
      domain: 'reddit.com',
      inferredDomainLabel: 'social',
      inferredPurpose: 'social',
      normalizedTokens: ['post', 'upvot', 'subreddit', 'comment', 'karma', 'feed'],
    });
    const result = computeRelevance(goal, { url: 'https://reddit.com', siteMeta }, []);
    expect(result.score).toBeLessThan(0.35);
  });
});

describe('computeRelevance - result structure', () => {
  test('always returns required fields', () => {
    const goal = parseGoal('learning JavaScript');
    const siteMeta = makeSiteMeta({ domain: 'mdn.io', inferredDomainLabel: 'tech' });
    const result = computeRelevance(goal, { url: 'https://mdn.io', siteMeta });
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('isDistraction');
    expect(result).toHaveProperty('distractionConfidence');
    expect(result).toHaveProperty('label');
  });

  test('score is between 0 and 1', () => {
    const goal = parseGoal('getting in shape');
    const siteMeta = makeSiteMeta({ normalizedTokens: ['workout', 'gym', 'fit'] });
    const result = computeRelevance(goal, { url: 'https://example.com', siteMeta });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('signals object contains all 7 keys', () => {
    const goal = parseGoal('learning guitar');
    const siteMeta = makeSiteMeta();
    const result = computeRelevance(goal, { url: 'https://example.com', siteMeta });
    expect(result.signals).toHaveProperty('metaConceptOverlap');
    expect(result.signals).toHaveProperty('wikidataEntityOverlap');
    expect(result.signals).toHaveProperty('intentAlignment');
    expect(result.signals).toHaveProperty('distractionSignal');
    expect(result.signals).toHaveProperty('sequenceCoherence');
    expect(result.signals).toHaveProperty('embeddingSimilarity');
    expect(result.signals).toHaveProperty('dwellConfidence');
  });

  test('label is one of expected values', () => {
    const goal = parseGoal('building an app');
    const siteMeta = makeSiteMeta();
    const result = computeRelevance(goal, { url: 'https://example.com', siteMeta });
    expect(['highly_relevant', 'relevant', 'irrelevant', 'distraction']).toContain(result.label);
  });

  test('handles null siteMeta gracefully', () => {
    const goal = parseGoal('learning guitar');
    expect(() => computeRelevance(goal, { url: 'https://example.com', siteMeta: null })).not.toThrow();
    const result = computeRelevance(goal, { url: 'https://example.com', siteMeta: null });
    expect(result.score).toBe(0);
  });

  test('label assigned consistently with score', () => {
    const goal = parseGoal('getting in shape');
    const siteMeta = makeSiteMeta({
      domain: 'gymsite.com',
      inferredDomainLabel: 'fitness',
      inferredPurpose: 'tool',
      normalizedTokens: ['workout', 'exercis', 'gym', 'nutrit', 'cardio', 'muscl', 'fit', 'diet', 'train', 'calori'],
    });
    const result = computeRelevance(goal, { url: 'https://gymsite.com', siteMeta }, ['fitness', 'fitness', 'fitness']);
    if (result.score >= 0.6) {
      expect(result.label).toBe('highly_relevant');
    } else if (result.score >= 0.35) {
      expect(result.label).toBe('relevant');
    } else {
      expect(['irrelevant', 'distraction']).toContain(result.label);
    }
  });
});

describe('detectDistraction - known distraction domains', () => {
  test('youtube.com is flagged as distraction', () => {
    const { isDistraction, confidence } = detectDistraction('youtube.com', 'https://youtube.com', [], 'fitness');
    expect(isDistraction).toBe(true);
    expect(confidence).toBeGreaterThanOrEqual(0.4);
  });

  test('netflix.com is flagged as distraction', () => {
    const { isDistraction } = detectDistraction('netflix.com', 'https://netflix.com', [], 'finance');
    expect(isDistraction).toBe(true);
  });

  test('twitter.com is flagged as distraction', () => {
    const { isDistraction } = detectDistraction('twitter.com', 'https://twitter.com', [], 'education');
    expect(isDistraction).toBe(true);
  });

  test('instagram.com is flagged as distraction', () => {
    const { isDistraction } = detectDistraction('instagram.com', 'https://instagram.com', [], 'career');
    expect(isDistraction).toBe(true);
  });

  test('tiktok.com is flagged as distraction', () => {
    const { isDistraction } = detectDistraction('tiktok.com', 'https://tiktok.com', [], 'productivity');
    expect(isDistraction).toBe(true);
  });
});

describe('detectDistraction - legitimate sites not flagged', () => {
  test('github.com is not flagged as distraction', () => {
    const { isDistraction } = detectDistraction('github.com', 'https://github.com', ['code', 'repositori'], 'tech');
    expect(isDistraction).toBe(false);
  });

  test('khanacademy.org is not flagged as distraction', () => {
    const { isDistraction } = detectDistraction('khanacademy.org', 'https://khanacademy.org', ['learn', 'cours'], 'education');
    expect(isDistraction).toBe(false);
  });

  test('myfitnesspal.com is not flagged as distraction', () => {
    const { isDistraction } = detectDistraction('myfitnesspal.com', 'https://myfitnesspal.com', ['calori', 'workout'], 'fitness');
    expect(isDistraction).toBe(false);
  });
});

describe('detectDistraction - URL path patterns', () => {
  test('/watch path on unknown domain increases confidence', () => {
    const r1 = detectDistraction('somesite.com', 'https://somesite.com/watch?v=abc', [], 'tech');
    const r2 = detectDistraction('somesite.com', 'https://somesite.com/docs', [], 'tech');
    expect(r1.confidence).toBeGreaterThan(r2.confidence);
  });

  test('/feed path increases distraction confidence', () => {
    const r = detectDistraction('somesite.com', 'https://somesite.com/feed', [], 'education');
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe('detectDistraction - result structure', () => {
  test('returns isDistraction boolean, confidence number, reasons array', () => {
    const result = detectDistraction('example.com', 'https://example.com', [], 'fitness');
    expect(typeof result.isDistraction).toBe('boolean');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  test('confidence is between 0 and 1', () => {
    const result = detectDistraction('youtube.com', 'https://youtube.com/watch', ['video', 'watch', 'stream', 'meme', 'fun'], 'fitness');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('isKnownDistractionDomain', () => {
  test('returns true for known domains', () => {
    expect(isKnownDistractionDomain('youtube.com')).toBe(true);
    expect(isKnownDistractionDomain('reddit.com')).toBe(true);
    expect(isKnownDistractionDomain('tiktok.com')).toBe(true);
  });

  test('returns false for legitimate domains', () => {
    expect(isKnownDistractionDomain('github.com')).toBe(false);
    expect(isKnownDistractionDomain('stackoverflow.com')).toBe(false);
    expect(isKnownDistractionDomain('google.com')).toBe(false);
  });
});

describe('KNOWN_DISTRACTION_DOMAINS', () => {
  test('is a Set with at least 10 entries', () => {
    expect(KNOWN_DISTRACTION_DOMAINS instanceof Set).toBe(true);
    expect(KNOWN_DISTRACTION_DOMAINS.size).toBeGreaterThanOrEqual(10);
  });
});
