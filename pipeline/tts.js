'use strict';
/**
 * pipeline/tts.js — script.md → scenes.json + voiceover.mp3 with a TTS voice
 * instead of a recorded take (same v1 contract as cut.js:
 * [{ idx, dur, file: "voiceover/sN.mp3", words: [{word,start,end}] }]).
 * This is SENTENCE mode; `--mode=performance` is pipeline/performance.js.
 *
 * synthesize(videoDir, opts) → { scenes, totalSec, provider, model, voice, speed, timings, apiCalls, … }
 *
 * Settings: core/config.js DEFAULTS.tts ← reelsmith.config.json "tts" (config/tts.json is retired).
 * Precedence per key (resolveSettings):
 *   flag (opts) > script.md frontmatter (tts_provider / tts_model / tts_voice / tts_speed / tts_mode)
 *   > what this video used last time (voiceover/tts/meta.json; provider, model, voice, mode —
 *     model/voice only while the provider is unchanged)
 *   > env (TTS_PROVIDER / TTS_MODEL / TTS_VOICE / TTS_SPEED / TTS_MODE) > reelsmith.config.json > defaults.
 *   provider default 'openrouter' → the tts plugin tts-openrouter (core/plugins.js)
 *   model  default google/gemini-3.8-flash-tts (the creator's pick)
 *   voice  NO default — the creator names one per video; missing → clear error
 *   speed  default 1.15 (creator's pick, 2026-09-29). ffmpeg atempo (pitch kept)
 *          on the cached clips, so changing it never re-calls the API. Gaps and
 *          tails shrink by the same factor, like speeding up the whole file.
 *
 * Each sentence is one provider.synthesize({ text, voice, model, format }) call (OpenRouter:
 * one /api/v1/audio/speech request), cached as voiceover/tts/<sha1(provider|model|voice|text)>.wav,
 * so re-runs only pay for changed lines. (Clips cached before the provider was part of the key,
 * <sha1(model|voice|text)>.wav, are adopted for the openrouter provider instead of re-generated.)
 * Head/tail silence is trimmed, sentences are joined with sentenceGapSec of silence and each scene
 * gets sceneTailSec at the end.
 *
 * Word timings (opts.timings / config tts.timings), from the stt plugin (config stt.provider, default whisper):
 *   'auto'     (default) the stt provider if it is available here, else estimate
 *   'whisper'  word timestamps from the stt provider on the FINAL (sped-up) voice — exact,
 *              which is what useWordCue needs (devotion-tts was timed this way)
 *   'estimate' each sentence's words spread over its clip by spoken length
 *              (letters + a constant per word, extra after , . ? : for the pause)
 * The result says which was used (and why, when it fell back).
 *
 * opts: { provider, model, voice, speed, mode, stt (stt provider id), force, ctaSec, timings, whisperModel, quiet,
 *         config (a reelsmith.config.json object), configPath, root,
 *         fetch (stub in tests), transcribe (stub in tests), ttsProvider / sttProvider (plugin
 *         objects, stubs in tests), registry, retryDelayMs }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const audio = require('./audio');
const script = require('./script');
const coreConfig = require('../core/config');
const project = require('../core/project');
const plugins = require('../core/plugins');
const env = require('../core/env');

const SR = 44100;
const r3 = x => Math.round(x * 1000) / 1000;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const pick = coreConfig.pick; // `--voice` with no value counts as unset
const MODES = ['sentence', 'performance'];

/** The project config (defaults ← reelsmith.config.json, or ← opts.config) for a video dir. */
function projectConfig(videoDir, opts = {}) {
  const root = opts.root || project.rootFor(videoDir || process.cwd());
  if (opts.config) {
    coreConfig.loadEnv(root);
    return { root, config: coreConfig.merge(coreConfig.DEFAULTS, opts.config) };
  }
  const { config } = coreConfig.load({ root, file: opts.configPath });
  return { root, config };
}

/** tts settings: core/config.js DEFAULTS.tts ← reelsmith.config.json "tts" (file = a config path). */
function loadTtsConfig(file, { root } = {}) {
  return coreConfig.load({ root: root || project.root(), file, env: false }).config.tts;
}

const readMeta = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

