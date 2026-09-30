#!/usr/bin/env node
'use strict';
/**
 * Reelsmith — local teleprompter / recording / review app server (`reelsmith record`).
 * Contract: docs/spec.md §5. Node built-ins only (plus dotenv for .env).
 *
 * Project: $REELSMITH_ROOT (set by `reelsmith record`), else the project around the cwd
 * (core/project.root: nearest reelsmith.config.json; falls back to the framework checkout).
 * Videos: $VIDEOS_DIR, else <project>/<reelsmith.config.json videosDir>. Port: $APP_PORT, else
 * reelsmith.config.json app.port, else 4310. ffmpeg: core/env.js.
 *
 * Pipeline modules (../pipeline/*.js) are required lazily inside handlers so the
 * server always starts and serves the UI even if a pipeline module is missing or
 * broken; in that case the affected endpoint returns 500 JSON { error }.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const project = require('../core/project');
const coreConfig = require('../core/config');
const coreEnv = require('../core/env');

const ROOT = project.root(process.env.REELSMITH_ROOT || process.cwd());                 // the project root
const { config: CONFIG } = coreConfig.load({ root: ROOT });                             // + <root>/.env
coreEnv.ensureOnPath();                                                                  // pipeline modules spawn ffmpeg too

const PORT = Number(process.env.APP_PORT) || Number(CONFIG.app && CONFIG.app.port) || 4310;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEOS_DIR = process.env.VIDEOS_DIR ? path.resolve(process.env.VIDEOS_DIR) : path.join(ROOT, CONFIG.videosDir || 'videos');   // override for testing
const PIPELINE_DIR = path.join(__dirname, '..', 'pipeline');                            // framework code
const SLICE_DIR = path.join(os.tmpdir(), 'reelsmith-slices');
const FFMPEG = coreEnv.bin('ffmpeg');
const MAX_UPLOAD = 500 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webm': 'audio/webm', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

// ───────────────────────────── helpers ─────────────────────────────

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/** Lazily require a pipeline module; throws HttpError(500) with a clear message if unavailable. */
function pipeline(name) {
  const file = path.join(PIPELINE_DIR, name + '.js');
  try {
    return require(file);
  } catch (e) {
    throw new HttpError(500, `pipeline/${name}.js unavailable: ${e.message.split('\n')[0]}`);
  }
}

function pipelineFn(name, fn) {
  const mod = pipeline(name);
  if (typeof mod[fn] !== 'function') throw new HttpError(500, `pipeline/${name}.js does not export ${fn}()`);
  return mod[fn].bind(mod);
}

/** Only [a-z0-9-_] video names; returns absolute video dir. */
function videoDir(name, mustExist = true) {
  if (!/^[a-z0-9_-]+$/i.test(name || '')) throw new HttpError(400, `invalid video name: ${name}`);
  const dir = path.join(VIDEOS_DIR, name);
  if (mustExist && !isDir(dir)) throw new HttpError(404, `video not found: ${name}`);
  return dir;
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readJsonSafe(p) { try { return readJson(p); } catch { return null; } }

/** True if `child` resolves inside `parent` (no traversal). */
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Resolve a src like "takes/take-01.hq.wav" — must live under takes/ or voiceover/. */
function resolveMediaSrc(dir, src) {
  if (!src || typeof src !== 'string' || src.includes('\0')) throw new HttpError(400, 'missing src');
  const abs = path.resolve(dir, src);
  if (!inside(path.join(dir, 'takes'), abs) && !inside(path.join(dir, 'voiceover'), abs)) {
    throw new HttpError(400, 'src must be inside takes/ or voiceover/');
  }
  if (!isFile(abs)) throw new HttpError(404, `not found: ${src}`);
  return abs;
}

/** Validate a take base path such as "takes/take-01" or "takes/rr-s1.2-1". */
function checkTakeBase(dir, base) {
  if (typeof base !== 'string' || !/^takes\/[a-z0-9._-]+$/i.test(base) || base.includes('..')) {
    throw new HttpError(400, `invalid take path: ${base}`);
  }
  return base;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON body'); }
}

/** Stream request body to a file, enforcing a size limit. Resolves with bytes written. */
function saveBodyToFile(req, file, limit) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let size = 0, failed = false;
    const fail = (err) => {
      if (failed) return; failed = true;
      out.destroy(); fs.rm(file, { force: true }, () => {});
      reject(err);
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new HttpError(413, `upload exceeds ${limit / 1024 / 1024}MB`)); req.destroy(); }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve(size); });
    req.pipe(out);
  });
}

function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`ffmpeg failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}: ${(r.stderr || '').trim().slice(-500)}`);
}

