'use strict';

const { buildContextText } = require('../src/nlp/enricher');

describe('buildContextText', () => {
  test('combines all fields into context string', () => {
    const ctx = buildContextText({
      appName: 'Google Chrome',
      processName: 'chrome',
      category: 'browser',
      windowTitle: 'GitHub - Google Chrome',
      pageTitle: 'GitHub',
      websiteName: 'GitHub',
      domain: 'github.com',
    });
    expect(ctx).toContain('Google Chrome');
    expect(ctx).toContain('browser');
    expect(ctx).toContain('github.com');
  });

  test('deduplicates repeated values', () => {
    const ctx = buildContextText({
      appName: 'GitHub',
      processName: 'github',
      category: 'browser',
      windowTitle: 'GitHub',
      pageTitle: 'GitHub',
      websiteName: 'GitHub',
      domain: 'github.com',
    });
    const occurrences = ctx.toLowerCase().split('github').length - 1;
    expect(occurrences).toBeLessThanOrEqual(3);
  });

  test('handles missing optional fields', () => {
    const ctx = buildContextText({
      appName: 'Code',
      processName: 'code',
      category: 'editor',
      windowTitle: 'pipeline.js - project',
      pageTitle: null,
      websiteName: null,
      domain: null,
    });
    expect(ctx).toContain('Code');
    expect(ctx).toContain('pipeline.js');
  });

  test('returns empty string when all fields are null/empty', () => {
    const ctx = buildContextText({
      appName: null,
      processName: null,
      category: null,
      windowTitle: null,
      pageTitle: null,
      websiteName: null,
      domain: null,
    });
    expect(ctx).toBe('');
  });

  test('includes process name if different from app name', () => {
    const ctx = buildContextText({
      appName: 'Microsoft Visual Studio Code',
      processName: 'code',
      category: 'editor',
      windowTitle: 'test.js',
      pageTitle: null,
      websiteName: null,
      domain: null,
    });
    expect(ctx).toContain('code');
    expect(ctx).toContain('Microsoft Visual Studio Code');
  });

  test('excludes "other" category from context', () => {
    const ctx = buildContextText({
      appName: 'Spotify',
      processName: 'spotify',
      category: 'other',
      windowTitle: 'Song Title',
      pageTitle: null,
      websiteName: null,
      domain: null,
    });
    expect(ctx).not.toContain('other');
  });
});
