'use strict';

const embeddings = require('../src/nlp/nlp-embeddings');
const { dotProduct, analyzeRelevanceEmbeddings, _resetPipelineForTest, _setImportFnForTest } = embeddings;

const mockExtractor = jest.fn();
const mockPipelineFn = jest.fn().mockResolvedValue(mockExtractor);

beforeEach(() => {
  mockExtractor.mockReset();
  mockPipelineFn.mockClear();
  mockPipelineFn.mockResolvedValue(mockExtractor);
  _resetPipelineForTest();
  _setImportFnForTest(() => Promise.resolve({ pipeline: mockPipelineFn }));
});

describe('dotProduct', () => {
  test('identical vectors return 1.0', () => {
    const v = new Float32Array([1, 0, 0]);
    expect(dotProduct(v, v)).toBeCloseTo(1.0);
  });

  test('orthogonal vectors return 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(dotProduct(a, b)).toBeCloseTo(0);
  });

  test('opposite vectors return -1', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(dotProduct(a, b)).toBeCloseTo(-1);
  });

  test('computes correct dot product for arbitrary vectors', () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([0.8, 0.6]);
    expect(dotProduct(a, b)).toBeCloseTo(0.48 + 0.48);
  });

  test('handles zero vector', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 1, 1]);
    expect(dotProduct(a, b)).toBeCloseTo(0);
  });
});

describe('analyzeRelevanceEmbeddings - null/empty guard', () => {
  test('returns score 0 when goalText is empty string', async () => {
    const result = await analyzeRelevanceEmbeddings('', 'some activity');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
    expect(result.method).toBe('embeddings');
  });

  test('returns score 0 when activityText is empty string', async () => {
    const result = await analyzeRelevanceEmbeddings('my goal', '');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('returns score 0 when goalText is null', async () => {
    const result = await analyzeRelevanceEmbeddings(null, 'activity');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });

  test('returns score 0 when activityText is null', async () => {
    const result = await analyzeRelevanceEmbeddings('goal', null);
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
  });
});

describe('analyzeRelevanceEmbeddings - with mocked pipeline', () => {
  test('high similarity vectors produce isRelevant=true above threshold', async () => {
    const vec = new Float32Array([1, 0, 0, 0]);
    mockExtractor.mockResolvedValue({ data: vec });

    const result = await analyzeRelevanceEmbeddings('studying Python', 'Python tutorial', 0.4);
    expect(result.score).toBeGreaterThanOrEqual(0.4);
    expect(result.isRelevant).toBe(true);
    expect(result.method).toBe('embeddings');
    expect(result.explanation).toContain('Semantically similar');
  });

  test('dissimilar vectors produce isRelevant=false', async () => {
    let callCount = 0;
    mockExtractor.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ data: new Float32Array([1, 0]) });
      return Promise.resolve({ data: new Float32Array([0, 1]) });
    });

    const result = await analyzeRelevanceEmbeddings('study math', 'watching Netflix', 0.4);
    expect(result.score).toBeLessThan(0.4);
    expect(result.isRelevant).toBe(false);
    expect(result.explanation).toContain('Low semantic overlap');
  });

  test('custom threshold adjusts isRelevant boundary', async () => {
    let call = 0;
    mockExtractor.mockImplementation(() => {
      call++;
      return Promise.resolve({ data: new Float32Array(call === 1 ? [1, 0] : [0, 1]) });
    });
    const result = await analyzeRelevanceEmbeddings('goal', 'activity', 0.01);
    expect(result.isRelevant).toBe(false);
    expect(result.score).toBeCloseTo(0);
  });

  test('returns error result when pipeline throws', async () => {
    mockExtractor.mockRejectedValue(new Error('model load failed'));

    const result = await analyzeRelevanceEmbeddings('goal', 'activity');
    expect(result.score).toBe(0);
    expect(result.isRelevant).toBe(false);
    expect(result.explanation).toContain('Embedding error');
  });
});
