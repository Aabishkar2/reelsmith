#!/usr/bin/env node
'use strict';
/**
 * render.js — renders an animated HTML video (runtime/animations.jsx <Stage>) to MP4, fast.
 *
 * Usage:
 *   node renderer/render.js <index.html> [output.mp4] [--fps=30] [--duration=S] [--width=720] [--height=1280]
 *     [--audio=path.mp3] [--shards=N] [--quality=95] [--encoder=auto|videotoolbox|x264]
 *     [--draft] [--from=S] [--to=S] [--gpu] [--keep-segments] [--no-preview-gate]
 *
 * How (docs/fast-render.md): every frame is a pure function of time, so the frame range is split into K
 * contiguous shards. Each shard is its own headless Chromium + page + CDP session and captures frame i at
 * t = i/fps (__stage.setTime → one rAF → Page.captureScreenshot JPEG), piping the JPEGs straight into an
 * ffmpeg per segment (no frames on disk, encode overlaps capture). Segments are concatenated with -c copy
 * and the audio is muxed in at the end.
 *
 *   --draft        fps 15, 0.75× size, JPEG q80, fast encoder settings → <videoDir>/draft.mp4, no preview gate
 *   --audio=F      muxed in at the end. Without --duration the length is Σ scenes.json dur, unless F is
 *                  longer by 0.1–6 s (a music tail: tools/mix-music.js adds 2.5 s): then the video runs to
 *                  the end of F and the tail holds the closing frame (the frame at Σdur). The last scene's
 *                  Sprite unmounts after its end (runtime useSceneWindow), so frames past Σdur are captured
 *                  at Σdur instead of showing an empty stage. Longer than that: Σdur (F is cut).
 *   --from/--to    only frames with t in [from, to) → <videoDir>/clip-<from>s-<to>s.mp4, audio trimmed, no gate
 *   --shards=N     default min(4, cores − 1, available RAM / 400 MB); never more than cores − 1
 *   --gpu          opt-in full Chromium + Metal/GPU raster (faster, pixels differ slightly from software raster)
 *
 * Crash resume: finished segments are cached in <videoDir>/frames/render-cache/<key>/ and reused when the
 * same command is re-run. The cache is removed after a successful render unless --keep-segments.
 *
 * Preview gate: a full-range, non-draft render refuses to run until the human approved the preview for
 * exactly this version of the video (tools/approve-preview.js, `reelsmith approve`). --no-preview-gate skips
 * it — only for fixtures/tests, never for a real video.
 *
 * Serving: the page is loaded over HTTP from the PROJECT ROOT (core/project.rootFor(videoDir)) through
 * core/serve.js, so ../../runtime/animations.jsx and ../../styles/<pack>/kit.jsx resolve in clone mode
 * and in package mode (symlinks into node_modules/reelsmith, followed). ffmpeg/ffprobe come from core/env.js.
 *
 * Exit codes: 0 ok · 1 error · 3 preview gate · 130 interrupted (SIGINT).
 * Requirements: npm install && npx playwright install chromium · brew install ffmpeg
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const project = require('../core/project');
const env = require('../core/env');
const serve = require('../core/serve');

const PROJECT_ROOT = project.FRAMEWORK_ROOT;     // the framework checkout (clone mode); a video's own root: project.rootFor()
const FFMPEG = () => env.bin('ffmpeg');
const FFPROBE = () => env.bin('ffprobe');
const MB = 1024 * 1024;
const BASE = { fps: 30, width: 720, height: 1280, quality: 95 };
const DRAFT = { fps: 15, scale: 0.75, quality: 80 };
const MAX_AUTO_SHARDS = 4;
const MEM_PER_SHARD = 400 * MB;
const SEGMENT_SEC = 3;          // each shard encodes ≤3 s segments → a crash loses at most one segment per shard
const FRAME_TIMEOUT_MS = 60000;
const FRAME_TRIES = 3;
const MAX_RELAUNCHES = 3;
const EPS = 1e-6;               // float guard: 2.0000000001·30 frames is 60, not 61
const TAIL_MIN_SEC = 0.1;       // --audio longer than Σdur by less than this is encoder padding, not a tail
const TAIL_MAX_SEC = 6;         // …and by more than this is not a tail either (keep Σdur, cut the audio)
const HOLD_EPS = 1e-4;          // the held frame is captured just inside the last scene's window
const HEADLESS_ARGS = ['--no-sandbox'];
const GPU_ARGS = ['--no-sandbox', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-zero-copy'];

// ── Pure planning (exported for pipeline/test/render.test.js) ──────────────────

/** Split `totalFrames` frames (starting at `offset`) into ≤ `shards` contiguous, non-empty ranges whose sizes differ by ≤ 1. */
function planShards(totalFrames, shards, offset = 0) {
  const n = Math.min(Math.max(1, Math.floor(shards) || 1), totalFrames);
  const out = [];
  if (!(n > 0)) return out;
  const base = Math.floor(totalFrames / n), extra = totalFrames % n;
  let a = offset;
  for (let k = 0; k < n; k++) {
    const b = a + base + (k < extra ? 1 : 0);
    out.push({ a, b });
    a = b;
  }
  return out;
}

