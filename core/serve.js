'use strict';
/**
 * core/serve.js — the static file server every browser tool uses: renderer/render.js,
 * tools/contact-sheet.js, tools/preview.js (docs/framework-spec.md §4, §11).
 *
 * It serves the PROJECT ROOT (core/project.rootFor(videoDir)), never the video folder, so a
 * video's index.html at videos/<name>/index.html loads ../../runtime/animations.jsx and
 * ../../styles/<pack>/kit.jsx. file:// would block those script loads. In package mode
 * `runtime` and `styles/<pack>` are symlinks into node_modules/reelsmith (made by
 * `reelsmith init`), and they are followed.
 *
 *   resolveFile(root, urlPath, { frameworkRoot })
 *       → real path of the file to send, or null (→ 404). Rules:
 *         - urlPath is decoded; query and hash are ignored
 *         - no path segment may start with "." (.env, .git, "..": matters for preview --lan)
 *         - the path must stay inside root, and so must its REAL path (a symlink elsewhere in
 *           the project cannot expose files outside it) — except under the two framework mount
 *           points <root>/runtime and <root>/styles, whose real path may also lie inside the
 *           framework (realpath of frameworkRoot, or of <root>/node_modules/reelsmith)
 *         - directories are never served
 *   urlFor(root, file)     '/videos/x/index.html' (URL-encoded, '/' separators); throws when the
 *                          file is not inside root
 *   serveFile(req, res, file, { headers })
 *                          200, or 206/416 for a byte Range on media files (iOS Safari needs it); HEAD ok
 *   createServer(root, { frameworkRoot, route, headers })
 *                          http.Server; route(req, res, pathname) may answer a request first by
 *                          returning true (preview's /qr page)
 *   start(root, { host = '127.0.0.1', port = 0, ...createServer opts })
 *                          → Promise<{ server, port, url(file) }>
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const project = require('./project');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.jsx': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const RANGE_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.webm']);
const MOUNTS = new Set(['runtime', 'styles']);

const realOr = p => { try { return fs.realpathSync(p); } catch (_) { return null; } };
const inside = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Resolved roots for one server (computed once, not per request). */
function context(root, frameworkRoot = project.FRAMEWORK_ROOT) {
  const abs = path.resolve(root);
  const real = realOr(abs) || abs;
  const fw = [realOr(frameworkRoot), realOr(path.join(abs, 'node_modules', 'reelsmith'))].filter(Boolean);
  return { root: abs, real, framework: [...new Set(fw)] };
}

function resolveFile(root, urlPath, opts = {}) {
  const c = opts.ctx || context(root, opts.frameworkRoot);
  let rel;
  try { rel = decodeURIComponent(String(urlPath || '').split(/[?#]/)[0]); } catch (_) { return null; }
  if (rel.includes('\0')) return null;
  const segs = rel.split(/[\\/]+/).filter(Boolean);
  if (!segs.length || segs.some(s => s.startsWith('.'))) return null;
  const lexical = path.join(c.root, ...segs);
  if (!inside(c.root, lexical)) return null;
  const real = realOr(lexical);
  if (!real) return null;
  const allowed = inside(c.real, real) || (MOUNTS.has(segs[0]) && c.framework.some(f => inside(f, real)));
  if (!allowed) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch (_) { return null; }
  return real;
}

function urlFor(root, file) {
  let rel = path.relative(path.resolve(root), path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.relative(realOr(root) || root, realOr(file) || file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${file} is not inside the project root ${root}`);
  return '/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

/** Single "bytes=" range → { start, end } (inclusive), 'unsatisfiable', or null (serve it all). */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {
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

function serveFile(req, res, file, { headers = {} } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(file).toLowerCase();
  const base = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...headers };
  const size = stat.size;
  if (RANGE_EXTS.has(ext)) {
    base['Accept-Ranges'] = 'bytes';
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); return res.end(); }
    if (range) {
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, range).on('error', () => res.destroy()).pipe(res);
    }
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

function createServer(root, { frameworkRoot, route, headers } = {}) {
  const ctx = context(root, frameworkRoot);
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) { res.writeHead(400); return res.end('Bad request'); }
    if (route && route(req, res, pathname) === true) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const file = resolveFile(ctx.root, pathname, { ctx });
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    return serveFile(req, res, file, { headers });
  });
}

function start(root, { host = '127.0.0.1', port = 0, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(root, opts);
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const p = server.address().port;
      resolve({ server, port: p, url: file => `http://127.0.0.1:${p}${urlFor(root, file)}` });
    });
  });
}

module.exports = { MIME, context, resolveFile, urlFor, parseRange, serveFile, createServer, start };
