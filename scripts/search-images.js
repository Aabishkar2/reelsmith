#!/usr/bin/env node
/**
 * search-images.js — Search copyright-safe images from Wikimedia, Unsplash, Pexels.
 *
 * Usage:
 *   node scripts/search-images.js <query> [--source=all|wikimedia|unsplash|pexels] [--limit=5]
 *
 * Output: JSON array — [{ url, thumb, title, source, license }]
 *
 * Env vars (optional — source skipped if missing):
 *   UNSPLASH_ACCESS_KEY  — free tier: 50 req/hour, use sparingly
 *   PEXELS_API_KEY
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const https = require('https');
const http  = require('http');

const args       = process.argv.slice(2);
const query      = args.find(a => !a.startsWith('--'));
const sourceFlag = (args.find(a => a.startsWith('--source=')) || '--source=all').split('=')[1];
const limitParsed = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=5').split('=')[1], 10);
const limit      = (isNaN(limitParsed) || limitParsed < 1) ? 5 : limitParsed;

if (!query) {
  console.error('Usage: node scripts/search-images.js <query> [--source=all|wikimedia|unsplash|pexels] [--limit=5]');
  process.exit(1);
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'news-shorts/1.0', ...headers } }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}. Response: ${data.substring(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function searchWikimedia(query, limit) {
  const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1`;
  const searchRes = await getJson(searchUrl);
  const titles = (searchRes.query?.search || []).map(r => r.title);
  if (!titles.length) return [];

  const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=400&format=json&utf8=1`;
  const infoRes = await getJson(infoUrl);

  return Object.values(infoRes.query?.pages || {})
    .filter(p => p.imageinfo?.[0]?.url)
    .map(p => ({
      url:     p.imageinfo[0].url,
      thumb:   p.imageinfo[0].thumburl || p.imageinfo[0].url,
      title:   p.title.replace(/^File:/, ''),
      source:  'wikimedia',
      license: 'CC/Public Domain',
    }));
}

async function searchUnsplash(query, limit) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  // ⚠ Free tier: 50 requests/hour. Use sparingly — prefer Wikimedia for news subjects.
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}`;
  const res = await getJson(url, { Authorization: `Client-ID ${key}` });
  return (res.results || []).filter(p => p.urls?.full && p.urls?.thumb).map(p => ({
    url:     p.urls.full,
    thumb:   p.urls.thumb,
    title:   p.description || p.alt_description || query,
    source:  'unsplash',
    license: 'Unsplash License (free)',
  }));
}

async function searchPexels(query, limit) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}`;
  const res = await getJson(url, { Authorization: key });
  return (res.photos || []).filter(p => p.src?.original && p.src?.small).map(p => ({
    url:     p.src.original,
    thumb:   p.src.small,
    title:   p.alt || query,
    source:  'pexels',
    license: 'Pexels License (free)',
  }));
}

(async () => {
  const sources = sourceFlag === 'all'
    ? ['wikimedia', 'unsplash', 'pexels']
    : [sourceFlag];

  const batches = await Promise.all(sources.map(s => {
    if (s === 'wikimedia') return searchWikimedia(query, limit).catch(() => []);
    if (s === 'unsplash')  return searchUnsplash(query, limit).catch(() => []);
    if (s === 'pexels')    return searchPexels(query, limit).catch(() => []);
    return [];
  }));

  console.log(JSON.stringify(batches.flat(), null, 2));
})();