/**
 * Settings shared by both modes (flag > frontmatter > last run > env > config > defaults).
 * Returns { root, cfg, tcfg, parsed, fm, prev, metaFile, provider, model, voice, speed, mode, whisperModel, sttProvider }.
 */
function resolveSettings(videoDir, opts = {}) {
  const { root, config: cfg } = projectConfig(videoDir, opts);
  const tcfg = cfg.tts;
  const parsed = script.load(videoDir);
  const fm = parsed.meta;
  const metaFile = path.join(videoDir, 'voiceover', 'tts', 'meta.json');
  const prev = readMeta(metaFile) || {};
  const provider = String(pick(opts.provider, fm.tts_provider, prev.provider, process.env.TTS_PROVIDER, tcfg.provider, 'openrouter'));
  const same = !prev.provider || prev.provider === provider;             // a voice name only means something to its provider
  const model = pick(opts.model, fm.tts_model, same ? prev.model : undefined, process.env.TTS_MODEL, tcfg.model);
  const voice = pick(opts.voice, fm.tts_voice, same ? prev.voice : undefined, process.env.TTS_VOICE, tcfg.voice);
  const speed = Number(pick(opts.speed, fm.tts_speed, process.env.TTS_SPEED, tcfg.speed, 1));
  const mode = String(pick(opts.mode, fm.tts_mode, prev.mode, process.env.TTS_MODE, tcfg.mode, 'sentence'));
  const whisperModel = pick(opts.whisperModel, process.env.WHISPER_MODEL, cfg.stt && cfg.stt.model);
  const sttProvider = String(pick(opts.stt, cfg.stt && cfg.stt.provider, 'whisper'));
  return { root, cfg, tcfg, parsed, fm, prev, metaFile, provider, model, voice, speed, mode, whisperModel, sttProvider };
}

/** 'sentence' | 'performance' for a video (the CLI's router). */
function resolveMode(videoDir, opts = {}) {
  const mode = resolveSettings(videoDir, opts).mode;
  if (!MODES.includes(mode)) throw new Error(`unknown tts mode "${mode}" — use --mode=sentence or --mode=performance`);
  return mode;
}

/** Validate model/voice/speed with the messages the CLI shows. */
function requireVoice({ model, voice, speed }, providerPlugin) {
  if (!model) throw new Error('no TTS model set — pass --model=<id>, or set tts.model in reelsmith.config.json / TTS_MODEL');
  if (!voice) {
    const hint = providerPlugin && typeof providerPlugin.voices === 'function'
      ? `\n  voices of ${providerPlugin.name}, e.g.: ${providerPlugin.voices().slice(0, 8).map(v => v.name).join(', ')}` : '';
    throw new Error('no TTS voice set — there is no default; ask the creator which voice, then either:\n' +
      '  node pipeline/cli.js tts videos/<name> --voice=<name>\n' +
      '  or add `tts_voice: <name>` to script.md frontmatter\n' +
      '  or set TTS_VOICE=<name> in the environment / .env' + hint);
  }
  if (!(speed >= 0.5 && speed <= 2)) throw new Error(`speed must be between 0.5 and 2 (got ${speed})`);
}

/** The tts + stt plugin objects for these settings (stubs from opts win). */
function providers(S, opts = {}) {
  let registry = opts.registry || null;
  const reg = () => (registry = registry || plugins.load({ root: S.root, config: S.cfg }));
  const tts = opts.ttsProvider || reg().resolve('tts', S.provider);
  let stt = opts.sttProvider || null, sttError = null;
  if (!stt) {
    try { stt = reg().resolve('stt', S.sttProvider); } catch (e) { sttError = e.message; }
  }
  return { tts, stt, sttError, providerId: plugins.shortName(tts) || S.provider };
}

