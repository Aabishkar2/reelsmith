'use strict';
/**
 * pipeline/denoise.js — background-noise removal for everything the cut plays (docs/spec.md §7c).
 *
 * Whisper + analysis always use the ORIGINAL audio (a denoiser smears word
 * onsets); cut.js renders voiceover/sN.mp3 from the CLEAN sibling of every
 * source — the take and each re-record clip — including the room tone kept
 * between sentences.
 *
 *  cleanPath(src)                takes/take-02.hq.wav → takes/take-02.clean.wav
 *  ensureClean(src, { config, force, quiet }) → { file, engine, cached, warning }
 *      (re)generates <base>.clean.wav (48 kHz mono s16) + <base>.clean.json only
 *      when the clean file is missing, older than the source, or was made with
 *      other settings. Never touches the source.
 *      engine 'deepfilternet': pipeline/denoise_dfn.py run by denoise.python
 *        (default python3.11; DeepFilterNet pins numpy<2, so a separate venv
 *        python is the safe install), attenuation capped at denoise.attenLimitDb
 *        so the voice doesn't go underwater.
 *      fallback (engine missing/failing, or engine 'afftdn'): ffmpeg highpass +
 *        lowpass voice band + afftdn. Weaker on non-stationary noise (barks) —
 *        the result carries a warning that finalize/CLI surface. Never blocks.
 *      Every engine's output is checked (48 kHz, same length) and re-aligned to
 *      the source (estimateLag: afftdn adds ~25 ms) — cuts and word times are
 *      computed on the original, so the clean file must line up sample-exactly.
 *  enabledFor(videoDir, cfg)     per-video switch: videos/<name>/settings.json
 *                                { "denoise": bool } overrides denoise.enabled
 *  setEnabled(videoDir, on)      writes that switch
 *  gateOutsideWords(...)         cut.js helper: frames outside the kept words that
 *                                jump > gate.aboveRoomDb over the scene's room tone
 *                                (a bark in a pause or a sentence gap) are pulled
 *                                down to room tone, with smooth gain ramps.
 *  engines                       { deepfilternet, afftdn } (exported so tests can stub)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig } = require('./config');
const audio = require('./audio');

const DFN_SCRIPT = path.join(__dirname, 'denoise_dfn.py');

function base(src) { return String(src).replace(/(\.hq)?\.wav$/i, ''); }
function cleanPath(src) { return `${base(src)}.clean.wav`; }
function metaPath(src) { return `${base(src)}.clean.json`; }

function settingsOf(cfg) {
  const d = cfg.denoise;
  return { engine: d.engine, attenLimitDb: d.attenLimitDb, fallback: d.fallback };
}

const engines = {
  deepfilternet(src, out, d) {
    const r = spawnSync(d.python || 'python3.11', [DFN_SCRIPT, src, out, `--atten=${d.attenLimitDb}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (d.timeoutSec || 600) * 1000 });
    if (r.error) throw new Error(`${d.python || 'python3.11'} could not start: ${r.error.message}`);
    if (r.status !== 0) {
      const tail = String(r.stderr || '').trim().split('\n').filter(Boolean).slice(-1)[0] || `exit ${r.status}`;
      throw new Error(tail.replace(/^.*ModuleNotFoundError: /, ''));
    }
  },
  afftdn(src, out, d) {
    const f = d.fallback;
    const chain = [`highpass=f=${f.highpassHz}`, `lowpass=f=${f.lowpassHz}`,
      `afftdn=nr=${f.nr}:nf=${f.nf}${f.trackNoise ? ':tn=1' : ''}`].join(',');
    audio.ffmpeg(['-loglevel', 'error', '-i', src, '-af', chain, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  },
};

/**
 * Latency of `out` vs `src` in samples (> 0 = out is late): median over 3 loud
 * 0.2 s windows of the lag (±maxMs) maximizing the cross-correlation.
 * ffmpeg afftdn, for one, delays its output by ~25 ms at 48 kHz.
 */
