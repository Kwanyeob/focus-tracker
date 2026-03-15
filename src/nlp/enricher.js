'use strict';

/**
 * enricher.js - Build rich context text from activity metadata for NLP analysis.
 *
 * Note: The omc-test enrich() function (which fetched live browser info via CDP)
 * is not migrated here — focus-tracker captures that data via its own capture layer.
 * Only buildContextText() is migrated.
 */

// File extension → semantic keywords for NLP context expansion
const FILE_EXT_KEYWORDS = {
  js:    'javascript web development programming code',
  jsx:   'javascript react web development frontend programming code',
  ts:    'typescript javascript web development programming code',
  tsx:   'typescript react javascript web development frontend code',
  py:    'python programming code development scripting',
  ipynb: 'jupyter python notebook data science machine learning analysis',
  css:   'css styling web design frontend development',
  html:  'html web development frontend markup',
  java:  'java programming backend development code',
  cs:    'csharp dotnet programming development code',
  cpp:   'cpp cplusplus systems programming development code',
  go:    'golang programming backend development code',
  rs:    'rust programming systems development code',
  rb:    'ruby programming development code',
  php:   'php web backend programming development',
  sql:   'database sql query data',
  md:    'markdown documentation writing',
  json:  'json data configuration programming',
  yaml:  'yaml configuration devops infrastructure',
  sh:    'shell bash scripting terminal automation',
};

// Domain → semantic keywords for NLP context expansion
const DOMAIN_KEYWORDS = {
  'youtube.com':          'video entertainment watching streaming music media',
  'netflix.com':          'video entertainment streaming movies television watching',
  'twitch.tv':            'streaming gaming entertainment watching live',
  'spotify.com':          'music audio entertainment listening relaxing',
  'twitter.com':          'social media news reading discussion',
  'x.com':                'social media news reading discussion',
  'reddit.com':           'social media discussion community reading',
  'linkedin.com':         'professional networking career job business',
  'github.com':           'code development programming git version control software project',
  'gitlab.com':           'code development programming git version control software',
  'stackoverflow.com':    'programming code development question answer debugging',
  'developer.mozilla.org':'javascript web development documentation reference learning',
  'docs.python.org':      'python programming documentation reference learning',
  'npmjs.com':            'javascript nodejs programming packages libraries development',
  'medium.com':           'reading articles writing blog learning',
  'dev.to':               'programming development articles learning community',
  'google.com':           'search research information',
  'docs.google.com':      'writing document editing collaboration productivity',
  'sheets.google.com':    'spreadsheet data analysis productivity',
  'figma.com':            'design ui ux visual creative interface',
  'notion.so':            'notes productivity planning writing documentation',
  'trello.com':           'project management tasks planning kanban productivity organization',
  'jira.atlassian.com':   'project management tasks planning issues tracking work',
  'slack.com':            'team communication messaging collaboration',
  'discord.com':          'chat communication community gaming voice',
  'chat.openai.com':      'ai artificial intelligence chatbot learning assistant',
  'claude.ai':            'ai artificial intelligence assistant learning',
  'khanacademy.org':      'learning education study course lecture tutorial school student',
  'en.wikipedia.org':     'research information reading reference study learning',
  'wikipedia.org':        'research information reading reference study learning',
  'pubmed.ncbi.nlm.nih.gov': 'medical research clinical study nursing health science',
  'medlineplus.gov':      'medication drug health medical nursing clinical patient',
  'nursingcenter.com':    'nursing patient care clinical health medical procedures',
  'rnpedia.com':          'nursing medication dosage clinical patient care health',
  'coursera.org':         'learning education study course online university',
  'udemy.com':            'learning education study course tutorial skills',
  'edx.org':              'learning education university study academic course',
  'chegg.com':            'study homework help student academic assignment',
  'quizlet.com':          'study flashcards exam review learning student',
  'instagram.com':        'social media photos entertainment browsing distraction',
  'tiktok.com':           'video entertainment social media browsing distraction',
  'amazon.com':           'shopping buying products browsing',
  'zara.com':             'shopping clothing fashion browsing',
  'vercel.com':           'web deployment hosting development cloud frontend',
  'netlify.com':          'web deployment hosting development cloud frontend',
  'aws.amazon.com':       'cloud infrastructure devops backend hosting server',
  'localhost':            'local development server programming testing',
};

// App/process → semantic keywords
const PROCESS_KEYWORDS = {
  winword:  'writing document word processing microsoft office essay assignment school academic homework report',
  excel:    'spreadsheet data analysis microsoft office',
  powerpnt: 'presentation slides study notes review microsoft office',
  outlook:  'email communication microsoft office',
  slack:    'team messaging communication collaboration',
  spotify:  'music entertainment audio relaxing',
  discord:  'chat gaming community voice communication',
  notion:   'notes writing planning productivity',
  figma:    'design ui ux visual interface',
  zoom:     'video call meeting communication',
  teams:    'video call meeting communication microsoft',
};

function expandFileExtensions(windowTitle) {
  if (!windowTitle) return '';
  const matches = windowTitle.match(/\.([a-z]{1,6})\b/gi) ?? [];
  const keywords = new Set();
  for (const m of matches) {
    const ext = m.slice(1).toLowerCase();
    if (FILE_EXT_KEYWORDS[ext]) keywords.add(FILE_EXT_KEYWORDS[ext]);
  }
  return [...keywords].join(' ');
}

/**
 * Build a descriptive context string for NLP analysis from activity metadata.
 *
 * @param {Object} parts
 * @param {string} [parts.appName]
 * @param {string} [parts.windowTitle]
 * @param {string} [parts.pageTitle]
 * @param {string} [parts.domain]
 * @param {string} [parts.websiteName]
 * @param {string} [parts.category]
 * @param {string} [parts.processName]
 * @returns {string}
 */
function buildContextText({ appName, windowTitle, pageTitle, domain, websiteName, category, processName }) {
  const tokens = [];

  if (appName) tokens.push(appName);
  if (processName && processName !== appName?.toLowerCase()) tokens.push(processName);
  if (category && category !== 'other') tokens.push(category);
  if (windowTitle) tokens.push(windowTitle);
  if (pageTitle && pageTitle !== windowTitle) tokens.push(pageTitle);
  if (websiteName) tokens.push(websiteName);
  if (domain) tokens.push(domain);

  const domainKey = domain?.replace(/^www\./, '');
  if (domainKey && DOMAIN_KEYWORDS[domainKey]) {
    tokens.push(DOMAIN_KEYWORDS[domainKey]);
  }

  const procKey = processName?.toLowerCase();
  if (procKey && PROCESS_KEYWORDS[procKey]) {
    tokens.push(PROCESS_KEYWORDS[procKey]);
  }

  const extKeywords = expandFileExtensions(windowTitle);
  if (extKeywords) tokens.push(extKeywords);

  const seen = new Set();
  return tokens
    .filter((t) => {
      const key = t.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

module.exports = { buildContextText };