/** Provider audio → mono 44.1k wav with head/tail silence trimmed. Raw PCM is decoded as s16le at sampleRate. */
function toTrimmedWav(raw, format, sampleRate, out, trimDb) {
  const tmp = `${out}.raw`;
  fs.writeFileSync(tmp, raw);
  const input = [];
  if (format === 'pcm') input.push('-f', 's16le', '-ar', String(sampleRate || 24000), '-ac', '1');
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

/** Adopt clips cached before the provider joined the cache key (openrouter was the only provider then). */
function adoptLegacyClip(cacheDir, legacyKey, key) {
  const from = path.join(cacheDir, `${legacyKey}.wav`), to = path.join(cacheDir, `${key}.wav`);
  if (fs.existsSync(to) || !fs.existsSync(from)) return false;
  for (const f of fs.readdirSync(cacheDir)) {
    if (f === `${legacyKey}.wav` || (f.startsWith(`${legacyKey}-x`) && f.endsWith('.wav'))) {
      fs.renameSync(path.join(cacheDir, f), path.join(cacheDir, key + f.slice(legacyKey.length)));
    }
  }
  return true;
}

async function synthesize(videoDir, opts = {}) {
  env.ensureOnPath();
  const log = opts.quiet ? () => {} : (...a) => console.error(...a);
  const S = resolveSettings(videoDir, opts);
  const { tcfg, parsed: { scenes: parsed }, model, voice, speed, metaFile } = S;
  if (!parsed.length) throw new Error('script.md has no ### Scene blocks');
  const { tts, stt, sttError, providerId } = providers(S, opts);
  requireVoice(S, tts);
  const format = tcfg.responseFormat || 'mp3';
  const voDir = path.join(videoDir, 'voiceover');
  const cacheDir = path.join(voDir, 'tts');
  fs.mkdirSync(cacheDir, { recursive: true });

  // 1. Synthesize (or reuse) one trimmed clip per sentence.
  const keyOf = s => sha1(`${providerId}|${model}|${voice}|${s.text}`).slice(0, 16);
  const clipOf = s => path.join(cacheDir, `${keyOf(s)}.wav`);
  if (providerId === 'openrouter' && !opts.force) {
    for (const s of parsed.flatMap(sc => sc.sentences)) adoptLegacyClip(cacheDir, sha1(`${model}|${voice}|${s.text}`).slice(0, 16), keyOf(s));
  }
  const todo = parsed.flatMap(sc => sc.sentences).filter(s => opts.force || !fs.existsSync(clipOf(s)));
  let apiCalls = 0;
  for (const s of todo) {
    log(`  tts ${s.id} (${providerId} ${model}, ${voice}): ${s.text.slice(0, 60)}`);
    const r = await tts.synthesize({ text: s.text, voice, model, format, fetch: opts.fetch, retryDelayMs: opts.retryDelayMs });
    apiCalls++;
    try { toTrimmedWav(r.audio, r.format, r.sampleRate, clipOf(s), tcfg.trimDb); }
    catch (e) { throw new Error(`${s.id}: ${e.message}`); }
  }

  // 2. Tempo + join into scene wavs.
  const gapSec = r3(tcfg.sentenceGapSec / speed), tailSec = r3(tcfg.sceneTailSec / speed);
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
  const mode = opts.timings || tcfg.timings || 'auto';
  let timings = 'estimate', why = null, perScene = estimate;
  if (mode !== 'estimate') {
    why = opts.transcribe ? null
      : !stt ? `stt provider unavailable (${sttError})`
        : (typeof stt.available === 'function' ? stt.available() : null);
    if (why && mode === 'whisper') throw new Error(`--timings=whisper but ${why}`);
    if (!why) {
      const transcribe = opts.transcribe ||
        ((wav) => stt.transcribe({ wavPath: wav, mode: 'whole', prompt: '', model: S.whisperModel, quiet: opts.quiet }));
      let heard = null;
      try { heard = await transcribe(voiceWav); }
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
  const sentences = parsed.reduce((a, sc) => a + sc.sentences.length, 0);
  const meta = {
    provider: providerId, model, voice, speed, mode: 'sentence', sentenceGapSec: tcfg.sentenceGapSec, sceneTailSec: tcfg.sceneTailSec, format,
    timings, ...(timings === 'estimate' && why ? { timingsFallback: why } : {}),
    sentences, totalSec, at: new Date().toISOString(),
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  return { mode: 'sentence', scenes: out, totalSec, provider: providerId, model, voice, speed, timings,
    timingsFallback: meta.timingsFallback || null, apiCalls, cached: sentences - apiCalls };
}

module.exports = {
  synthesize, wordTimings, splitWords, loadTtsConfig, resolveSettings, resolveMode, requireVoice, providers, projectConfig,
  MODES, ENDPOINT: require('../plugins/tts-openrouter/plugin').ENDPOINT,
};
