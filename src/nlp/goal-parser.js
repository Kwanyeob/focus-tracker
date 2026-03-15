'use strict';

const { readFileSync } = require('fs');
const path = require('path');

const CONCEPT_NODES = JSON.parse(readFileSync(path.join(__dirname, 'data/concept-nodes.json'), 'utf8'));

const INTENT_VERB_TABLE = {
  'planning': 'plan', 'plan': 'plan', 'researching': 'learn', 'research': 'learn',
  'learning': 'learn', 'learn': 'learn', 'studying': 'learn', 'study': 'learn',
  'getting': 'improve', 'improving': 'improve', 'improve': 'improve',
  'becoming': 'improve', 'working on': 'build', 'building': 'build', 'build': 'build',
  'coding': 'build', 'writing': 'build', 'developing': 'build', 'making': 'improve',
  'organizing': 'organize', 'managing': 'organize', 'tracking': 'organize',
  'creating': 'build', 'designing': 'build', 'launching': 'build',
  'starting': 'build', 'validating': 'build', 'doing': 'build',
};

const VERB_CONCEPT_MAP = {
  'getting in shape': 'PHYSICAL_FITNESS',
  'losing weight': 'PHYSICAL_FITNESS',
  'getting fit': 'PHYSICAL_FITNESS',
  'working out': 'PHYSICAL_FITNESS',
  'building muscle': 'PHYSICAL_FITNESS',
  'training for': 'PHYSICAL_FITNESS',
  'organizing finances': 'PERSONAL_FINANCE',
  'organizing my finances': 'PERSONAL_FINANCE',
  'managing money': 'PERSONAL_FINANCE',
  'managing my money': 'PERSONAL_FINANCE',
  'budgeting': 'PERSONAL_FINANCE',
  'saving money': 'PERSONAL_FINANCE',
  'paying off debt': 'PERSONAL_FINANCE',
  'investing': 'PERSONAL_FINANCE',
  'tracking expenses': 'PERSONAL_FINANCE',
  'building emergency fund': 'PERSONAL_FINANCE',
  'building a product': 'PRODUCT_DESIGN',
  'working on my product': 'PRODUCT_DESIGN',
  'designing my app': 'PRODUCT_DESIGN',
  'creating a landing page': 'PRODUCT_DESIGN',
  'building my brand': 'PRODUCT_DESIGN',
  'validating my idea': 'PRODUCT_DESIGN',
  'doing user research': 'PRODUCT_DESIGN',
  'making a prototype': 'PRODUCT_DESIGN',
  'building my mvp': 'PRODUCT_DESIGN',
  'creating a pitch deck': 'PRODUCT_DESIGN',
  'growing my business': 'PRODUCT_DESIGN',
  'working on my startup': 'PRODUCT_DESIGN',
  'getting a job': 'CAREER_ADVANCEMENT',
  'job hunting': 'CAREER_ADVANCEMENT',
  'becoming better at interviews': 'CAREER_ADVANCEMENT',
  'preparing for interviews': 'CAREER_ADVANCEMENT',
  'improving my resume': 'CAREER_ADVANCEMENT',
  'networking': 'CAREER_ADVANCEMENT',
  'making apartment nicer': 'HOME_IMPROVEMENT',
  'making my apartment': 'HOME_IMPROVEMENT',
  'decorating': 'HOME_IMPROVEMENT',
  'organizing my space': 'HOME_IMPROVEMENT',
  'furnishing': 'HOME_IMPROVEMENT',
  'renovating': 'HOME_IMPROVEMENT',
  'working on my side project': 'PERSONAL_PROJECT',
  'building an app': 'PERSONAL_PROJECT',
  'coding my project': 'PERSONAL_PROJECT',
  'launching my startup': 'PERSONAL_PROJECT',
  'learning to cook': 'COOKING_SKILLS',
  'learning guitar': 'MUSIC_SKILLS',
  'learning piano': 'MUSIC_SKILLS',
  'learning a language': 'LANGUAGE_LEARNING',
  'studying for exams': 'ACADEMIC_STUDY',
  'getting organized': 'PERSONAL_PRODUCTIVITY',
  'managing my time': 'PERSONAL_PRODUCTIVITY',
  'being more productive': 'PERSONAL_PRODUCTIVITY',
};

