'use strict';

const natural = require('natural');
const { PorterStemmer } = natural;

// Known distraction domains
const KNOWN_DISTRACTION_DOMAINS = new Set([
  'youtube.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'reddit.com', 'twitch.tv', 'netflix.com', 'hulu.com',
  'disneyplus.com', 'primevideo.com', '9gag.com', 'buzzfeed.com',
  'tumblr.com', 'pinterest.com', 'snapchat.com', 'discord.com',
  'threads.net', 'linkedin.com', 'news.ycombinator.com',
]);

// Vocabulary markers for distraction categories
const DISTRACTION_VOCAB = {
  entertainment: ['movie', 'show', 'episode', 'stream', 'watch', 'anime', 'game', 'play',
                  'trailer', 'clip', 'meme', 'funny', 'viral', 'trending', 'video'],
  social:        ['feed', 'post', 'follow', 'like', 'share', 'retweet', 'story', 'reel',
                  'profile', 'timeline', 'dm', 'notification', 'friend', 'comment'],
  news_binge:    ['breaking', 'latest', 'update', 'politics', 'scandal', 'controversy',
                  'opinion', 'debate', 'headline', 'celebrity'],
  shopping_urge: ['deal', 'sale', 'discount', 'promo', 'limited', 'offer', 'coupon',
                  'wishlist', 'cart', 'checkout', 'buy now'],
};

// Stem all vocab once at module load
const STEMMED_DISTRACTION_VOCAB = {};
for (const [cat, words] of Object.entries(DISTRACTION_VOCAB)) {
  STEMMED_DISTRACTION_VOCAB[cat] = words.map(w => PorterStemmer.stem(w));
}

// URL path patterns that signal distraction
const DISTRACTION_PATH_PATTERNS = [
  /\/watch\b/i,
  /\/video(s)?\b/i,
  /\/reel(s)?\b/i,
  /\/story\b/i,
  /\/stories\b/i,
  /\/feed\b/i,
  /\/trending\b/i,
  /\/explore\b/i,
  /\/shorts\b/i,
  /\/clip(s)?\b/i,
  /\/meme(s)?\b/i,
  /\/games?\b/i,
  /\/play\b/i,
  /\/stream\b/i,
];

/**
 * Detect if a domain/URL represents a distraction given the goal context.
 *
 * @param {string} domain
 * @param {string} url
 * @param {string[]} siteTokens
 * @param {string} goalDomainLabel
 * @returns {{ isDistraction: boolean, confidence: number, reasons: string[] }}
 */
function detectDistraction(domain, url, siteTokens, goalDomainLabel) {
  const reasons = [];
  let score = 0;

  // 1. Known distraction domain
  if (KNOWN_DISTRACTION_DOMAINS.has(domain)) {
    score += 0.5;
    reasons.push('known_distraction_domain');
  }

  // 2. URL path pattern match
  let pathStr = '';
  try {
    pathStr = new URL(url).pathname;
  } catch {
    pathStr = '';
  }
  for (const pattern of DISTRACTION_PATH_PATTERNS) {
    if (pattern.test(pathStr)) {
      score += 0.2;
      reasons.push('distraction_url_pattern:' + pattern.source);
      break;
    }
  }

  // 3. Vocabulary match in site tokens
  const tokenSet = new Set(siteTokens);
  for (const [cat, stemmedWords] of Object.entries(STEMMED_DISTRACTION_VOCAB)) {
    let hits = 0;
    for (const w of stemmedWords) {
      if (tokenSet.has(w)) hits++;
    }
    if (hits >= 2) {
      score += 0.15;
      reasons.push('distraction_vocab:' + cat);
    }
  }

  // 4. Domain label mismatch
  const DISTRACTION_LABELS = new Set(['entertainment', 'social']);
  if (!DISTRACTION_LABELS.has(goalDomainLabel) && siteTokens.length > 0) {
    const entTokens = STEMMED_DISTRACTION_VOCAB.entertainment;
    const socialTokens = STEMMED_DISTRACTION_VOCAB.social;
    const entHits = entTokens.filter(t => tokenSet.has(t)).length;
    const socHits = socialTokens.filter(t => tokenSet.has(t)).length;
    if (entHits + socHits >= 3) {
      score += 0.15;
      reasons.push('site_entertainment_social_heavy');
    }
  }

  const confidence = Math.min(score, 1.0);
  const isDistraction = confidence >= 0.4;

  return { isDistraction, confidence, reasons };
}

/**
 * Check if a domain is in the known distraction list.
 * @param {string} domain
 * @returns {boolean}
 */
function isKnownDistractionDomain(domain) {
  return KNOWN_DISTRACTION_DOMAINS.has(domain);
}

module.exports = { KNOWN_DISTRACTION_DOMAINS, detectDistraction, isKnownDistractionDomain };
