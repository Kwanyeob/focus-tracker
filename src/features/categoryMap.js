'use strict';

/**
 * src/features/categoryMap.js
 *
 * App-name → focus category mapping — M-06-FEATURES.
 *
 * Rules are checked in declaration order; the first match wins.
 * Matching is case-insensitive.
 * The fallback category is 'other'.
 *
 * Categories:
 *   code   — IDEs, editors, terminals, dev tools
 *   docs   — note-taking, word processors, spreadsheets, project trackers
 *   video  — streaming services, local media players
 *   social — messaging, social networks, email clients
 *   game   — game clients and known game titles
 *   other  — everything else
 *
 * To customise the mapping without editing this file, set the environment
 * variable FOCUS_TRACKER_CATEGORY_MAP to the path of a JSON file with the
 * same shape as CATEGORY_RULES (array of { pattern: string, category: string }).
 */

const fs = require('fs');

// ─── Built-in rules ───────────────────────────────────────────────────────────

const BUILT_IN_RULES = [
  // ── Code ────────────────────────────────────────────────────────────────────
  { pattern: 'code|vscode|vs code|visual studio code',    category: 'code' },
  { pattern: 'intellij|pycharm|webstorm|goland|clion|rider|datagrip|rubymine', category: 'code' },
  { pattern: 'vim|nvim|neovim|nano|emacs|sublime text|atom|zed', category: 'code' },
  { pattern: 'terminal|iterm|cmd|powershell|bash|zsh|wsl|alacritty|kitty|wezterm|hyper', category: 'code' },
  { pattern: 'xcode|android studio|unity|unreal engine|godot', category: 'code' },
  { pattern: 'postman|insomnia|dbeaver|tableplus|datagrip|pgadmin|sequel pro', category: 'code' },
  { pattern: 'github desktop|sourcetree|fork|gitkraken|tower', category: 'code' },
  { pattern: 'docker desktop|lens|k9s',                   category: 'code' },
  { pattern: 'figma|sketch|zeplin',                       category: 'code' },

  // ── Docs ────────────────────────────────────────────────────────────────────
  { pattern: 'notion|obsidian|roam research|logseq|bear|craft', category: 'docs' },
  { pattern: 'microsoft word|google docs|pages|libreoffice writer', category: 'docs' },
  { pattern: 'acrobat|pdf|preview|foxit|sumatra',         category: 'docs' },
  { pattern: 'microsoft excel|google sheets|numbers|libreoffice calc', category: 'docs' },
  { pattern: 'microsoft powerpoint|google slides|keynote|libreoffice impress', category: 'docs' },
  { pattern: 'confluence|jira|linear|trello|asana|monday|clickup|basecamp', category: 'docs' },
  { pattern: 'evernote|onenote|simplenote',               category: 'docs' },

  // ── Video ────────────────────────────────────────────────────────────────────
  { pattern: 'youtube|netflix|twitch|hulu|disney|prime video|hbo|apple tv', category: 'video' },
  { pattern: 'vlc|mpv|iina|quicktime|windows media player|kmplayer|potplayer', category: 'video' },
  { pattern: 'plex|kodi|infuse|jellyfin|emby',            category: 'video' },
  { pattern: 'zoom|teams|meet|webex|skype',               category: 'video' },

  // ── Social ───────────────────────────────────────────────────────────────────
  { pattern: 'twitter|x\\.com',                           category: 'social' },
  { pattern: 'instagram|facebook|tiktok|pinterest|tumblr|snapchat', category: 'social' },
  { pattern: 'reddit|hackernews|hacker news',             category: 'social' },
  { pattern: 'discord',                                   category: 'social' },
  { pattern: 'slack|microsoft teams|telegram|whatsapp|line|wechat|signal|kakaotalk', category: 'social' },
  { pattern: 'gmail|outlook|mail|thunderbird|apple mail|spark mail', category: 'social' },

  // ── Game ─────────────────────────────────────────────────────────────────────
  { pattern: 'steam|league of legends|lol client|valorant', category: 'game' },
  { pattern: 'overwatch|fortnite|minecraft|roblox|apex legends', category: 'game' },
  { pattern: 'epic games|battle\\.net|origin|ea app|gog galaxy|xbox app', category: 'game' },
  { pattern: 'hearthstone|starcraft|diablo|world of warcraft', category: 'game' },
];

// ─── Rule compilation ─────────────────────────────────────────────────────────

/**
 * Compile a rule list (array of {pattern, category}) into executable matchers.
 * Each compiled rule is { re: RegExp, category: string }.
 *
 * @param {Array<{pattern: string, category: string}>} rules
 * @returns {Array<{re: RegExp, category: string}>}
 */
function _compile(rules) {
  return rules.map(r => ({
    re: new RegExp(r.pattern, 'i'),
    category: r.category,
  }));
}

// Load custom rules from file if configured; merge after built-ins so custom
// rules take precedence (checked first).
let _compiled = null;

function _getRules() {
  if (_compiled) return _compiled;

  let rules = BUILT_IN_RULES;

  const customPath = process.env.FOCUS_TRACKER_CATEGORY_MAP;
  if (customPath) {
    try {
      const custom = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      if (Array.isArray(custom)) {
        // Custom rules prepended so they take precedence over built-ins.
        rules = [...custom, ...BUILT_IN_RULES];
      }
    } catch (err) {
      console.warn('[categoryMap] Could not load custom map from', customPath, '—', err.message);
    }
  }

  _compiled = _compile(rules);
  return _compiled;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Map an app name to a focus category.
 *
 * @param {string} appName
 * @returns {'code'|'docs'|'video'|'social'|'game'|'other'}
 */
function categorize(appName) {
  if (!appName || typeof appName !== 'string') return 'other';
  const rules = _getRules();
  for (const { re, category } of rules) {
    if (re.test(appName)) return category;
  }
  return 'other';
}

module.exports = { categorize, BUILT_IN_RULES };