function estimateLag(src, out, maxMs = 60) {
  const sr = src.sampleRate, a = src.samples, b = out.samples;
  const n = Math.round(0.2 * sr), L = Math.round(maxMs / 1000 * sr);
  const blocks = [];
  for (let i = L; i + n + L < a.length; i += n) { let e = 0; for (let j = i; j < i + n; j += 4) e += a[j] * a[j]; blocks.push({ i, e }); }
  const picks = [];
  for (const blk of blocks.sort((x, y) => y.e - x.e)) {
    if (picks.length >= 3) break;
    if (picks.every(p => Math.abs(p - blk.i) > sr)) picks.push(blk.i);
  }
  const lagAt = (i, lo, hi, step) => {
    let best = 0, bv = -Infinity;
    for (let l = lo; l <= hi; l += step) {
      let v = 0;
      for (let j = i; j < i + n; j += 2) v += a[j] * b[j + l];
      if (v > bv) { bv = v; best = l; }
    }
    return best;
  };
  const lags = picks.map(i => { const c = lagAt(i, -L, L, 4); return lagAt(i, c - 4, c + 4, 1); }).sort((x, y) => x - y);
  return lags.length ? lags[Math.floor(lags.length / 2)] : 0;
}

/** Shift `file` (mono s16 wav) earlier by `lag` samples (later if negative), keeping its length. */
function shiftWav(file, lag) {
  const p = audio.readWav(file), n = p.samples.length, y = new Int16Array(n);
  for (let i = 0; i < n; i++) { const j = i + lag; if (j >= 0 && j < n) y[i] = p.samples[j]; }
  audio.writeWav(file, { sampleRate: p.sampleRate, samples: y });
}

function readMeta(src) { try { return JSON.parse(fs.readFileSync(metaPath(src), 'utf8')); } catch (_) { return null; } }

/** Is the cached clean file usable for `src` under `cfg`? */
function isFresh(src, cfg) {
  const file = cleanPath(src), meta = readMeta(src);
  if (!meta || !fs.existsSync(file)) return false;
  if (fs.statSync(src).mtimeMs > (meta.srcMtimeMs ?? fs.statSync(file).mtimeMs)) return false;     // source newer than what was denoised
  return JSON.stringify(meta.settings) === JSON.stringify(settingsOf(cfg));
}

