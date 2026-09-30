#!/usr/bin/env node
/**
 * tools/preview.js — Opens a video's index.html in browser for fast pre-render review (`reelsmith preview`).
 *
 * Usage:
 *   reelsmith preview <video> [--lan] [--port=3000] [--no-open]
 *   node tools/preview.js videos/<name>
 *   node tools/preview.js videos/<name> --port=3000
 *   node tools/preview.js videos/<name> --lan         (phone on the same Wi-Fi)
 *   node tools/preview.js videos/<name> --no-open     (don't open a browser)
 *
 * Starts an HTTP server from the video's project root (core/project.rootFor; required for the
 * runtime and style-kit imports, which are symlinks into node_modules/reelsmith in package mode —
 * core/serve.js follows them but nothing else outside the project),
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

const project = require('../core/project');
const serve = require('../core/serve');

// QR library for the /qr page, loaded by the browser from a pinned CDN URL.
const QR_LIB = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
const QR_LIB_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node tools/preview.js <video-dir> [--port=3000] [--lan] [--no-open]');
  console.log('Example: node tools/preview.js videos/my-video --lan');
  process.exit(0);
}

const videoArg = args.find(a => !a.startsWith('--'));
let videoDir = path.resolve(videoArg);
if (!fs.existsSync(videoDir)) { try { videoDir = project.resolveVideo(videoArg); } catch (_) { /* reported below */ } }
const PROJECT_ROOT = project.rootFor(videoDir);
const SERVE = serve.context(PROJECT_ROOT);
const portArg = args.find(a => a.startsWith('--port='));
const preferredPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
const LAN = args.includes('--lan');
const OPEN = !args.includes('--no-open');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const videoRelPath = path.relative(PROJECT_ROOT, videoDir) || '.';
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
  console.warn(`Run: reelsmith tts ${videoRelPath} --voice=<voice>  (or reelsmith cut ${videoRelPath} for a recorded take)`);
}

const pagePath = serve.urlFor(PROJECT_ROOT, htmlPath);

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
// Byte ranges (206, for media; iOS Safari needs them) and the file rules live in core/serve.js.

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
  let urlPath, rawPath, query;
  try {
    const u = new URL(req.url, 'http://localhost');
    rawPath = u.pathname;
    urlPath = decodeURIComponent(rawPath);
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

  // Inside the project only, no dotfiles/dirs (.env, .git — matters with --lan), symlinks resolved
  // (only runtime/ and styles/ may lead into the framework): core/serve.js resolveFile().
  const filePath = serve.resolveFile(PROJECT_ROOT, rawPath, { ctx: SERVE });
  if (!filePath) {
    res.writeHead(404);
    return res.end('Not found');
  }
  return serve.serveFile(req, res, filePath, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
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
