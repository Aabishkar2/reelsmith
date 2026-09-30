#!/usr/bin/env node
/**
 * download-image.js — Download a single image URL to a local path.
 *
 * Usage:
 *   node scripts/download-image.js <url> <dest-path>
 *
 * Output: prints the saved path on success, exits 1 on error.
 * Follows redirects automatically.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const { URL } = require('url');

const [,, url, destPath] = process.argv;

if (!url || !destPath) {
  console.error('Usage: node scripts/download-image.js <url> <dest-path>');
  process.exit(1);
}

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const file   = fs.createWriteStream(dest);

    client.get(url, { headers: { 'User-Agent': 'news-shorts/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return download(res.headers.location, dest, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
      file.on('error', err => { try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

download(url, destPath)
  .then(saved => console.log(saved))
  .catch(err => { console.error(err.message); process.exit(1); });
