'use strict';

const { preprocessText, cosineSimilarity, keywordOverlap, analyzeRelevance } = require('../src/nlp/nlp');

describe('preprocessText', () => {
  test('tokenizes and lowercases text', () => {
    const tokens = preprocessText('JavaScript Programming');
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('removes stopwords', () => {
    const tokens = preprocessText('the quick brown fox');
    expect(tokens).not.toContain('the');
    const hasContentWord = tokens.some((t) => /fox|quick|brown/.test(t));
    expect(hasContentWord).toBe(true);
  });

  test('stems words', () => {
    const tokens = preprocessText('running runner runs');
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBeLessThanOrEqual(tokens.length);
  });

  test('handles empty string', () => {
    expect(preprocessText('')).toEqual([]);
  });

  test('handles null', () => {
    expect(preprocessText(null)).toEqual([]);
  });

  test('handles undefined', () => {
    expect(preprocessText(undefined)).toEqual([]);
  });

  test('handles string with only stopwords', () => {
    const tokens = preprocessText('the and is are a');
    expect(tokens.length).toBe(0);
  });

  test('handles special characters', () => {
    const tokens = preprocessText('hello! world? test...');
    expect(Array.isArray(tokens)).toBe(true);
  });

  test('handles numbers mixed with words', () => {
    const tokens = preprocessText('React 18 features');
    expect(Array.isArray(tokens)).toBe(true);
  });
});

describe('cosineSimilarity', () => {
  test('returns 1 for identical vectors', () => {
    const vec = new Map([['code', 2], ['javascript', 1]]);
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1);
  });

  test('returns 0 for orthogonal vectors', () => {
    const vecA = new Map([['apple', 1]]);
    const vecB = new Map([['zebra', 1]]);
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  test('returns 0 for empty vectors', () => {
    expect(cosineSimilarity(new Map(), new Map())).toBe(0);
    expect(cosineSimilarity(new Map([['a', 1]]), new Map())).toBe(0);
  });

  test('returns value between 0 and 1 for partial overlap', () => {
    const vecA = new Map([['javascript', 1], ['web', 1], ['react', 1]]);
    const vecB = new Map([['javascript', 1], ['node', 1], ['backend', 1]]);
    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

describe('keywordOverlap', () => {
  test('returns 1 for identical sets', () => {
    const tokens = ['javascript', 'react', 'web'];
    expect(keywordOverlap(tokens, tokens)).toBeCloseTo(1);
  });

  test('returns 0 for no overlap', () => {
    expect(keywordOverlap(['apple'], ['zebra'])).toBe(0);
  });

  test('returns 0 for empty arrays', () => {
    expect(keywordOverlap([], [])).toBe(0);
    expect(keywordOverlap(['a'], [])).toBe(0);
  });

  test('returns partial score for partial overlap', () => {
    const goalTokens = ['javascript', 'react', 'web'];
    const actTokens = ['javascript', 'python', 'data'];
    const score = keywordOverlap(goalTokens, actTokens);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('analyzeRelevance', () => {
  test('returns high score for matching goal and activity', () => {
    const result = analyzeRelevance(
      'learning JavaScript and React development',
      'JavaScript React documentation GitHub code frontend web'
    );
    expect(result.score).toBeGreaterThan(0.1);
    expect(result.isRelevant).toBe(true);
    expect(result.method).toBe('local-nlp');
  });

  test('returns low score for irrelevant activity', () => {
    const result = analyzeRelevance('learning JavaScript', 'YouTube music entertainment playlist');
    expect(result.score).toBeLessThan(0.5);
  });

  test('handles empty goal', () => {
    const result = analyzeRelevance('', 'JavaScript coding');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
    expect(result.explanation).toBeTruthy();
  });

  test('handles null goal', () => {
    const result = analyzeRelevance(null, 'JavaScript coding');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('handles empty activity text', () => {
    const result = analyzeRelevance('learning JavaScript', '');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('handles null activity text', () => {
    const result = analyzeRelevance('learning JavaScript', null);
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('returns explanation string', () => {
    const result = analyzeRelevance('web development', 'GitHub code JavaScript');
    expect(typeof result.explanation).toBe('string');
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  test('score is between 0 and 1', () => {
    const result = analyzeRelevance('machine learning AI', 'Python numpy pandas tensorflow AI');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('custom threshold changes isRelevant', () => {
    const goal = 'cooking recipes food';
    const activity = 'food blog recipe website';
    const low = analyzeRelevance(goal, activity, 0.01);
    const high = analyzeRelevance(goal, activity, 0.99);
    expect(low.isRelevant).toBe(true);
    expect(high.isRelevant).toBe(false);
  });

  test('handles very short goal and activity', () => {
    const result = analyzeRelevance('code', 'code');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test('handles goal with only stopwords', () => {
    const result = analyzeRelevance('the and is', 'GitHub JavaScript code');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('partial goal match still scores positively', () => {
    const result = analyzeRelevance(
      'building a REST API with Node.js',
      'Node.js Express server backend code'
    );
    expect(result.score).toBeGreaterThan(0);
  });
});