function ensureClean(src, opts = {}) {
  const cfg = opts.config || loadConfig();
  const d = cfg.denoise;
  if (!fs.existsSync(src)) throw new Error(`denoise: no such file ${src}`);
  const file = cleanPath(src);
  if (path.resolve(file) === path.resolve(src)) throw new Error(`denoise: refusing to overwrite the source ${src}`);
  if (!opts.force && isFresh(src, cfg)) {
    const m = readMeta(src);
    return { file, engine: m.engine, cached: true, warning: m.warning || null };
  }
  const tmp = `${file}.tmp-${process.pid}.wav`;
  const srcMtime = fs.statSync(src).mtimeMs;
  const srcDur = audio.duration(src);
  const check = () => {                               // the result must be a real, same-length 48 kHz mono wav
    const pcm = audio.readWav(tmp);
    const dur = pcm.samples.length / pcm.sampleRate;
    if (pcm.sampleRate !== 48000) throw new Error(`output is ${pcm.sampleRate} Hz, expected 48000`);
    if (Math.abs(dur - srcDur) > 0.05) throw new Error(`output is ${dur.toFixed(3)}s, source ${srcDur.toFixed(3)}s`);
  };
  let engine = d.engine === 'afftdn' ? 'afftdn' : 'deepfilternet', warning = null, lagMs = 0;
  const t0 = Date.now();
  const align = () => {                               // cuts + word times come from the ORIGINAL: undo engine latency
    const lag = estimateLag(audio.readWav(src), audio.readWav(tmp));
    if (Math.abs(lag) >= 24) shiftWav(tmp, lag);      // ≥ 0.5 ms
    lagMs = Math.round(lag / 48 * 10) / 10;
  };
  try {
    if (engine === 'deepfilternet') {
      try { engines.deepfilternet(src, tmp, d); check(); align(); } catch (e) {
        fs.rmSync(tmp, { force: true });
        warning = `DeepFilterNet unavailable for ${path.basename(src)} (${String(e.message).split('\n')[0]}) — used the ffmpeg afftdn fallback (weaker on barks)`;
        engine = 'afftdn';
      }
    }
    if (engine === 'afftdn') { engines.afftdn(src, tmp, d); check(); align(); }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
  const meta = { settings: settingsOf(cfg), engine, warning, lagMs, source: path.basename(src), srcMtimeMs: srcMtime,
    at: new Date().toISOString(), sec: Math.round((Date.now() - t0) / 100) / 10 };
  fs.writeFileSync(metaPath(src), JSON.stringify(meta, null, 2));
  if (!opts.quiet) console.error(`  denoise (${engine}${warning ? ', fallback' : ''}) ${path.basename(src)} → ${path.basename(file)} in ${meta.sec}s`);
  return { file, engine, cached: false, warning };
}

// ── per-video switch ─────────────────────────────────────────────────────────
function settingsFile(videoDir) { return path.join(videoDir, 'settings.json'); }
function readSettings(videoDir) { try { return JSON.parse(fs.readFileSync(settingsFile(videoDir), 'utf8')); } catch (_) { return {}; } }
function enabledFor(videoDir, cfg = loadConfig()) {
  const s = readSettings(videoDir);
  return typeof s.denoise === 'boolean' ? s.denoise : cfg.denoise.enabled !== false;
}
function setEnabled(videoDir, on) {
  const s = { ...readSettings(videoDir), denoise: !!on };
  fs.writeFileSync(settingsFile(videoDir), JSON.stringify(s, null, 2) + '\n');
  return s;
}

// ── bark gate for the rendered scene ─────────────────────────────────────────
/**
 * samples: Int16Array (modified in place), keep: [{start,end}] seconds that are
 * speech (kept words ± padSec). Frames outside `keep` whose RMS exceeds the
 * scene's room tone (median dB of those frames) by > aboveRoomDb are scaled down
 * to room tone. Returns { roomDb, gatedFrames, maxCutDb }.
 */
function gateOutsideWords(samples, sampleRate, keep, g) {
  const hop = Math.round(sampleRate * g.frameSec);
  const nF = Math.floor(samples.length / hop);
  if (nF < 3) return { roomDb: null, gatedFrames: 0, maxCutDb: 0 };
  const inKeep = new Uint8Array(nF);
  for (const k of keep) for (let f = Math.max(0, Math.floor((k.start - g.padSec) * sampleRate / hop)); f <= Math.min(nF - 1, Math.ceil((k.end + g.padSec) * sampleRate / hop)); f++) inKeep[f] = 1;
  const db = new Float32Array(nF);
  const out = [];
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += samples[i] * samples[i];
    const ms = s / hop / (32768 * 32768);
    db[f] = ms > 0 ? 10 * Math.log10(ms) : -91;
    if (!inKeep[f]) out.push(db[f]);
  }
  if (out.length < 3) return { roomDb: null, gatedFrames: 0, maxCutDb: 0 };
  const roomDb = audio.percentile(out, 50);
  const gain = new Float32Array(nF).fill(1);
  let gated = 0, maxCut = 0;
  for (let f = 0; f < nF; f++) {
    if (inKeep[f] || db[f] <= roomDb + g.aboveRoomDb) continue;
    const cut = db[f] - roomDb;
    gain[f] = Math.pow(10, -cut / 20); gated++; if (cut > maxCut) maxCut = cut;
  }
  if (!gated) return { roomDb, gatedFrames: 0, maxCutDb: 0 };
  // smooth: a frame's gain is the min over ±1 frame, then linear interpolation per sample
  const sm = gain.map((v, f) => Math.min(v, gain[f - 1] ?? 1, gain[f + 1] ?? 1));
  for (let f = 0; f < nF; f++) {
    const a = sm[f], b = f + 1 < nF ? sm[f + 1] : sm[f];
    if (a === 1 && b === 1) continue;
    for (let i = 0; i < hop; i++) samples[f * hop + i] = Math.round(samples[f * hop + i] * (a + (b - a) * (i / hop)));
  }
  return { roomDb: Math.round(roomDb * 10) / 10, gatedFrames: gated, maxCutDb: Math.round(maxCut * 10) / 10 };
}

module.exports = { cleanPath, metaPath, ensureClean, isFresh, enabledFor, setEnabled, readSettings, gateOutsideWords, estimateLag, engines, DFN_SCRIPT };
