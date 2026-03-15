'use strict';

const { parseGoal, VERB_CONCEPT_MAP, CONCEPT_TO_DOMAIN } = require('../src/nlp/goal-parser');

describe('parseGoal - concept detection', () => {
  test('detects PHYSICAL_FITNESS from "getting in shape"', () => {
    const result = parseGoal('getting in shape');
    expect(result.concept).toBe('PHYSICAL_FITNESS');
    expect(result.domainLabel).toBe('fitness');
  });

  test('detects PERSONAL_FINANCE from "budgeting"', () => {
    const result = parseGoal('budgeting my monthly expenses');
    expect(result.concept).toBe('PERSONAL_FINANCE');
    expect(result.domainLabel).toBe('finance');
  });

  test('detects CAREER_ADVANCEMENT from "getting a job"', () => {
    const result = parseGoal('getting a job in tech');
    expect(result.concept).toBe('CAREER_ADVANCEMENT');
    expect(result.domainLabel).toBe('career');
  });

  test('detects HOME_IMPROVEMENT from "decorating"', () => {
    const result = parseGoal('decorating my living room');
    expect(result.concept).toBe('HOME_IMPROVEMENT');
    expect(result.domainLabel).toBe('home');
  });

  test('detects COOKING_SKILLS from "learning to cook"', () => {
    const result = parseGoal('learning to cook Italian food');
    expect(result.concept).toBe('COOKING_SKILLS');
    expect(result.domainLabel).toBe('cooking');
  });

  test('detects MUSIC_SKILLS from "learning guitar"', () => {
    const result = parseGoal('learning guitar for beginners');
    expect(result.concept).toBe('MUSIC_SKILLS');
    expect(result.domainLabel).toBe('music');
  });

  test('detects LANGUAGE_LEARNING from "learning a language"', () => {
    const result = parseGoal('learning a language like Spanish');
    expect(result.concept).toBe('LANGUAGE_LEARNING');
    expect(result.domainLabel).toBe('language');
  });

  test('detects ACADEMIC_STUDY from "studying for exams"', () => {
    const result = parseGoal('studying for exams next week');
    expect(result.concept).toBe('ACADEMIC_STUDY');
    expect(result.domainLabel).toBe('education');
  });

  test('detects PERSONAL_PRODUCTIVITY from "getting organized"', () => {
    const result = parseGoal('getting organized and managing tasks');
    expect(result.concept).toBe('PERSONAL_PRODUCTIVITY');
    expect(result.domainLabel).toBe('productivity');
  });

  test('detects PERSONAL_PROJECT from "building an app"', () => {
    const result = parseGoal('building an app for my portfolio');
    expect(result.concept).toBe('PERSONAL_PROJECT');
  });
});

describe('parseGoal - intent verb extraction', () => {
  test('extracts "learn" from "learning"', () => {
    const result = parseGoal('learning Python programming');
    expect(result.intentVerb).toBe('learn');
  });

  test('extracts "build" from "building"', () => {
    const result = parseGoal('building a website');
    expect(result.intentVerb).toBe('build');
  });

  test('extracts "plan" from "planning"', () => {
    const result = parseGoal('planning my week schedule');
    expect(result.intentVerb).toBe('plan');
  });

  test('extracts "improve" from "improving"', () => {
    const result = parseGoal('improving my public speaking skills');
    expect(result.intentVerb).toBe('improve');
  });

  test('extracts "organize" from "organizing"', () => {
    const result = parseGoal('organizing my workspace and files');
    expect(result.intentVerb).toBe('organize');
  });
});

describe('parseGoal - result structure', () => {
  test('always returns required fields', () => {
    const result = parseGoal('learning JavaScript');
    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('intentVerb');
    expect(result).toHaveProperty('concept');
    expect(result).toHaveProperty('conceptTerms');
    expect(result).toHaveProperty('conceptResourceTypes');
    expect(result).toHaveProperty('conceptAntiPatterns');
    expect(result).toHaveProperty('domainLabel');
    expect(result).toHaveProperty('allRelevantTerms');
    expect(result).toHaveProperty('wikidataTerms');
  });

  test('raw field preserves original text', () => {
    const text = 'Improving my Resume for Tech Jobs';
    const result = parseGoal(text);
    expect(result.raw).toBe(text);
  });

  test('conceptTerms is array when concept found', () => {
    const result = parseGoal('getting in shape');
    expect(Array.isArray(result.conceptTerms)).toBe(true);
    expect(result.conceptTerms.length).toBeGreaterThan(0);
  });

  test('conceptTerms includes fitness-related terms for fitness concept', () => {
    const result = parseGoal('getting in shape');
    const terms = result.conceptTerms.map(t => t.toLowerCase());
    const hasFitnessTerms = terms.some(t =>
      ['workout', 'exercise', 'fitness', 'nutrition', 'gym', 'cardio'].includes(t)
    );
    expect(hasFitnessTerms).toBe(true);
  });

  test('wikidataTerms defaults to empty array', () => {
    const result = parseGoal('learning Python');
    expect(Array.isArray(result.wikidataTerms)).toBe(true);
  });
});

describe('parseGoal - entity fallback', () => {
  test('falls back to entity extraction for unknown goals', () => {
    const result = parseGoal('researching about quantum computing');
    expect(result.type === 'entity' || result.concept !== null).toBe(true);
  });

  test('handles empty string without throwing', () => {
    expect(() => parseGoal('')).not.toThrow();
    const result = parseGoal('');
    expect(result).toBeDefined();
    expect(result.raw).toBe('');
  });

  test('handles very long goal text without throwing', () => {
    const longGoal = 'learning JavaScript '.repeat(50);
    expect(() => parseGoal(longGoal)).not.toThrow();
  });
});

describe('CONCEPT_TO_DOMAIN mapping', () => {
  test('all VERB_CONCEPT_MAP values exist in CONCEPT_TO_DOMAIN', () => {
    const concepts = new Set(Object.values(VERB_CONCEPT_MAP));
    for (const concept of concepts) {
      expect(CONCEPT_TO_DOMAIN).toHaveProperty(concept);
    }
  });
});