/** Shard count + a human-readable reason. Explicit requests are capped at cores − 1, auto also by RAM. */
function shardChoice({ cpus = os.cpus().length, freeMem, requested } = {}) {
  const coreCap = Math.max(1, cpus - 1);
  const req = Number(requested);
  if (requested != null && requested !== true && req > 0) {
    const n = Math.max(1, Math.min(Math.floor(req), coreCap));
    return { shards: n, why: n < Math.floor(req) ? `--shards=${requested} capped at ${coreCap} (${cpus} cores − 1)` : `--shards=${requested}` };
  }
  const memCap = freeMem == null ? Infinity : Math.floor(freeMem / MEM_PER_SHARD);
  const n = Math.max(1, Math.min(MAX_AUTO_SHARDS, coreCap, memCap));
  const mem = freeMem == null ? '' : `, ${(freeMem / 1e9).toFixed(1)} GB available / 400 MB`;
  return { shards: n, why: `auto = min(${MAX_AUTO_SHARDS}, ${cpus} cores − 1${mem})` };
}
const pickShards = (opts) => shardChoice(opts).shards;

/**
 * → { name: 'videotoolbox'|'x264', args: [...ffmpeg video codec args] }
 * `available`: true/false (h264_videotoolbox present) or the `ffmpeg -encoders` listing (string/array).
 */
function encoderArgs({ encoder = 'auto', draft = false, available = false } = {}) {
  const hasVT = typeof available === 'boolean' ? available : /\bh264_videotoolbox\b/.test([].concat(available || []).join('\n'));
  if (!['auto', 'videotoolbox', 'x264'].includes(encoder)) throw new Error(`unknown --encoder=${encoder} (use auto, videotoolbox or x264)`);
  if (encoder === 'videotoolbox' && !hasVT) throw new Error('--encoder=videotoolbox: this ffmpeg has no h264_videotoolbox (use --encoder=x264)');
  const name = encoder === 'auto' ? (hasVT ? 'videotoolbox' : 'x264') : encoder;
  const args = name === 'videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-q:v', draft ? '50' : '75']
    : ['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '23' : '18'];
  return { name, args };
}