/** Serve a file with optional single-range support (lets <audio> seek). */
function sendFile(req, res, file, extraHeaders = {}) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'not found'); }
  if (!st.isFile()) throw new HttpError(404, 'not found');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'last-modified': st.mtime.toUTCString(), ...extraHeaders };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && st.size > 0) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    if (!m[1] && !m[2]) { start = 0; end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start < 0 || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ───────────────────────── script parsing ─────────────────────────

/**
 * Minimal fallback parser (§3) — used ONLY when pipeline/script.js can't be required.
 * Output shape mirrors script.js: { meta, scenes:[{ idx, sentences:[{ id, text, line }] }] }.
 */
function fallbackParseScript(raw) {
  const meta = {};
  let body = raw.replace(/^﻿/, '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      let v = kv[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
      meta[kv[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
  }
  const scenes = [];
  let cur = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sh = /^###\s+Scene\s+(\d+)\b/i.exec(line);
    if (sh) { cur = { idx: Number(sh[1]), sentences: [] }; scenes.push(cur); continue; }
    if (/^#{1,6}\s/.test(line)) { cur = null; continue; }
    if (!cur || !line || line.startsWith('>')) continue;
    const n = cur.sentences.length + 1;
    cur.sentences.push({ id: `s${cur.idx}.${n}`, text: line, line: n });
  }
  return { meta, scenes };
}

async function loadScript(dir) {
  const file = path.join(dir, 'script.md');
  if (!isFile(file)) throw new HttpError(404, 'no script.md', { hint: `Write ${path.relative(ROOT, file)} via Claude Code (script-writing skill).` });
  const raw = fs.readFileSync(file, 'utf8');
  let mod = null;
  try { mod = require(path.join(PIPELINE_DIR, 'script.js')); } catch { mod = null; }
  let parsed; let parser = 'pipeline';
  if (mod && typeof mod.load === 'function') parsed = await mod.load(dir);
  else if (mod && typeof mod.parse === 'function') parsed = await mod.parse(raw);
  else { parsed = fallbackParseScript(raw); parser = 'fallback'; }
  return { ...parsed, raw, parser };
}

// ───────────────────────── video listing ─────────────────────────

function listTakes(dir) {
  const td = path.join(dir, 'takes');
  let files = [];
  try { files = fs.readdirSync(td); } catch { return []; }
  return files.filter((f) => /^take-\d+\.webm$/.test(f) || /^take-\d+\.wav$/.test(f))
    .map((f) => 'takes/' + f.replace(/\.(webm|wav)$/, ''))
    .filter((v, i, a) => a.indexOf(v) === i).sort();
}

function videoSummary(name) {
  const dir = path.join(VIDEOS_DIR, name);
  const hasScript = isFile(path.join(dir, 'script.md'));
  const take = readJsonSafe(path.join(dir, 'take.json'));
  const hasTake = !!take;
  const hasCut = isFile(path.join(dir, 'scenes.json')) && isFile(path.join(dir, 'voiceover.mp3'));
  const status = take?.status || (hasCut ? 'cut' : hasScript ? 'script' : 'empty');
  let title = null;
  if (hasScript) {
    try { title = fallbackParseScript(fs.readFileSync(path.join(dir, 'script.md'), 'utf8')).meta.title || null; } catch { /* ignore */ }
  }
  return { name, hasScript, hasTake, status, title, takes: listTakes(dir), currentTake: take?.take || null, summary: take?.summary || null, hasCut };
}

// ───────────────────────── take upload ─────────────────────────

function nextTakeBase(dir, kind, sentenceId) {
  const td = path.join(dir, 'takes');
  fs.mkdirSync(td, { recursive: true });
  const files = fs.readdirSync(td);
  if (kind === 'rerecord') {
    if (!/^s\d+\.\d+$/.test(sentenceId || '')) throw new HttpError(400, `invalid x-sentence-id: ${sentenceId}`);
    const re = new RegExp(`^rr-${sentenceId.replace('.', '\\.')}-(\\d+)\\.`);
    const max = files.reduce((m, f) => { const x = re.exec(f); return x ? Math.max(m, Number(x[1])) : m; }, 0);
    return `takes/rr-${sentenceId}-${max + 1}`;
  }
  const max = files.reduce((m, f) => { const x = /^take-(\d+)\./.exec(f); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `takes/take-${String(max + 1).padStart(2, '0')}`;
}

async function convertTake(dir, base) {
  const src = path.join(dir, base + '.webm');
  const wav = path.join(dir, base + '.wav');
  const hq = path.join(dir, base + '.hq.wav');
  let audio = null;
  try { audio = require(path.join(PIPELINE_DIR, 'audio.js')); } catch { audio = null; }
  if (audio && typeof audio.toWav16k === 'function' && typeof audio.toWavHq === 'function') {
    await audio.toWav16k(src, wav);
    await audio.toWavHq(src, hq);
  } else {
    ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', hq]);
  }
  let durationSec = null;
  try {
    if (audio && typeof audio.duration === 'function') durationSec = await audio.duration(hq);
  } catch { /* informational only */ }
  if (durationSec == null) durationSec = Math.round((fs.statSync(hq).size - 44) / (48000 * 2) * 100) / 100;
  return { durationSec, via: audio ? 'pipeline/audio.js' : 'ffmpeg' };
}

async function handleTakeUpload(req, res, name) {
  const dir = videoDir(name);
  const kind = String(req.headers['x-take-kind'] || 'take').toLowerCase();
  if (kind !== 'take' && kind !== 'rerecord') throw new HttpError(400, `invalid x-take-kind: ${kind}`);
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_UPLOAD) throw new HttpError(413, 'upload exceeds 500MB');
  const base = nextTakeBase(dir, kind, String(req.headers['x-sentence-id'] || ''));
  const webm = path.join(dir, base + '.webm');
  const bytes = await saveBodyToFile(req, webm, MAX_UPLOAD);
  if (bytes < 200) { fs.rmSync(webm, { force: true }); throw new HttpError(400, `upload is empty (${bytes} bytes) — was the mic recording?`); }
  let conv;
  try { conv = await convertTake(dir, base); } catch (e) {
    throw new HttpError(500, `saved ${base}.webm but conversion failed: ${e.message}`);
  }
  console.log(`  saved ${name}/${base}.webm (${(bytes / 1024).toFixed(0)} KB, ${conv.durationSec}s via ${conv.via})`);
  sendJson(res, 200, { take: base, kind, bytes, durationSec: conv.durationSec });
}

// ───────────────────────── audio slices ─────────────────────────

async function handleAudio(req, res, name, q) {
  const dir = videoDir(name);
  const abs = resolveMediaSrc(dir, q.get('src'));
  const hasStart = q.has('start') && q.get('start') !== '';
  const hasEnd = q.has('end') && q.get('end') !== '';
  if (!hasStart && !hasEnd) return sendFile(req, res, abs, { 'cache-control': 'no-store' });
  const start = Math.max(0, Number(q.get('start') || 0));
  const end = hasEnd ? Number(q.get('end')) : null;
  if (!Number.isFinite(start) || (end != null && (!Number.isFinite(end) || end <= start))) throw new HttpError(400, 'invalid start/end');
  const st = fs.statSync(abs);
  const key = crypto.createHash('sha1').update(`${abs}|${st.mtimeMs}|${st.size}|${start}|${end}`).digest('hex');
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  const out = path.join(SLICE_DIR, key + '.wav');
  if (!isFile(out)) {
    const tmp = out + '.' + process.pid + '.tmp.wav';
    let audio = null;
    try { audio = require(path.join(PIPELINE_DIR, 'audio.js')); } catch { audio = null; }
    try {
      if (audio && typeof audio.sliceWav === 'function' && end != null && /\.wav$/i.test(abs)) {
        await audio.sliceWav(abs, tmp, start, end);
      } else {
        ffmpeg(['-ss', String(start), ...(end != null ? ['-t', String(end - start)] : []), '-i', abs, '-vn', '-ac', '1', '-c:a', 'pcm_s16le', tmp]);
      }
      fs.renameSync(tmp, out);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new HttpError(500, `slice failed: ${e.message}`);
    }
  }
  return sendFile(req, res, out, { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=3600' });
}

// ───────────────────────── pipeline ops ─────────────────────────

async function handleAnalyze(req, res, name) {
  const dir = videoDir(name);
  const body = await readJsonBody(req);
  const take = checkTakeBase(dir, body.take);
  if (!isFile(path.join(dir, take + '.wav')) && !isFile(path.join(dir, take + '.webm'))) throw new HttpError(404, `take not found: ${take}`);
  const analyze = pipelineFn('analyze', 'analyze');
  const opts = { take, whisperModel: body.whisperModel || process.env.WHISPER_MODEL || 'turbo', useJev: body.useJev !== false };
  const t0 = Date.now();
  let result;
  try { result = await analyze(dir, opts); } catch (e) {
    // silent take (mic delivered no audio): analyze wrote take.json { status:'silent' } and skipped whisper
    if (e.code === 'SILENT_TAKE') throw new HttpError(422, e.message, { code: e.code, take: e.take });
    throw e;
  }
  if (!result || !Array.isArray(result.sentences)) result = readJsonSafe(path.join(dir, 'take.json'));
  if (!result) throw new HttpError(500, 'analyze finished but take.json was not written');
  console.log(`  analyzed ${name}/${take} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${JSON.stringify(result.summary || {})}`);
  sendJson(res, 200, result);
}

async function handleRerecord(req, res, name) {
  const dir = videoDir(name);
  const body = await readJsonBody(req);
  const sentenceId = String(body.sentenceId || '');
  if (!/^s\d+\.\d+$/.test(sentenceId)) throw new HttpError(400, `invalid sentenceId: ${sentenceId}`);
  const clip = checkTakeBase(dir, body.clip);
  if (!isFile(path.join(dir, 'take.json'))) throw new HttpError(409, 'no take.json yet — analyze a take first');
  const rerecord = pipelineFn('splice', 'rerecord');
  const result = await rerecord(dir, sentenceId, clip);
  const take = readJsonSafe(path.join(dir, 'take.json'));
  let sentence = result?.sentence || (result?.id === sentenceId ? result : null)
    || result?.sentences?.find?.((s) => s.id === sentenceId) || take?.sentences?.find((s) => s.id === sentenceId) || null;
  const summary = result?.summary || take?.summary || null;
  sendJson(res, 200, { ...(result && typeof result === 'object' && !Array.isArray(result) ? result : {}), sentence, summary, take });
}

/**
 * POST /api/videos/:name/pick { sentenceId, n } | { sentenceId, source: 'auto' }
 * Persist a manual attempt choice (sentence.pick, docs/spec.md §7a) — or clear it
 * — then re-run analyze on the same take (whisper words are cached), which
 * re-aligns the sentence to the picked attempt and regenerates cuts[] + summary.
 */
async function handlePick(req, res, name) {
  const dir = videoDir(name);
  const body = await readJsonBody(req);
  const sentenceId = String(body.sentenceId || '');
  if (!/^s\d+\.\d+$/.test(sentenceId)) throw new HttpError(400, `invalid sentenceId: ${sentenceId}`);
  const f = path.join(dir, 'take.json');
  if (!isFile(f)) throw new HttpError(409, 'no take.json yet — analyze a take first');
  const take = readJson(f);
  const s = (take.sentences || []).find((x) => x.id === sentenceId);
  if (!s) throw new HttpError(404, `unknown sentence ${sentenceId}`);
  if (body.source === 'auto') delete s.pick;
  else {
    const a = (s.attempts || []).find((x) => x.n === Number(body.n));
    if (!a) throw new HttpError(404, `${sentenceId} has no attempt #${body.n}`);
    s.pick = a.source === 'rerecord' ? { source: 'rerecord', n: a.n, clip: a.clip, at: new Date().toISOString() }
      : { source: 'take', n: a.n, start: a.range ? a.range[0] : null, at: new Date().toISOString() };
  }
  fs.writeFileSync(f, JSON.stringify(take, null, 2));
  const analyze = pipelineFn('analyze', 'analyze');
  const t0 = Date.now();
  const result = await analyze(dir, { take: take.take, useJev: !!take.jev, keepRerecords: true,
    ...(take.whisperModel && take.whisperModel !== 'injected' ? { whisperModel: take.whisperModel } : {}) });
  console.log(`  pick ${name} ${sentenceId} → ${s.pick ? `#${s.pick.n}` : 'auto'} (re-analyzed in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  sendJson(res, 200, result);
}

/** GET/POST /api/videos/:name/settings — per-video switches ({ denoise }), videos/<name>/settings.json. */
async function handleSettings(req, res, name) {
  const dir = videoDir(name);
  const dn = pipeline('denoise'), cfg = pipeline('config').loadConfig();
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    if (typeof body.denoise !== 'boolean') throw new HttpError(400, 'body must be { denoise: true|false }');
    dn.setEnabled(dir, body.denoise);
  }
  sendJson(res, 200, { denoise: dn.enabledFor(dir, cfg), defaultDenoise: cfg.denoise.enabled !== false, engine: cfg.denoise.engine });
}

/**
 * POST /api/videos/:name/denoise { src: "takes/take-02.hq.wav" } → { clean, engine, warning, cached }
 * Makes (or reuses) the cached denoised sibling so the review UI can A/B it.
 */
async function handleDenoise(req, res, name) {
  const dir = videoDir(name);
  const body = await readJsonBody(req);
  const abs = resolveMediaSrc(dir, body.src);
  if (!/\.hq\.wav$/i.test(abs)) throw new HttpError(400, 'src must be a takes/*.hq.wav file');
  const r = pipeline('denoise').ensureClean(abs, { quiet: true });
  sendJson(res, 200, { clean: path.relative(dir, r.file), engine: r.engine, warning: r.warning, cached: r.cached });
}

async function handleFinalize(req, res, name) {
  const dir = videoDir(name);
  await readJsonBody(req);
  if (!isFile(path.join(dir, 'take.json'))) throw new HttpError(409, 'no take.json yet — analyze a take first');
  const finalize = pipelineFn('cut', 'finalize');
  const result = (await finalize(dir)) || {};
  const scenes = Array.isArray(result.scenes) ? result.scenes : readJsonSafe(path.join(dir, 'scenes.json')) || [];
  const totalSec = Number.isFinite(result.totalSec) ? result.totalSec
    : Math.round(scenes.reduce((a, s) => a + (Number(s.dur) || 0), 0) * 100) / 100;
  sendJson(res, 200, { ...result, scenes, totalSec, voiceover: `/videos/${name}/voiceover.mp3` });
}

// ───────────────────────── router ─────────────────────────

async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);
  const m = req.method;
  let mm;

  if (p === '/api/health') return sendJson(res, 200, { status: 'ok', port: PORT, node: process.version });

  if (p === '/api/videos' && m === 'GET') {
    let names = [];
    try { names = fs.readdirSync(VIDEOS_DIR).filter((n) => /^[a-z0-9_-]+$/i.test(n) && isDir(path.join(VIDEOS_DIR, n))); } catch { /* no videos dir */ }
    return sendJson(res, 200, names.sort().map(videoSummary));
  }

  if ((mm = /^\/api\/videos\/([^/]+)\/(script|take|analyze|rerecord|pick|settings|denoise|take\.json|audio|finalize)$/.exec(p))) {
    const [, name, op] = mm;
    if (op === 'script' && m === 'GET') return sendJson(res, 200, await loadScript(videoDir(name)));
    if (op === 'take' && m === 'POST') return handleTakeUpload(req, res, name);
    if (op === 'analyze' && m === 'POST') return handleAnalyze(req, res, name);
    if (op === 'rerecord' && m === 'POST') return handleRerecord(req, res, name);
    if (op === 'pick' && m === 'POST') return handlePick(req, res, name);
    if (op === 'settings' && (m === 'GET' || m === 'POST')) return handleSettings(req, res, name);
    if (op === 'denoise' && m === 'POST') return handleDenoise(req, res, name);
    if (op === 'finalize' && m === 'POST') return handleFinalize(req, res, name);
    if (op === 'audio' && (m === 'GET' || m === 'HEAD')) return handleAudio(req, res, name, u.searchParams);
    if (op === 'take.json' && m === 'GET') {
      const f = path.join(videoDir(name), 'take.json');
      if (!isFile(f)) throw new HttpError(404, 'no take.json yet');
      return sendJson(res, 200, readJson(f));
    }
    throw new HttpError(405, `${m} not allowed on ${p}`);
  }

  if (p.startsWith('/api/')) throw new HttpError(404, `no such endpoint: ${m} ${p}`);

  if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'method not allowed');

  // Read-only static access to per-video files (voiceover.mp3, voiceover/sN.mp3, takes/*.json …).
  if ((mm = /^\/videos\/([^/]+)\/(.+)$/.exec(p))) {
    const dir = videoDir(mm[1]);
    const abs = path.resolve(dir, mm[2]);
    if (!inside(dir, abs) || mm[2].split('/').some((s) => s.startsWith('.'))) throw new HttpError(403, 'forbidden');
    // ?optional=1 → 204 instead of 404 for files that may not exist yet (keeps the browser console clean).
    if (u.searchParams.has('optional') && !isFile(abs)) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
    return sendFile(req, res, abs, { 'cache-control': 'no-store' });
  }

  // App static files.
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!inside(PUBLIC_DIR, abs)) throw new HttpError(403, 'forbidden');
  if (!isFile(abs)) throw new HttpError(404, `not found: ${p}`);
  return sendFile(req, res, abs, { 'cache-control': 'no-cache' });
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  route(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`  ERROR ${req.method} ${req.url}:`, err.stack || err.message);
    if (res.headersSent) { res.destroy(); return; }
    // Drain any unread body so the client gets the response instead of a reset.
    req.resume();
    sendJson(res, status, { error: err.message || String(err), ...(err.extra || {}) });
  });
});

server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 120000;
server.keepAliveTimeout = 5000;

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} already in use — set APP_PORT or stop the other server.` : e);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`reelsmith app → http://localhost:${PORT}  (videos: ${VIDEOS_DIR})`);
});
