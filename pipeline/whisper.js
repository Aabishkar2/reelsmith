'use strict';
/**
 * pipeline/whisper.js — word-level transcription (python3.11 + openai-whisper).
 *
 * transcribe(wavPath, { model, force, quiet, prompt, script, mode }) → [{ word, start, end, conf, suspect? }]
 *   model:  opts.model || $WHISPER_MODEL || 'turbo'
 *   script: config whisper.script — 'pipeline' (default) spawns
 *           pipeline/whisper_words.py, 'root' spawns the repo-root
 *           whisper_timestamps.py (v1 copy; same CLI, but no --prompt, no chunks).
 *   prompt: config whisper.prompt — a disfluent initial prompt. Measured on the
 *           test fixture: WITHOUT it whisper (base and turbo) silently drops
 *           "um", "uh" and sentence restarts; WITH it both models keep them and
 *           the clean take gains no phantom fillers.
 *   mode:   config whisper.mode — 'chunked' (default, docs/spec.md §7b) or 'whole'.
 *           chunked: speechChunks() splits the audio at pauses (frame-RMS energy
 *           VAD, audio.energyVad: pauses ≥ whisper.chunk.minSilenceSec under a
 *           threshold relative to the take's own noise floor and speech level),
 *           and whisper_words.py transcribes the chunks in interleaved windows so a
 *           line and its retake are never in the same whisper window (whisper
 *           otherwise hears a repeat once and stretches one word over the other
 *           attempt). The safety net (whisper.net) re-transcribes long,
 *           speech-filled words on finer sub-chunks and marks unresolved ones
 *           `suspect: true` (analyze flags "possible hidden repeat").
 * Cached next to the wav as <base>.json (take-01.wav → take-01.json = the raw
 * whisper words file of spec §2) + <base>.whisper.json (mode/model/prompt the
 * cache was made with). Reused unless { force }, the wav is newer, or the cache
 * was made in another mode/model (a cache without metadata counts as 'whole').
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');       // (module ref, so tests can stub spawnSync)
const { ROOT, loadEnv, loadConfig } = require('./config');

const SCRIPTS = {
  pipeline: path.join(__dirname, 'whisper_words.py'),
  root: path.join(ROOT, 'whisper_timestamps.py'),
};

function cachePath(wavPath) { return wavPath.replace(/\.wav$/i, '') + '.json'; }
function metaPath(wavPath) { return wavPath.replace(/\.wav$/i, '') + '.whisper.json'; }

function clean(words) {
  return (words || [])
    .filter(w => w && String(w.word || '').trim())
    .map(w => ({
      word: String(w.word).trim(),
      start: Number(w.start),
      end: Math.max(Number(w.end), Number(w.start)),
      conf: w.conf !== undefined ? w.conf : (w.probability !== undefined ? Number(w.probability) : null),
      ...(w.suspect ? { suspect: true } : {}),
    }));
}

/**
 * Speech chunks [[start,end]] of a wav: audio.energyVad() speech runs (pauses
 * ≥ chunk.minSilenceSec below floor + chunk.vadFrac·(speech − floor), shrunk to
 * their core below floor + chunk.lowFrac·(speech − floor)), chunks
 * shorter than chunk.minChunkSec merged into the neighbour across the shorter
 * pause, each padded into its pauses by ≤ chunk.padSec (never past the pause
 * midpoint). noiseDb (the VAD threshold) is also handed to the safety net.
 */
