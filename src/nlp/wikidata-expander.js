'use strict';

/**
 * wikidata-expander.js - Entity expansion via Wikidata API.
 * Uses native fetch (Node 18+). Results cached in-memory for 30 days.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TERMS = 50;
const REQUEST_TIMEOUT = 5000;

// Known entity type QIDs
const QID_COUNTRY = 'Q6256';
const QID_HUMAN = 'Q5';
const QID_DISCIPLINE = 'Q11862829';

// Simple in-memory cache
const _cache = new Map(); // key -> { value, expiresAt }
const _wikidataCacheKeys = new Set();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  if (ttlMs < 0) { _cache.delete(key); _wikidataCacheKeys.delete(key); return; }
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  _wikidataCacheKeys.add(key);
}

async function expandEntity(entity, modifiers = []) {
  if (!entity || typeof entity !== 'string') return [];

  const cacheKey = 'wikidata:' + entity.toLowerCase().trim();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const qid = await searchEntityQID(entity);
    if (!qid) return fallbackExpansion(entity, modifiers);

    const entityTypes = await getEntityType(qid);
    const terms = await fetchEntityTerms(qid, entityTypes, entity, modifiers);

    const result = [...new Set(terms.map(t => t.toLowerCase()))].slice(0, MAX_TERMS);
    cacheSet(cacheKey, result, CACHE_TTL);
    return result;
  } catch {
    return fallbackExpansion(entity, modifiers);
  }
}

function clearWikidataCache() {
  _wikidataCacheKeys.forEach(key => {
    try { cacheSet(key, null, -1); } catch (_) {}
  });
  _wikidataCacheKeys.clear();
}

async function searchEntityQID(entity) {
  const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(entity)}&language=en&format=json&limit=1`;
  const res = await fetchWithBackoff(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!res.ok) return null;
  const data = await res.json();
  const results = data.search;
  if (!results || results.length === 0) return null;
  return results[0].id ?? null;
}

async function getEntityType(qid) {
  const query = `SELECT ?type WHERE { wd:${qid} wdt:P31 ?type } LIMIT 5`;
  const url = SPARQL_ENDPOINT + '?query=' + encodeURIComponent(query) + '&format=json';
  try {
    const res = await fetchWithBackoff(url, {
      headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'FocusTracker/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results?.bindings?.map(b => {
      const val = b.type?.value ?? '';
      return val.startsWith('http') ? val.split('/').pop() : val;
    }).filter(Boolean) ?? [];
  } catch {
    return [];
  }
}

async function fetchEntityTerms(qid, entityTypes, entity, modifiers) {
  let sparqlTerms = [];
  try {
    if (entityTypes.includes(QID_COUNTRY)) {
      sparqlTerms = await executeSparql(countrySparql(qid));
    } else if (entityTypes.includes(QID_HUMAN)) {
      sparqlTerms = await executeSparql(personSparql(qid));
    } else if (entityTypes.includes(QID_DISCIPLINE)) {
      sparqlTerms = await executeSparql(disciplineSparql(qid));
    } else {
      sparqlTerms = await executeSparql(genericSparql(qid));
    }
  } catch {
    sparqlTerms = [];
  }
  const seed = [entity, ...modifiers].filter(Boolean);
  return [...seed, ...sparqlTerms];
}

function countrySparql(qid) {
  return `SELECT DISTINCT ?valueLabel WHERE {
  { wd:${qid} wdt:P36 ?value }
  UNION { wd:${qid} wdt:P38 ?value }
  UNION { wd:${qid} wdt:P37 ?value }
  UNION { wd:${qid} wdt:P527 ?value }
  UNION { wd:${qid} wdt:P2936 ?value }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 50`;
}

function personSparql(qid) {
  return `SELECT DISTINCT ?valueLabel WHERE {
  { wd:${qid} wdt:P106 ?value }
  UNION { wd:${qid} wdt:P800 ?value }
  UNION { wd:${qid} wdt:P19 ?value }
  UNION { wd:${qid} wdt:P69 ?value }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 50`;
}

function disciplineSparql(qid) {
  return `SELECT DISTINCT ?valueLabel WHERE {
  { wd:${qid} wdt:P279 ?value }
  UNION { wd:${qid} wdt:P527 ?value }
  UNION { wd:${qid} wdt:P1269 ?value }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 50`;
}

function genericSparql(qid) {
  return `SELECT DISTINCT ?valueLabel WHERE {
  { wd:${qid} wdt:P361 ?value }
  UNION { wd:${qid} wdt:P527 ?value }
  UNION { wd:${qid} wdt:P279 ?value }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 50`;
}

async function executeSparql(query) {
  const url = SPARQL_ENDPOINT + '?query=' + encodeURIComponent(query) + '&format=json';
  const res = await fetchWithBackoff(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'FocusTracker/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results?.bindings?.map(b => {
    const val = b.valueLabel?.value ?? b.type?.value ?? '';
    return val.startsWith('http') ? val.split('/').pop() : val;
  }).filter(v => v && !v.startsWith('Q')) ?? [];
}

async function fetchWithBackoff(url, options, attempt = 0) {
  const res = await fetch(url, options);
  if (res.status === 429 && attempt < 3) {
    const delay = 1000 * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithBackoff(url, options, attempt + 1);
  }
  return res;
}

function fallbackExpansion(entity, modifiers) {
  return [entity.toLowerCase(), ...modifiers.map(m => m.toLowerCase())].filter(Boolean);
}

module.exports = { expandEntity, clearWikidataCache };
