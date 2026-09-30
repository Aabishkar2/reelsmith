'use strict';
/**
 * pipeline/tts.js — script.md → scenes.json + voiceover.mp3 with a TTS voice
 * instead of a recorded take (same v1 contract as cut.js:
 * [{ idx, dur, file: "voiceover/sN.mp3", words: [{word,start,end}] }]).
 *
 * synthesize(videoDir, opts) → { scenes, totalSec, model, voice, speed, timings, apiCalls, … }
 *
 * Settings (config/tts.json, config/audio.md). Precedence per key:
 *   flag (opts) > script.md frontmatter (tts_model / tts_voice / tts_speed)
 *   > what this video used last time (voiceover/tts/meta.json; model + voice only)
 *   > env (TTS_MODEL / TTS_VOICE / TTS_SPEED) > config/tts.json.
 *   model  default google/gemini-3.8-flash-tts (the creator's pick)
 *   voice  NO default — the creator names one per video; missing → clear error
 *   speed  default 1.15 (creator's pick, 2026-09-29). ffmpeg atempo (pitch kept)
 *          on the cached clips, so changing it never re-calls the API. Gaps and
 *          tails shrink by the same factor, like speeding up the whole file.
 *
 * Each sentence is one OpenRouter /api/v1/audio/speech call
 * ({ model, voice, input, response_format }), cached as
 * voiceover/tts/<sha1(model|voice|text)>.wav, so re-runs only pay for changed
 * lines. Head/tail silence is trimmed, sentences are joined with
 * sentenceGapSec of silence and each scene gets sceneTailSec at the end.
 *
 * Word timings (opts.timings / config "timings"):
 *   'auto'     (default) whisper if python3.11 + openai-whisper import, else estimate
 *   'whisper'  word timestamps from Whisper on the FINAL (sped-up) voice — exact,
 *              which is what useWordCue needs (devotion-tts was timed this way)
 *   'estimate' each sentence's words spread over its clip by spoken length
 *              (letters + a constant per word, extra after , . ? : for the pause)
 * The result says which was used (and why, when it fell back).
 *
 * opts: { model, voice, speed, force, ctaSec, timings, whisperModel,
 *         fetch (stub in tests), transcribe (stub in tests), configPath, retryDelayMs, quiet }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ROOT, loadEnv } = require('./config');
const audio = require('./audio');
const script = require('./script');

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const CONFIG_PATH = path.join(ROOT, 'config', 'tts.json');
const SR = 44100;
const r3 = x => Math.round(x * 1000) / 1000;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== true && String(v).trim() !== ''); // `--voice` with no value counts as unset

function loadTtsConfig(file = CONFIG_PATH) {
  const base = { model: null, voice: null, speed: 1.15, sentenceGapSec: 0.35, sceneTailSec: 0.6, responseFormat: 'mp3', trimDb: -50, timings: 'auto' };
  if (!fs.existsSync(file)) return base;
  return { ...base, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One OpenRouter TTS call → { buf, contentType }. Fails fast on 401/403; retries 429/5xx twice. */
async function speak(text, { model, voice, key, format, fetchImpl, retryDelayMs = 1500 }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice, input: text, response_format: format }),
      });
    } catch (e) {
      if (attempt < 2) { await sleep(retryDelayMs * (attempt + 1)); continue; }
      throw new Error(`TTS request failed (network): ${e.message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`OPENROUTER_API_KEY rejected (HTTP ${res.status}) — put a working key in .env`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(retryDelayMs * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`TTS HTTP ${res.status} (model ${model}, voice ${voice}): ${(await res.text()).slice(0, 300)}`);
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/json|text\//i.test(contentType)) throw new Error(`TTS returned ${contentType}, not audio: ${(await res.text()).slice(0, 300)}`);
    return { buf: Buffer.from(await res.arrayBuffer()), contentType };
  }
}

/** Raw TTS bytes → mono 44.1k wav with head/tail silence trimmed. Raw PCM (audio/L16, audio/pcm) is decoded as s16le. */
function toTrimmedWav(raw, contentType, out, trimDb) {
  const tmp = `${out}.raw`;
  fs.writeFileSync(tmp, raw);
  const input = [];
  if (/pcm|l16/i.test(contentType)) {
    const rate = (contentType.match(/rate=(\d+)/i) || [])[1] || '24000';
    input.push('-f', 's16le', '-ar', rate, '-ac', '1');
  }
  const t = `silenceremove=start_periods=1:start_threshold=${trimDb}dB`;
  try {
    audio.ffmpeg(['-loglevel', 'error', ...input, '-i', tmp, '-af', `${t},areverse,${t},areverse`, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
  } finally { fs.rmSync(tmp, { force: true }); }
  if (audio.duration(out) < 0.05) { fs.rmSync(out, { force: true }); throw new Error('TTS returned silence'); }
}

function atempoWav(input, speed, out) {
  if (!fs.existsSync(out)) audio.ffmpeg(['-loglevel', 'error', '-i', input, '-af', `atempo=${speed}`, '-c:a', 'pcm_s16le', out]);
  return out;
}

function silenceWav(sec, out) {
  if (!fs.existsSync(out)) audio.ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=mono`, '-t', String(sec), '-c:a', 'pcm_s16le', out]);
  return out;
}