const CONCEPT_TO_DOMAIN = {
  'PHYSICAL_FITNESS': 'fitness',
  'PERSONAL_FINANCE': 'finance',
  'CAREER_ADVANCEMENT': 'career',
  'HOME_IMPROVEMENT': 'home',
  'PERSONAL_PROJECT': 'tech',
  'PRODUCT_DESIGN': 'tech',
  'COOKING_SKILLS': 'cooking',
  'MUSIC_SKILLS': 'music',
  'LANGUAGE_LEARNING': 'language',
  'ACADEMIC_STUDY': 'education',
  'PERSONAL_PRODUCTIVITY': 'productivity',
  'HEALTH': 'health',
};

function getConceptTerms(node) {
  if (node.activitySubTypes) {
    const all = [];
    for (const subType of Object.values(node.activitySubTypes)) {
      for (const term of subType.terms) {
        if (!all.includes(term)) all.push(term);
      }
    }
    return all;
  }
  return node.activityTerms || [];
}

function extractIntentVerb(goalText) {
  const verbsSorted = Object.keys(INTENT_VERB_TABLE).sort((a, b) => b.length - a.length);
  for (const verb of verbsSorted) {
    if (goalText.startsWith(verb + ' ') || goalText === verb) {
      return INTENT_VERB_TABLE[verb];
    }
  }
  const firstWord = goalText.split(' ')[0];
  if (INTENT_VERB_TABLE[firstWord]) return INTENT_VERB_TABLE[firstWord];
  return '';
}

function extractEntity(goalText) {
  const prepMatch = goalText.match(/(?:to|for|about|on)\s+([A-Z][a-zA-Z\s]+)/);
  if (prepMatch) return prepMatch[1].trim();
  const prepMatchLower = goalText.match(/(?:to|for|about|on)\s+(\w[\w\s]+)/);
  if (prepMatchLower) return prepMatchLower[1].trim();
  return null;
}

function parseGoal(goalText) {
  const lower = goalText.toLowerCase();
  let concept = null;

  // Step 1: Try verb-concept map (longest match first)
  const phrasesSorted = Object.keys(VERB_CONCEPT_MAP).sort((a, b) => b.length - a.length);
  for (const phrase of phrasesSorted) {
    if (lower.includes(phrase)) {
      concept = VERB_CONCEPT_MAP[phrase];
      break;
    }
  }

  // Step 2: Try concept aliases
  if (!concept) {
    for (const [conceptKey, node] of Object.entries(CONCEPT_NODES)) {
      for (const alias of (node.aliases || [])) {
        if (lower.includes(alias.toLowerCase())) {
          concept = conceptKey;
          break;
        }
      }
      if (concept) break;
    }
  }

  // Step 3: Extract named entity if no concept found
  let entity = null;
  if (!concept) {
    entity = extractEntity(goalText);
  }

  const type = concept ? 'concept' : 'entity';
  const intentVerb = extractIntentVerb(lower);

  let conceptTerms = [];
  let conceptResourceTypes = [];
  let conceptAntiPatterns = [];
  let domainLabel = '';

  if (concept && CONCEPT_NODES[concept]) {
    const node = CONCEPT_NODES[concept];
    conceptTerms = getConceptTerms(node);
    conceptResourceTypes = node.resourceTypes || [];
    conceptAntiPatterns = node.antiPatterns || [];
    domainLabel = CONCEPT_TO_DOMAIN[concept] || '';
  }

  const allRelevantTerms = [...new Set(conceptTerms)];

  return {
    raw: goalText,
    type,
    intentVerb,
    entity,
    entityModifiers: [],
    wikidataTerms: [],
    concept,
    conceptTerms,
    conceptResourceTypes,
    conceptAntiPatterns,
    domainLabel,
    allRelevantTerms,
  };
}

module.exports = { parseGoal, VERB_CONCEPT_MAP, CONCEPT_TO_DOMAIN };
