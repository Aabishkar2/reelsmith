#!/usr/bin/env node
/**
 * preview.js — Opens a video's index.html in browser for fast pre-render review.
 *
 * Usage:
 *   node scripts/preview.js videos/<name>
 *   node scripts/preview.js videos/<name> --port=3000
 *   node scripts/preview.js videos/<name> --lan         (phone on the same Wi-Fi)
 *   node scripts/preview.js videos/<name> --no-open     (don't open a browser)
 *
 * Starts an HTTP server from project root (required for runtime imports),
 * opens the video HTML in your default browser with PlaybackBar controls.
 * Refresh the page to see edits — no rendering needed. The Stage plays
 * voiceover-mix.mp3 (else voiceover.mp3) in sync when present.
 *
 * --lan binds 0.0.0.0 and prints a URL per network interface plus a /qr page
 * (open it on the Mac, scan it with the phone). /qr?u=<url> works in any mode.
 * Audio/video files are served with HTTP Range support (iOS Safari needs it).
 *
 * Requires: none (pure Node.js)
 */

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REAL_ROOT = fs.realpathSync(PROJECT_ROOT);

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.jsx':  'application/javascript',
  '.json': 'application/json',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.mp4':  'video/mp4',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.gif':  'image/gif',
};

// Byte-range responses (206) for media only; everything else is a plain 200.
const RANGE_EXTS = new Set(['.mp3', '.wav', '.mp4']);

// QR library for the /qr page, loaded by the browser from a pinned CDN URL.
const QR_LIB = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
const QR_LIB_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node scripts/preview.js <video-dir> [--port=3000] [--lan] [--no-open]');
  console.log('Example: node scripts/preview.js videos/s3-files --lan');
  process.exit(0);
}

const videoDir = path.resolve(args.find(a => !a.startsWith('--')));
const portArg = args.find(a => a.startsWith('--port='));
const preferredPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
const LAN = args.includes('--lan');
const OPEN = !args.includes('--no-open');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const videoRelPath = path.relative(PROJECT_ROOT, videoDir);
const htmlPath = path.join(videoDir, 'index.html');
const scenesPath = path.join(videoDir, 'scenes.json');

if (!fs.existsSync(htmlPath)) {
  console.error(`Error: ${htmlPath} not found.`);
  console.error('Make sure the video directory contains index.html');
  process.exit(1);
}

if (!fs.existsSync(scenesPath)) {
  console.warn(`Warning: ${scenesPath} not found.`);
  console.warn('Voiceover sync will not work without scenes.json.');
  console.warn('Run: node pipeline/cli.js cut ' + videoRelPath);
}

const pagePath = '/' + videoRelPath.split(path.sep).map(encodeURIComponent).join('/') + '/index.html';

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

// Single "bytes=" range → {start, end} (inclusive), 'unsatisfiable', or null
// (no/unsupported Range header → serve the whole file with 200, as RFC 9110 allows).
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {                       // suffix: last N bytes
    const n = parseInt(m[2], 10);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

const htmlEscape = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function qrPage(target) {
  const json = JSON.stringify(String(target)).replace(/</g, '\\u003c');
  const href = /^https?:\/\//i.test(target) ? target : '#'; // never a javascript: link
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scan to preview</title>
<style>
  html, body { margin: 0; height: 100%; background: #0a0a0a; color: #f6f4ef; font-family: Inter, system-ui, sans-serif; }
  main { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 24px; box-sizing: border-box; text-align: center; }
  #qr { width: min(360px, 80vw); aspect-ratio: 1; background: #fff; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #333; font-size: 14px; }
  #qr svg { width: 100%; height: 100%; display: block; }
  #url { font: 600 18px/1.4 ui-monospace, 'JetBrains Mono', monospace; word-break: break-all; color: #f6f4ef; max-width: 90vw; }
  p { margin: 0; color: rgba(246,244,239,0.6); font-size: 14px; }
</style>
</head>
<body>
<main>
  <div id="qr">loading QR…</div>
  <a id="url" href="${htmlEscape(href)}">${htmlEscape(target)}</a>
  <p>Scan with the phone camera (same Wi-Fi). Tap ▶ on the phone to start sound.</p>
</main>
<script src="${QR_LIB}" integrity="${QR_LIB_SRI}" crossorigin="anonymous"></script>
<script>
  (function () {
    var url = ${json};
    var box = document.getElementById('qr');
    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
    } catch (e) {
      box.textContent = 'QR library failed to load (offline?). Type the URL below on the phone.';
    }
  })();
</script>
</body>
</html>`;
}

// ── HTTP server ────────────────────────────────────────────────────────────────

let defaultQrTarget = null; // set once the port is known

function handle(req, res) {
  let urlPath, query;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  if (urlPath === '/qr') {
    const body = qrPage(query.get('u') || defaultQrTarget || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  const filePath = path.join(PROJECT_ROOT, urlPath);
  // Stay inside the project and never serve dotfiles/dirs (.env, .git) — matters with --lan.
  const escapes = filePath !== PROJECT_ROOT && !filePath.startsWith(PROJECT_ROOT + path.sep);
  const dotted = urlPath.split('/').some(seg => seg.startsWith('.'));
  // Resolve symlinks too, so a link inside the project cannot point outside it.
  let stat = null;
  if (!escapes && !dotted) {
    try {
      const real = fs.realpathSync(filePath);
      if (real === REAL_ROOT || real.startsWith(REAL_ROOT + path.sep)) stat = fs.statSync(real);
    } catch {}
  }
  if (!stat || stat.isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const size = stat.size;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  };

  if (RANGE_EXTS.has(ext)) {
    headers['Accept-Ranges'] = 'bytes';
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    if (range) {
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath, range).on('error', () => res.destroy()).pipe(res);
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server.close();
        reject(err);
      } else {
        reject(err);
      }
    });

    server.listen(port, HOST, () => {
      resolve(server);
    });
  });
}

// ── Run ────────────────────────────────────────────────────────────────────────

(async () => {
  let port = preferredPort;
  let server;

  // Try preferred port, fall back to random
  try {
    server = await startServer(port);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying random port...`);
      server = await startServer(0);
      port = server.address().port;
    } else {
      throw err;
    }
  }

  const url = `http://127.0.0.1:${port}${pagePath}`;
  const lanUrls = LAN ? lanAddresses().map(ip => `http://${ip}:${port}${pagePath}`) : [];
  const qrLink = (target) => `http://127.0.0.1:${port}/qr?u=${encodeURIComponent(target)}`;
  defaultQrTarget = lanUrls[0] || url;

  console.log(`\n  Preview server running at:`);
  console.log(`  → ${url}`);
  if (LAN) {
    if (lanUrls.length) {
      console.log(`\n  On your phone (same Wi-Fi):`);
      for (const u of lanUrls) {
        console.log(`  → ${u}`);
        console.log(`    QR: ${qrLink(u)}`);
      }
      console.log(`\n  Open a QR link on this Mac and scan it. If the phone can't connect, allow`);
      console.log(`  incoming connections for node in the macOS firewall prompt.`);
    } else {
      console.log(`\n  Note: no non-internal IPv4 address found (Wi-Fi off?) — the phone can't reach this Mac.`);
    }
  }
  console.log(`\n  Refresh browser to see changes. Press Ctrl+C to stop.\n`);

  // Open browser
  if (OPEN) {
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', [url]);
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', url]);
    } else {
      spawn('xdg-open', [url]);
    }
  }

  // Keep alive
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });

})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