/** Length-weighted word timing estimate for one sentence spoken over [offset, offset+dur]. */
function wordTimings(text, offset, dur) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = w => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[,.?!:;]["”']?$/.test(w) ? 3 : 0);
  const total = words.reduce((a, w) => a + weight(w), 0) || 1;
  let t = offset;
  return words.map(w => {
    const d = (weight(w) / total) * dur;
    const out = { word: w, start: r3(t), end: r3(t + d * 0.92) };
    t += d;
    return out;
  });
}

/** null if whisper can run here, else the reason it can't. */
function whisperUnavailable() {
  const r = spawnSync('python3.11', ['-c', 'import whisper'], { encoding: 'utf8' });
  if (r.error) return `python3.11 not found (${r.error.message})`;
  if (r.status !== 0) return 'openai-whisper not importable in python3.11';
  return null;
}

/**
 * Split whole-voice whisper words into per-scene, 0-based word lists.
 * scenes[i].spans = the sentence clips' [start, end] inside scene i (we built
 * the audio, so these are exact). Each word goes to the sentence clip it
 * overlaps most (nearest if none) and is clamped into it: whisper tends to
 * start a word early after silence, and a cue must never fire in a gap or in
 * the previous scene's tail.
 */
function splitWords(words, scenes) {
  const out = scenes.map(() => []);
  const spans = [];
  let off = 0;
  scenes.forEach((s, i) => { for (const [a, b] of s.spans || []) spans.push({ i, off, a: off + a, b: off + b }); off += s.dur; });
  if (!spans.length) return out;
  for (const w of words) {
    let best = null, bestScore = -Infinity;
    for (const sp of spans) {
      const overlap = Math.min(w.end, sp.b) - Math.max(w.start, sp.a);
      const score = overlap > 0 ? overlap : -Math.min(Math.abs(w.start - sp.b), Math.abs(w.end - sp.a));
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    const start = Math.min(Math.max(w.start, best.a), best.b);
    const end = Math.min(Math.max(w.end, start), best.b);
    out[best.i].push({ word: w.word, start: r3(start - best.off), end: r3(end - best.off) });
  }
  return out;
}

const readMeta = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

async function synthesize(videoDir, opts = {}) {
  loadEnv();
  const log = opts.quiet ? () => {} : (...a) => console.error(...a);
  const cfg = loadTtsConfig(opts.configPath);
  const { meta: fm, scenes: parsed } = script.load(videoDir);
  if (!parsed.length) throw new Error('script.md has no ### Scene blocks');
  const voDir = path.join(videoDir, 'voiceover');
  const cacheDir = path.join(voDir, 'tts');
  const metaFile = path.join(cacheDir, 'meta.json');
  const prev = readMeta(metaFile) || {};

  const model = pick(opts.model, fm.tts_model, prev.model, process.env.TTS_MODEL, cfg.model);
  const voice = pick(opts.voice, fm.tts_voice, prev.voice, process.env.TTS_VOICE, cfg.voice);
  const speed = Number(pick(opts.speed, fm.tts_speed, process.env.TTS_SPEED, cfg.speed, 1));
  const format = cfg.responseFormat || 'mp3';
  if (!model) throw new Error('no TTS model set — pass --model=<openrouter id>, or set "model" in config/tts.json / TTS_MODEL');
  if (!voice) {
    throw new Error('no TTS voice set — there is no default; ask the creator which voice, then either:\n' +
      '  node pipeline/cli.js tts videos/<name> --voice=<name>\n' +
      '  or add `tts_voice: <name>` to script.md frontmatter\n' +
      '  or set TTS_VOICE=<name> in the environment / .env');
  }
  if (!(speed >= 0.5 && speed <= 2)) throw new Error(`speed must be between 0.5 and 2 (got ${speed})`);
  fs.mkdirSync(cacheDir, { recursive: true });

  // 1. Synthesize (or reuse) one trimmed clip per sentence.
  const clipOf = s => path.join(cacheDir, `${sha1(`${model}|${voice}|${s.text}`).slice(0, 16)}.wav`);
  const todo = parsed.flatMap(sc => sc.sentences).filter(s => opts.force || !fs.existsSync(clipOf(s)));
  let apiCalls = 0;
  if (todo.length) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is not set — put a working key in .env');
    const fetchImpl = opts.fetch || globalThis.fetch;
    for (const s of todo) {
      log(`  tts ${s.id} (${model}, ${voice}): ${s.text.slice(0, 60)}`);
      const { buf, contentType } = await speak(s.text, { model, voice, key, format, fetchImpl, retryDelayMs: opts.retryDelayMs });
      apiCalls++;
      try { toTrimmedWav(buf, contentType, clipOf(s), cfg.trimDb); }
      catch (e) { throw new Error(`${s.id}: ${e.message}`); }
    }
  }

  // 2. Tempo + join into scene wavs.
  const gapSec = r3(cfg.sentenceGapSec / speed), tailSec = r3(cfg.sceneTailSec / speed);
  const gap = silenceWav(gapSec, path.join(cacheDir, `gap-${gapSec}.wav`));
  const tail = silenceWav(tailSec, path.join(cacheDir, `tail-${tailSec}.wav`));
  const scenes = [], estimate = [];
  for (const sc of parsed) {
    const parts = [], words = [], spans = [];
    let t = 0;
    for (const [i, s] of sc.sentences.entries()) {
      if (i > 0) { parts.push(gap); t += audio.duration(gap); }
      const raw = clipOf(s);
      const clip = speed === 1 ? raw : atempoWav(raw, speed, raw.replace(/\.wav$/, `-x${speed}.wav`));
      const d = audio.duration(clip);
      words.push(...wordTimings(s.text, t, d));
      spans.push([t, t + d]);
      parts.push(clip);
      t += d;
    }
    parts.push(tail);
    const sceneWav = path.join(cacheDir, `s${sc.idx}.wav`);
    audio.concatWavs(parts, sceneWav);
    scenes.push({ idx: sc.idx, dur: r3(audio.duration(sceneWav)), file: `voiceover/s${sc.idx}.mp3`, wav: sceneWav, spans });
    estimate.push(words);
  }
  const ctaSec = Number(opts.ctaSec || 0);
  if (ctaSec > 0) {
    const idx = scenes[scenes.length - 1].idx + 1;
    const wav = path.join(cacheDir, `s${idx}.wav`);
    fs.rmSync(wav, { force: true });
    silenceWav(ctaSec, wav);
    scenes.push({ idx, dur: r3(audio.duration(wav)), file: `voiceover/s${idx}.mp3`, wav, cta: true });
    estimate.push([]);
  }

  // 3. The whole voice, named by content so whisper's cache (voice-<hash>.json) is reused when nothing changed.
  const h = crypto.createHash('sha1');
  for (const s of scenes) h.update(fs.readFileSync(s.wav));
  const voiceWav = path.join(cacheDir, `voice-${h.digest('hex').slice(0, 16)}.wav`);
  if (!fs.existsSync(voiceWav)) audio.concatWavs(scenes.map(s => s.wav), voiceWav);

  // 4. Word timings.
  const mode = opts.timings || cfg.timings || 'auto';
  let timings = 'estimate', why = null, perScene = estimate;
  if (mode !== 'estimate') {
    why = opts.transcribe ? null : whisperUnavailable();
    if (why && mode === 'whisper') throw new Error(`--timings=whisper but ${why}`);
    if (!why) {
      const transcribe = opts.transcribe || ((wav) => require('./whisper').transcribe(wav, { mode: 'whole', prompt: '', model: opts.whisperModel, quiet: opts.quiet }));
      let heard = null;
      try { heard = transcribe(voiceWav); }
      catch (e) {
        if (mode === 'whisper') throw e;
        why = `whisper failed: ${e.message.split('\n')[0]}`;
        log(`  warning: ${why}; using the estimate`);
      }
      if (heard) perScene = splitWords(heard, scenes).map((w, i) => {
        if (scenes[i].cta) return [];
        if (!w.length) { log(`  warning: whisper heard nothing in scene ${scenes[i].idx}; using the estimate there`); return estimate[i]; }
        const want = estimate[i].length;
        if (want && Math.abs(w.length - want) / want > 0.3) log(`  warning: scene ${scenes[i].idx}: whisper heard ${w.length} words, script has ${want}`);
        return w;
      });
      if (heard) timings = 'whisper';
    }
  }

  // 5. Write the contract files.
  for (const s of scenes) audio.wavToMp3(s.wav, path.join(videoDir, s.file));
  audio.wavToMp3(voiceWav, path.join(videoDir, 'voiceover.mp3'));
  const out = scenes.map((s, i) => ({ idx: s.idx, dur: s.dur, file: s.file, words: perScene[i] }));
  fs.writeFileSync(path.join(videoDir, 'scenes.json'), JSON.stringify(out, null, 2) + '\n');
  const totalSec = r3(out.reduce((a, s) => a + s.dur, 0));
  const meta = {
    model, voice, speed, sentenceGapSec: cfg.sentenceGapSec, sceneTailSec: cfg.sceneTailSec, format,
    timings, ...(timings === 'estimate' && why ? { timingsFallback: why } : {}),
    sentences: parsed.reduce((a, sc) => a + sc.sentences.length, 0), totalSec, at: new Date().toISOString(),
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  return { scenes: out, totalSec, model, voice, speed, timings, timingsFallback: meta.timingsFallback || null, apiCalls, cached: parsed.reduce((a, sc) => a + sc.sentences.length, 0) - apiCalls };
}

module.exports = { synthesize, wordTimings, splitWords, loadTtsConfig, ENDPOINT };