function parseArgv(argv) {
  const flags = {}, positional = [];
  for (const a of argv) {
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq < 0) flags[a.slice(2)] = true; else flags[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return { flags, positional };
}

const secLabel = (x) => String(+x.toFixed(2));
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

/** Duration of an audio file in seconds (ffprobe), or null when it can't be read. */
function probeAudioDuration(file) {
  try {
    const out = execFileSync(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const d = Number(out);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch { return null; }
}

/**
 * Everything the render needs from the CLI args, with draft/range defaults applied.
 * `opts.duration` overrides --duration/scenes.json (tests); `opts.probeAudio(file)` replaces ffprobe (tests).
 */
function resolveMode(argv, opts = {}) {
  const { flags, positional } = parseArgv(argv);
  const num = (name, def) => {
    const v = flags[name];
    if (v === undefined || v === true || v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${name}=${v} is not a number`);
    return n;
  };
  const htmlPath = path.resolve(positional[0] || 'index.html');
  const videoDir = path.dirname(htmlPath);
  const draft = Boolean(flags.draft);
  const range = flags.from !== undefined || flags.to !== undefined;

  const audio = typeof flags.audio === 'string' && flags.audio ? path.resolve(flags.audio) : null;
  let duration = opts.duration != null ? Number(opts.duration) : num('duration', null);
  let durationSource = opts.duration != null ? 'option' : duration != null ? '--duration' : null;
  let sceneDuration = null, audioDuration = null, holdAt = null, durationNote = null;
  if (duration == null) {
    const sidecar = path.join(videoDir, 'scenes.json');
    if (!fs.existsSync(sidecar)) throw new Error('No --duration given and no scenes.json next to HTML — cannot determine video length.');
    duration = sceneDuration = JSON.parse(fs.readFileSync(sidecar, 'utf8')).reduce((a, s) => a + s.dur, 0);
    durationSource = 'scenes.json';
    if (audio && fs.existsSync(audio)) {
      audioDuration = (opts.probeAudio || probeAudioDuration)(audio);
      const extra = audioDuration == null ? null : audioDuration - sceneDuration;
      if (extra == null) durationNote = `could not read the length of ${path.basename(audio)}; using Σdur`;
      else if (extra > TAIL_MAX_SEC) durationNote = `${path.basename(audio)} is ${extra.toFixed(2)}s longer than Σdur (more than a ${TAIL_MAX_SEC}s tail); using Σdur, the audio is cut`;
      else if (extra >= TAIL_MIN_SEC) {
        duration = audioDuration;
        durationSource = 'audio';
        holdAt = Math.max(0, sceneDuration - HOLD_EPS);
        durationNote = `${path.basename(audio)} runs ${extra.toFixed(2)}s past Σdur ${sceneDuration.toFixed(2)}s (music tail); the tail holds the closing frame`;
      } else durationNote = `${path.basename(audio)} ends with the scenes (${extra >= 0 ? '+' : ''}${extra.toFixed(2)}s)`;
    }
  }
  if (!(duration > 0)) throw new Error(`video duration must be > 0 (got ${duration})`);

  const fps = num('fps', draft ? DRAFT.fps : BASE.fps);
  const width = num('width', draft ? even(BASE.width * DRAFT.scale) : BASE.width);
  const height = num('height', draft ? even(BASE.height * DRAFT.scale) : BASE.height);
  const quality = num('quality', draft ? DRAFT.quality : BASE.quality);
  if (!(fps > 0) || !(width > 0) || !(height > 0) || !(quality >= 0 && quality <= 100)) throw new Error('--fps/--width/--height must be > 0 and --quality 0–100');

  const clamp = (x) => Math.min(duration, Math.max(0, x));
  const from = range ? clamp(num('from', 0)) : 0;
  const to = range ? clamp(num('to', duration)) : duration;
  if (!(to > from)) throw new Error(`empty range: --from=${secLabel(from)} --to=${secLabel(to)} (video is ${secLabel(duration)}s)`);

  const totalFrames = Math.ceil(duration * fps - EPS);
  const frameStart = range ? Math.max(0, Math.ceil(from * fps - EPS)) : 0;
  const frameEnd = range ? Math.min(totalFrames, Math.ceil(to * fps - EPS)) : totalFrames;
  if (!(frameEnd > frameStart)) throw new Error(`range ${secLabel(from)}s–${secLabel(to)}s contains no frame at ${fps} fps`);

  let outputPath;
  if (positional[1]) outputPath = path.resolve(positional[1]);
  else if (range) outputPath = path.join(videoDir, `clip-${secLabel(from)}s-${secLabel(to)}s${draft ? '-draft' : ''}.mp4`);
  else if (draft) outputPath = path.join(videoDir, 'draft.mp4');
  else outputPath = path.resolve(htmlPath.replace(/\.html$/, '.mp4').replace(/index\.mp4$/, 'output.mp4'));

  return {
    htmlPath, videoDir, outputPath,
    fps, width, height, quality, duration, durationSource, sceneDuration, audioDuration, holdAt, durationNote,
    draft, range, from, to, totalFrames, frameStart, frameEnd,
    gate: !draft && !range && !flags['no-preview-gate'],
    audio,
    shards: flags.shards === undefined || flags.shards === true ? null : flags.shards,
    encoder: typeof flags.encoder === 'string' ? flags.encoder : 'auto',
    gpu: Boolean(flags.gpu),
    keepSegments: Boolean(flags['keep-segments']),
    framesDirFlag: flags['frames-dir'] !== undefined,
  };
}

/** Capture time of frame i: i/fps, held at the closing frame during a music tail. */
const frameTime = (mode, i) => (mode.holdAt != null ? Math.min(i / mode.fps, mode.holdAt) : i / mode.fps);

module.exports = { planShards, pickShards, encoderArgs, resolveMode, shardChoice, frameTime, probeAudioDuration, TAIL_MIN_SEC, TAIL_MAX_SEC };
// (startServer, captureFrame, PROJECT_ROOT are appended below for the e2e test's cold-seek check)

// ── Environment probes ────────────────────────────────────────────────────────

let encodersCache;
/** `ffmpeg -encoders` listing (cached in-process), or null when ffmpeg is missing. */
function ffmpegEncoders() {
  if (encodersCache === undefined) {
    try { encodersCache = execFileSync(FFMPEG(), ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { encodersCache = null; }
  }
  return encodersCache;
}

/** macOS os.freemem() counts only never-used pages (often < 100 MB); inactive + purgeable pages are reclaimable too. */
function availableMemory() {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 3000 });
      const pageSize = Number((out.match(/page size of (\d+) bytes/) || [])[1]) || 4096;
      const pages = (k) => Number((out.match(new RegExp(`Pages ${k}:\\s+(\\d+)`)) || [])[1]) || 0;
      const avail = (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * pageSize;
      if (avail > 0) return avail;
    } catch { /* fall through */ }
  }
  return os.freemem();
}

/** Frame count of a video file: container nb_frames (fast), decoded count as fallback; 0 if unreadable. */
function probeFrames(file, { decode = false } = {}) {
  const run = (args) => {
    try { return execFileSync(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', ...args, '-of', 'csv=p=0', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  };
  const n = decode ? NaN : parseInt(run(['-show_entries', 'stream=nb_frames']), 10);
  if (Number.isFinite(n)) return n;
  return parseInt(run(['-count_frames', '-show_entries', 'stream=nb_read_frames']), 10) || 0;
}

// ── Local HTTP server: the project root (core/serve.js), so ../../runtime/animations.jsx resolves ──

/** → Promise<{ server, port }> serving `dir` (a project root) on 127.0.0.1, random port. */
function startServer(dir) {
  return serve.start(dir).then(({ server, port }) => ({ server, port }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => path.relative(process.cwd(), p) || '.';
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
const clock = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSec = (x) => String(+x.toFixed(6));

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function runFfmpeg(args, children) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    children.add(ff);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d; });
    ff.on('error', reject);
    ff.on('close', (code, signal) => {
      children.delete(ff);
      if (code === 0) resolve(); else reject(new Error(`ffmpeg exited with ${signal || `code ${code}`}:\n${stderr.trim()}`));
    });
  });
}

function makeProgress(ctx) {
  const tty = Boolean(process.stdout.isTTY);
  let last = 0, lastLen = 0;
  const line = () => {
    const done = ctx.reusedFrames + ctx.captured;
    const pct = ctx.frames ? Math.floor((done / ctx.frames) * 100) : 100;
    const filled = Math.round(pct / 4);
    const secs = (Date.now() - ctx.captureStart) / 1000;
    const fps = secs > 0 ? ctx.captured / secs : 0;
    const eta = fps > 0 ? clock((ctx.frames - done) / fps) : '–:––';
    return `[${'█'.repeat(filled)}${'░'.repeat(25 - filled)}] ${pct}%  ${done}/${ctx.frames} frames  ${fps.toFixed(0)} fps  ETA ${eta}  (${ctx.activeShards} shard${ctx.activeShards === 1 ? '' : 's'})`;
  };
  return {
    tick(force = false) {
      const now = Date.now();
      if (!force && now - last < (tty ? 200 : 5000)) return;
      last = now;
      const s = line();
      if (tty) { process.stdout.write(`\r${s}${' '.repeat(Math.max(0, lastLen - s.length))}`); lastLen = s.length; }
      else process.stdout.write(`${s}\n`);
    },
    end() { this.tick(true); if (tty) process.stdout.write('\n'); lastLen = 0; },
    clear() { if (tty && lastLen) process.stdout.write('\n'); lastLen = 0; },
  };
}

// ── Browser sessions ──────────────────────────────────────────────────────────

function launchOptions(gpu) {
  const common = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }; // our SIGINT handler owns cleanup
  return gpu ? { ...common, channel: 'chromium', args: GPU_ARGS } : { ...common, args: HEADLESS_ARGS };
}

async function openSession(ctx) {
  const { chromium } = require('playwright');
  const session = { browser: null, errors: [] };
  ctx.sessions.add(session);
  try {
    session.browser = await chromium.launch(launchOptions(ctx.gpu));
    if (ctx.aborted) throw ctx.abortError;
    const page = await session.browser.newPage();
    page.on('pageerror', (e) => session.errors.push(firstLine(e)));
    page.on('console', (m) => { if (m.type() === 'error') session.errors.push(m.text().split('\n')[0]); });
    await page.setViewportSize({ width: ctx.mode.width, height: ctx.mode.height });
    await page.goto(ctx.url, { waitUntil: 'load', timeout: 30000 });
    // Wait for Babel to transpile and React to mount (exposes window.__stage)
    await page.waitForFunction(() => typeof window.__stage !== 'undefined', null, { timeout: 30000 }).catch((err) => {
      const errs = session.errors.length ? `; page errors: ${session.errors.slice(0, 3).join(' | ')}` : '';
      throw new Error(`window.__stage never appeared (${firstLine(err)})${errs}`);
    });
    await page.waitForTimeout(1200); // let fonts and images settle
    session.page = page;
    session.cdp = await page.context().newCDPSession(page);
    return session;
  } catch (err) {
    await closeSession(ctx, session);
    throw err;
  }
}

async function closeSession(ctx, session) {
  if (!session) return;
  ctx.sessions.delete(session);
  if (session.browser) await Promise.race([session.browser.close().catch(() => {}), sleep(5000)]);
}

/**
 * In-page: one rAF (React has committed the new time), then wait for anything the new DOM still needs —
 * <img>s mounted by a Sprite window that just opened, font faces first used by this frame (a forced layout
 * starts their load) — and give them one more rAF to paint. Nothing pending (the usual case): < 1 ms, and
 * the frame is exactly setTime → 1 rAF → capture. A cold seek (every shard start, every scene boundary)
 * would otherwise race the photo load and capture a frame without it.
 */
function frameReady() {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  return raf().then(async () => {
    void document.body.offsetHeight; // style + layout now, so newly used font faces start loading
    const imgs = Array.from(document.images).filter((i) => !i.complete);
    const fontsLoading = Boolean(document.fonts) && document.fonts.status === 'loading';
    if (!imgs.length && !fontsLoading) return 0;
    await Promise.all([
      document.fonts ? document.fonts.ready : null,
      ...imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })),
    ]);
    await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    await raf();
    return imgs.length + (fontsLoading ? 1 : 0);
  });
}

async function captureFrame(session, t, quality) {
  await withTimeout(session.page.evaluate((time) => window.__stage.setTime(time), t), FRAME_TIMEOUT_MS, 'setTime');
  await withTimeout(session.page.evaluate(frameReady), FRAME_TIMEOUT_MS, 'frame readiness (rAF + images/fonts)');
  const { data } = await withTimeout(session.cdp.send('Page.captureScreenshot', {
    format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false,
  }), FRAME_TIMEOUT_MS, 'screenshot');
  return Buffer.from(data, 'base64');
}

Object.assign(module.exports, { startServer, captureFrame, PROJECT_ROOT });

// ── Per-segment encoder (ffmpeg reading JPEGs from stdin) ────────────────────

function startEncoder(ctx, seg) {
  const partial = seg.file.replace(/\.mp4$/, '.partial.mp4');
  const ff = spawn(FFMPEG(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(ctx.mode.fps), '-i', 'pipe:0',
    ...ctx.enc.args, '-pix_fmt', 'yuv420p', partial], { stdio: ['pipe', 'ignore', 'pipe'] });
  ctx.children.add(ff);
  let stderr = '', ended = false;
  ff.stderr.on('data', (d) => { stderr += d; });
  ff.stdin.on('error', () => {}); // EPIPE surfaces through 'close' below
  const exit = new Promise((resolve) => {
    ff.on('error', (err) => { stderr += `\n${err.message}`; resolve({ code: -1 }); });
    ff.on('close', (code, signal) => resolve({ code, signal }));
  }).then((r) => { ctx.children.delete(ff); return r; });
  const earlyError = (r) => new Error(`ffmpeg for ${path.basename(seg.file)} exited early (${r.signal || `code ${r.code}`}):\n${stderr.trim() || '(no stderr)'}`);
  const died = exit.then((r) => { if (!ended) throw earlyError(r); });
  died.catch((err) => ctx.abort(err));
  return {
    async write(buf) {
      if (!ff.stdin.write(buf)) {
        await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), died]);
      }
    },
    async finish() {
      ended = true;
      ff.stdin.end();
      const r = await exit;
      if (r.code !== 0) throw new Error(`ffmpeg for ${path.basename(seg.file)} failed (${r.signal || `code ${r.code}`}):\n${stderr.trim()}`);
      const got = probeFrames(partial);
      if (got !== seg.b - seg.a) throw new Error(`${path.basename(seg.file)}: encoded ${got} frames, expected ${seg.b - seg.a}`);
      fs.renameSync(partial, seg.file);
    },
  };
}

// ── Shard worker ──────────────────────────────────────────────────────────────

async function runShard(ctx, shard) {
  const todo = shard.segments.filter((s) => !s.reused);
  if (!todo.length) return;
  let session = null, relaunches = 0;
  const finishing = [];
  const relaunch = async (why) => {
    if (relaunches >= MAX_RELAUNCHES) throw new Error(`shard ${shard.k}: giving up after ${MAX_RELAUNCHES} browser relaunches (${why})`);
    relaunches++;
    ctx.progress.clear();
    console.error(`shard ${shard.k}: ${why} — relaunching browser (${relaunches}/${MAX_RELAUNCHES})…`);
    await closeSession(ctx, session);
    session = null;
  };
  try {
    for (const seg of todo) {
      const enc = startEncoder(ctx, seg);
      for (let i = seg.a; i < seg.b; i++) {
        let buf = null;
        for (let attempt = 1; buf === null;) {
          if (ctx.aborted) throw ctx.abortError;
          if (!session) {
            try { session = await openSession(ctx); }
            catch (err) { if (ctx.aborted) throw ctx.abortError; await relaunch(`page failed to open: ${firstLine(err)}`); continue; }
          }
          try { buf = await captureFrame(session, frameTime(ctx.mode, i), ctx.mode.quality); }
          catch (err) {
            if (ctx.aborted) throw ctx.abortError;
            if (attempt < FRAME_TRIES) {
              ctx.progress.clear();
              console.error(`shard ${shard.k}: frame ${i} failed (try ${attempt}/${FRAME_TRIES}): ${firstLine(err)} — retrying…`);
              attempt++;
            } else {
              await relaunch(`frame ${i} failed ${FRAME_TRIES}×: ${firstLine(err)}`);
              attempt = 1;
            }
          }
        }
        await enc.write(buf);
        ctx.captured++;
        ctx.progress.tick();
      }
      const done = enc.finish(); // finalize in the background while the next segment captures
      done.catch((err) => ctx.abort(err));
      finishing.push(done);
    }
    await Promise.all(finishing);
  } finally {
    await Promise.allSettled(finishing);
    await closeSession(ctx, session);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function usage() {
  console.log('Usage: node renderer/render.js <index.html> [output.mp4] [--fps=30] [--duration=S] [--width=720] [--height=1280] [--audio=path.mp3]\n' +
    '         [--shards=N] [--quality=95] [--encoder=auto|videotoolbox|x264] [--draft] [--from=S] [--to=S] [--gpu] [--keep-segments] [--no-preview-gate]');
}

function cacheKey(mode, enc, gpu) {
  let fp;
  try { fp = require('../tools/approve-preview').fingerprint(mode.videoDir); }
  catch { // not a standard video folder (no index.html/scenes.json) — hash the page + runtime instead
    const h = crypto.createHash('sha256').update(fs.readFileSync(mode.htmlPath));
    const runtime = path.join(project.rootFor(mode.videoDir), 'runtime', 'animations.jsx');
    if (fs.existsSync(runtime)) h.update(fs.readFileSync(runtime));
    fp = h.digest('hex');
  }
  const params = { fps: mode.fps, width: mode.width, height: mode.height, quality: mode.quality, encoderArgs: enc.args,
    from: mode.range ? mode.from : null, to: mode.range ? mode.to : null };
  if (mode.holdAt != null) params.holdAt = mode.holdAt; // tail frames are captured at the closing frame
  if (gpu) params.gpu = true; // GPU raster pixels differ — never mix with software-raster segments
  return crypto.createHash('sha256').update(fp).update(JSON.stringify(params)).digest('hex').slice(0, 12);
}

async function main(argv, ctx) {
  if (!argv.length || argv.includes('--help')) { usage(); return 0; }
  const t0 = Date.now();
  let mode;
  try { mode = resolveMode(argv); } catch (err) { console.error(err.message); return 1; }
  ctx.mode = mode;
  env.ensureOnPath();
  if (mode.durationSource === 'scenes.json') console.log(`Duration from scenes.json: ${mode.duration.toFixed(2)}s${mode.durationNote ? ` (${mode.durationNote})` : ''}`);
  if (mode.durationSource === 'audio') console.log(`Duration from --audio: ${mode.duration.toFixed(2)}s (${mode.durationNote})`);

  const encoders = ffmpegEncoders();
  if (!encoders) { console.error('\nFFmpeg not found. Install: brew install ffmpeg'); return 1; }
  if (!fs.existsSync(mode.htmlPath)) { console.error(`\nHTML not found: ${mode.htmlPath}`); return 1; }
  const cacheRoot = path.join(mode.videoDir, 'frames', 'render-cache');
  if (mode.framesDirFlag) console.log(`Note: --frames-dir was removed; crash resume is automatic via the segment cache in ${rel(cacheRoot)}/.`);
  if (mode.gate) {
    const gate = require('../tools/approve-preview').checkApproval(mode.videoDir);
    if (!gate.ok) {
      const r = path.relative(process.cwd(), mode.videoDir) || '.';
      console.error(`\nPreview gate: ${gate.reason}.`);
      console.error(`  1. reelsmith draft ${r}  and  reelsmith sheet ${r} --stills`);
      console.error(`  2. show the user draft.mp4, the contact sheet and the stills; wait for an explicit "approved"`);
      console.error(`  3. reelsmith approve ${r} --by="<who>"   then re-run this render`);
      return 3;
    }
  }

  let enc;
  try { enc = encoderArgs({ encoder: mode.encoder, draft: mode.draft, available: encoders }); }
  catch (err) { console.error(err.message); return 1; }
  ctx.enc = enc;

  if (mode.gpu) { // probe once so every shard uses the same raster path
    try { const b = await require('playwright').chromium.launch(launchOptions(true)); await b.close(); ctx.gpu = true; }
    catch (err) { console.error(`--gpu: full Chromium failed to launch (${firstLine(err)}) — falling back to the headless shell for this render.`); }
  }

  let audio = mode.audio;
  if (audio && !fs.existsSync(audio)) { console.error(`Warning: --audio file not found (${audio}) — rendering without audio.`); audio = null; }

  // Segment cache: <videoDir>/frames/render-cache/<key>/seg-<k>-<a>-<b>.mp4
  const key = cacheKey(mode, enc, ctx.gpu);
  const cacheDir = path.join(cacheRoot, key);
  ctx.cacheDir = cacheDir;
  let stale = 0;
  if (fs.existsSync(cacheRoot)) {
    for (const d of fs.readdirSync(cacheRoot)) if (d !== key) { fs.rmSync(path.join(cacheRoot, d), { recursive: true, force: true }); stale++; }
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const f of fs.readdirSync(cacheDir)) if (f.endsWith('.partial.mp4')) fs.rmSync(path.join(cacheDir, f), { force: true });

  // Shards (reuse the interrupted run's layout on resume so its segments line up)
  const planFile = path.join(cacheDir, 'plan.json');
  const cpus = os.cpus().length;
  let choice = shardChoice({ cpus, freeMem: availableMemory(), requested: mode.shards });
  if (mode.shards == null && fs.existsSync(planFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(planFile, 'utf8')).shards;
      if (saved > 0 && saved !== choice.shards) choice = { shards: Math.min(saved, Math.max(1, cpus - 1)), why: 'same as the interrupted run being resumed' };
    } catch { /* ignore a corrupt plan */ }
  }
  const frames = mode.frameEnd - mode.frameStart;
  const segLen = Math.max(1, Math.round(SEGMENT_SEC * mode.fps));
  const shards = planShards(frames, choice.shards, mode.frameStart).map((r, k) => ({
    k, ...r,
    segments: planShards(r.b - r.a, Math.ceil((r.b - r.a) / segLen), r.a).map((s) => ({ ...s, file: path.join(cacheDir, `seg-${k}-${s.a}-${s.b}.mp4`) })),
  }));
  fs.writeFileSync(planFile, JSON.stringify({ shards: shards.length, frameStart: mode.frameStart, frameEnd: mode.frameEnd }) + '\n');

  const segments = shards.flatMap((s) => s.segments);
  for (const seg of segments) {
    if (fs.existsSync(seg.file) && fs.statSync(seg.file).size > 0 && probeFrames(seg.file) === seg.b - seg.a) {
      seg.reused = true;
      console.log(`reusing ${path.basename(seg.file)}`);
    }
  }
  ctx.frames = frames;
  ctx.reusedFrames = segments.filter((s) => s.reused).reduce((a, s) => a + s.b - s.a, 0);
  const busy = shards.filter((s) => s.segments.some((g) => !g.reused));
  ctx.activeShards = busy.length || shards.length;

  const kind = mode.draft && mode.range ? 'draft clip' : mode.draft ? 'draft' : mode.range ? 'clip' : 'final';
  console.log(`\nRendering: ${rel(mode.htmlPath)}  (${kind})`);
  console.log(`Output:    ${mode.outputPath}`);
  console.log(`Specs:     ${mode.width}×${mode.height} @ ${mode.fps}fps  ${mode.duration.toFixed(2)}s  (${mode.totalFrames} frames)` +
    (mode.range ? `  range ${secLabel(mode.from)}s–${secLabel(mode.to)}s → frames ${mode.frameStart}–${mode.frameEnd} (${frames})` : ''));
  console.log(`Capture:   JPEG q${mode.quality}, ${ctx.gpu ? 'full Chromium + GPU raster (--gpu)' : 'headless shell, software raster'}`);
  console.log(`Encoder:   ${enc.args.join(' ')}`);
  console.log(`Shards:    ${shards.length} (${choice.why})`);
  console.log(`Cache:     ${rel(cacheDir)}  ${segments.filter((s) => s.reused).length}/${segments.length} segments reusable${stale ? `, removed ${stale} stale` : ''}`);
  console.log(`Audio:     ${audio ? rel(audio) + (mode.range ? ` (trimmed ${fmtSec(mode.frameStart / mode.fps)}s + ${fmtSec(frames / mode.fps)}s)` : '') : 'none'}\n`);

  // Capture + encode (serve the video's project root, not the framework checkout)
  const root = project.rootFor(mode.videoDir);
  const { server, port } = await startServer(root);
  ctx.server = server;
  ctx.url = `http://127.0.0.1:${port}${serve.urlFor(root, mode.htmlPath)}?render=1`;
  ctx.progress = makeProgress(ctx);
  ctx.captureStart = Date.now();
  if (busy.length) {
    ctx.progress.tick(true);
    await Promise.allSettled(busy.map((s) => runShard(ctx, s).catch((err) => ctx.abort(err))));
    if (ctx.aborted) { ctx.progress.clear(); throw ctx.abortError; }
    ctx.progress.end();
  }
  const captureSecs = (Date.now() - ctx.captureStart) / 1000;
  server.close();

  // Concat (+ audio)
  console.log(ctx.reusedFrames === frames ? 'All segments cached — concatenating…' : 'Concatenating segments…');
  const listFile = path.join(cacheDir, 'list.txt');
  fs.writeFileSync(listFile, segments.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  fs.mkdirSync(path.dirname(mode.outputPath), { recursive: true });
  const partialOut = `${mode.outputPath}.partial`;
  ctx.partialOut = partialOut;
  const audioIn = audio ? [...(mode.range ? ['-ss', fmtSec(mode.frameStart / mode.fps), '-t', fmtSec(frames / mode.fps)] : []), '-i', audio] : [];
  await runFfmpeg(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, ...audioIn,
    '-map', '0:v:0', ...(audio ? ['-map', '1:a:0'] : []), '-c:v', 'copy',
    // apad + -shortest: the video decides the length, so the last frame survives an audio track that
    // ends mid-frame (plain -shortest drops it); a longer audio track is still cut at the last frame.
    ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest'] : []), '-movflags', '+faststart', '-f', 'mp4', partialOut], ctx.children);
  fs.renameSync(partialOut, mode.outputPath);

  const outFrames = probeFrames(mode.outputPath);
  if (!mode.keepSegments) fs.rmSync(cacheDir, { recursive: true, force: true });
  for (const d of [cacheRoot, path.dirname(cacheRoot)]) { // drop render-cache/ and frames/ when we left them empty
    if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmSync(d, { recursive: true, force: true });
  }

  const wall = (Date.now() - t0) / 1000;
  const sizeMB = (fs.statSync(mode.outputPath).size / MB).toFixed(1);
  console.log(`\nDone! → ${mode.outputPath} (${sizeMB} MB)`);
  console.log(`  wall ${clock(wall)} (${wall.toFixed(1)}s) · ${outFrames} frames${outFrames === frames ? '' : ` (expected ${frames}!)`}` +
    ` · captured ${ctx.captured} at ${captureSecs > 0 && ctx.captured ? (ctx.captured / captureSecs).toFixed(1) : '–'} fps, reused ${ctx.reusedFrames}` +
    ` · encoder ${enc.name} (${enc.args.slice(1).join(' ')}) · ${shards.length} shard${shards.length === 1 ? '' : 's'}` +
    (mode.keepSegments ? ` · segments kept in ${rel(cacheDir)}` : '') + '\n');
  return 0;
}

if (require.main === module) {
  const ctx = {
    mode: null, enc: null, gpu: false, url: null, server: null, cacheDir: null, partialOut: null, progress: { tick() {}, end() {}, clear() {} },
    frames: 0, captured: 0, reusedFrames: 0, activeShards: 0, captureStart: Date.now(),
    sessions: new Set(), children: new Set(), closing: [], aborted: false, abortError: null,
    abort(err) {
      if (ctx.aborted) return;
      ctx.aborted = true;
      ctx.abortError = err;
      for (const ff of ctx.children) { try { ff.kill('SIGKILL'); } catch { /* already gone */ } }
      ctx.closing = [...ctx.sessions].map((s) => closeSession(ctx, s));
    },
  };
  let interrupted = false;
  const onSignal = (sig, code) => async () => {
    if (interrupted) process.exit(code); // second Ctrl+C: leave now
    interrupted = true;
    ctx.progress.clear();
    const kept = ctx.cacheDir ? ` Finished segments stay in ${rel(ctx.cacheDir)} — re-run the same command to resume.` : '';
    console.error(`\n${sig}: stopping browsers and encoders.${kept}`);
    ctx.abort(new Error(sig));
    await Promise.race([Promise.allSettled([...ctx.closing, ...[...ctx.sessions].map((s) => closeSession(ctx, s))]), sleep(3000)]);
    if (ctx.partialOut) fs.rmSync(ctx.partialOut, { force: true });
    if (ctx.cacheDir && fs.existsSync(ctx.cacheDir)) {
      for (const f of fs.readdirSync(ctx.cacheDir)) if (f.endsWith('.partial.mp4')) fs.rmSync(path.join(ctx.cacheDir, f), { force: true });
    }
    process.exit(code);
  };
  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));

  main(process.argv.slice(2), ctx).then(
    (code) => { if (!interrupted) process.exit(code); },
    (err) => {
      if (interrupted) return;
      ctx.abort(err);
      console.error(`\nRender failed: ${err && err.message ? err.message : err}`);
      if (ctx.cacheDir) console.error(`Finished segments stay cached in ${rel(ctx.cacheDir)} — re-run the same command to resume.`);
      setTimeout(() => process.exit(1), 200);
    },
  );
}