function speechChunks(wavPath, cfg = loadConfig()) {
  const audio = require('./audio');
  const c = cfg.whisper.chunk;
  const pcm = audio.readWav(wavPath);
  const dur = pcm.samples.length / pcm.sampleRate;
  const vad = audio.energyVad(pcm, { minSilenceSec: c.minSilenceSec, frac: c.vadFrac, lowFrac: c.lowFrac, minCoreSec: c.minCoreSec,
    floorPct: c.floorPct, speechPct: c.speechPct });
  let segs = vad.speech.map(s => [s.start, s.end]).filter(([a, b]) => b - a >= 0.08);
  for (let i = 0; i < segs.length;) {
    if (segs.length > 1 && segs[i][1] - segs[i][0] < c.minChunkSec) {
      const gl = i > 0 ? segs[i][0] - segs[i - 1][1] : Infinity, gr = i + 1 < segs.length ? segs[i + 1][0] - segs[i][1] : Infinity;
      if (gl <= gr) { segs[i - 1][1] = segs[i][1]; segs.splice(i, 1); i = Math.max(0, i - 1); }
      else { segs[i + 1][0] = segs[i][0]; segs.splice(i, 1); }
      continue;
    }
    i++;
  }
  const chunks = segs.map(([a, b], i) => {
    const gl = i > 0 ? a - segs[i - 1][1] : a, gr = i + 1 < segs.length ? segs[i + 1][0] - b : dur - b;
    return [Math.max(0, a - Math.min(c.padSec, gl / 2)), Math.min(dur, b + Math.min(c.padSec, gr / 2))].map(x => Math.round(x * 1000) / 1000);
  });
  return { chunks, noiseDb: Math.round(vad.thresholdDb * 10) / 10, durationSec: dur };
}

function transcribe(wavPath, opts = {}) {
  loadEnv();
  const cfg = opts.config || loadConfig();
  const wc = cfg.whisper || {};
  const model = opts.model || process.env.WHISPER_MODEL || 'turbo';
  let which = opts.script || wc.script || 'pipeline';
  if (!fs.existsSync(SCRIPTS[which])) which = which === 'pipeline' ? 'root' : 'pipeline';
  const script = SCRIPTS[which];
  if (!fs.existsSync(script)) throw new Error(`no whisper script found (${Object.values(SCRIPTS).join(', ')})`);
  const mode = which === 'pipeline' ? (opts.mode || wc.mode || 'chunked') : 'whole';
  const prompt = opts.prompt !== undefined ? opts.prompt : wc.prompt;
  const want = { mode, model, prompt: which === 'pipeline' && prompt ? prompt : null };

  const cache = cachePath(wavPath), meta = metaPath(wavPath);
  if (!opts.force && fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(wavPath).mtimeMs) {
    let have = { mode: 'whole' };
    try { have = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch (_) { /* legacy cache: whole-file */ }
    if (have.mode === want.mode && (!have.model || have.model === want.model)) {
      try { return clean(JSON.parse(fs.readFileSync(cache, 'utf8'))); } catch (_) { /* re-run */ }
    }
  }

  const args = [script, wavPath, `--model=${model}`];
  if (want.prompt) args.push(`--prompt=${want.prompt}`);
  let tmp = null, chunkInfo = null;
  if (mode === 'chunked') {
    chunkInfo = speechChunks(wavPath, cfg);
    tmp = path.join(os.tmpdir(), `vg2-chunks-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(chunkInfo.chunks));
    args.push(`--chunks=${tmp}`, `--pack-sec=${wc.chunk.packSec}`, `--sep-sec=${wc.chunk.sepSec}`, `--noise-db=${chunkInfo.noiseDb}`);
    if (wc.net && wc.net.enabled !== false) args.push(`--net=${JSON.stringify(wc.net)}`);
    if (wc.threads) args.push(`--threads=${wc.threads}`);
  }
  if (!opts.quiet) console.error(`  whisper (${model}, ${mode}${chunkInfo ? `: ${chunkInfo.chunks.length} chunks` : ''}, ${path.relative(ROOT, script)}) → ${path.basename(wavPath)}`);
  const r = childProcess.spawnSync('python3.11', args, {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', opts.quiet ? 'pipe' : 'inherit'],
  });
  if (tmp) fs.rmSync(tmp, { force: true });
  if (r.error) throw new Error(`whisper could not start (python3.11): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`whisper failed (exit ${r.status}) ${r.stderr || ''}`.trim());
  const out = String(r.stdout).trim();
  const at = out.lastIndexOf('\n[');
  const words = clean(JSON.parse(at >= 0 ? out.slice(at + 1) : out.slice(out.indexOf('['))));
  fs.writeFileSync(cache, JSON.stringify(words));
  fs.writeFileSync(meta, JSON.stringify({ ...want, at: new Date().toISOString(), chunks: chunkInfo ? chunkInfo.chunks.length : null }));
  return words;
}

module.exports = { transcribe, cachePath, metaPath, speechChunks, SCRIPTS };
