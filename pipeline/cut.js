'use strict';
/**
 * pipeline/cut.js — take.json + audio → clean voiceover (docs/spec.md §2, §6).
 *
 * finalize(videoDir) → { scenes, totalSec, warnings }
 *   writes voiceover/sN.mp3, voiceover.mp3, scenes.json (v1 contract:
 *   [{ idx, dur, file: "voiceover/sN.mp3", words: [{word,start,end}] }]).
 *
 * How a scene is assembled (an edit decision list of source pieces):
 *   - each usable sentence contributes [range.start − pad, range.end + pad]
 *     of its source (take hq wav, or the re-record clip hq wav) minus every
 *     cut inside it (fillers, stutters, restarts, pause over-trim);
 *   - between two sentences: if both come from the take in order, the real
 *     room tone between them is kept, capped at cut.sentenceGapSec (half from
 *     each side); otherwise cut.sentenceGapSec of digital silence;
 *   - after the scene's last sentence: cut.sceneTailSec of room tone (or
 *     silence) so scenes don't butt into each other in voiceover.mp3;
 *   - contiguous pieces are merged; each join gets a cut.fadeMs micro-fade.
 * Words are NOT re-transcribed: the take's aligned whisper words (role anchor
 * or extra, belonging to the sentence) are shifted arithmetically through the
 * piece list, so they are relative to the start of their sN.mp3 (0-based per
 * scene, exactly like v1). dur is ffprobe of the written sN.mp3; voiceover.mp3
 * is the concat of the sN.mp3 files (v1's approach) so Σdur matches it.
 *
 * Denoise (docs/spec.md §7c): unless videos/<name>/settings.json turns it off,
 * every source is read from its cached denoised sibling (<base>.clean.wav via
 * denoise.ensureClean — DeepFilterNet, else ffmpeg afftdn with a warning), so
 * the kept room tone between sentences is clean too; then frames outside the
 * kept words that jump far above the scene's room tone (barks) are gated.
 * There is no loudness/peak-normalization step in the cut (the mp3 encode is last).
 *
 * plan(videoDir, take) builds the piece lists without touching PCM (used for
 * duration estimates by splice.js).
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const audio = require('./audio');
const denoise = require('./denoise');

const r3 = x => Math.round(x * 1000) / 1000;

function readTake(videoDir) {
  const f = path.join(videoDir, 'take.json');
  if (!fs.existsSync(f)) throw new Error(`no take.json in ${videoDir} — run analyze first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Resolve a sentence's audio source: { file, range, cuts, words, kind }. */
function sourceOf(videoDir, take, s) {
  if (s.status === 'rerecorded' && s.source && s.source.kind === 'rerecord') {
    return { kind: 'rerecord', file: path.join(videoDir, `${s.source.clip}.hq.wav`), range: s.source.range,
      cuts: s.source.cuts || [], words: s.source.words || [] };
  }
  if (!s.range) return null;
  const words = (take.words || []).filter(w => w.sid === s.id && (w.role === 'anchor' || w.role === 'extra' || w.role === undefined))
    .filter(w => s.wordIdx ? w.i >= s.wordIdx[0] && w.i <= s.wordIdx[1] : true);
  return { kind: 'take', file: path.join(videoDir, `${take.take}.hq.wav`), range: s.range, cuts: take.cuts || [], words };
}

/** Take up to `limit` seconds from pieces: half from the head, half from the tail. */
function capPieces(pieces, limit) {
  const total = pieces.reduce((a, p) => a + (p.end - p.start), 0);
  if (total <= limit) return pieces;
  const half = limit / 2, head = [], tail = [];
  let need = half;
  for (const p of pieces) { if (need <= 0) break; const d = Math.min(need, p.end - p.start); head.push({ ...p, end: p.start + d }); need -= d; }
  need = half;
  for (const p of [...pieces].reverse()) { if (need <= 0) break; const d = Math.min(need, p.end - p.start); tail.unshift({ ...p, start: p.end - d }); need -= d; }
  return [...head, ...tail];
}

function plan(videoDir, take, cfg = loadConfig()) {
  const pad = cfg.cut.paddingSec;
  const gapSec = cfg.cut.sentenceGapSec;
  const tailSec = cfg.cut.sceneTailSec;
  const warnings = [];
  const durCache = new Map();
  const srcDur = f => { if (!durCache.has(f)) durCache.set(f, audio.duration(f)); return durCache.get(f); };

  // take-sourced sentence starts (sorted) — tails/gaps must never bleed into the next spoken sentence
  const takeStarts = take.sentences.filter(s => s.status !== 'rerecorded' && s.range).map(s => s.range.start).sort((a, b) => a - b);
  const nextTakeStart = t => { const v = takeStarts.find(x => x > t + 1e-6); return v === undefined ? Infinity : v; };

  const sceneIdx = [...new Set(take.sentences.map(s => s.scene))].sort((a, b) => a - b);
  const scenes = sceneIdx.map(idx => {
    const list = take.sentences.filter(s => s.scene === idx);
    const items = [];
    for (const s of list) {
      if (s.status === 'missing') { warnings.push(`${s.id} is missing — skipped`); continue; }
      const src = sourceOf(videoDir, take, s);
      if (!src) { warnings.push(`${s.id} has no audio range — skipped`); continue; }
      if (s.status === 'bad') warnings.push(`${s.id} is flagged bad — included as-is`);
      items.push({ s, src });
    }
    const pieces = [];      // { file, start, end, sid } | { silence, sid }
    items.forEach((it, i) => {
      const { src, s } = it;
      const D = srcDur(src.file);
      const prevPiece = [...pieces].reverse().find(p => p.file === src.file);
      let a = Math.max(0, src.range.start - pad);
      if (prevPiece && prevPiece.end > a && prevPiece.end < src.range.end) a = prevPiece.end;
      const b = Math.min(D, src.range.end + pad, src.kind === 'take' ? nextTakeStart(src.range.start) : Infinity);
      for (const k of audio.keepRanges(src.cuts, a, b)) pieces.push({ file: src.file, start: k.start, end: k.end, sid: s.id });
      const next = items[i + 1];
      if (next) {
        const sameTake = src.kind === 'take' && next.src.kind === 'take' && next.src.range.start > src.range.end;
        if (sameTake) {
          const g0 = b, g1 = Math.max(b, next.src.range.start - pad);
          pieces.push(...capPieces(audio.keepRanges(src.cuts, g0, g1), gapSec).map(p => ({ file: src.file, ...p, sid: null })));
        } else pieces.push({ silence: gapSec, sid: null });
      } else {
        const t1 = Math.min(D, b + tailSec, src.kind === 'take' ? nextTakeStart(src.range.start) - pad : Infinity);
        const tone = t1 > b ? audio.keepRanges(src.cuts, b, t1).map(p => ({ file: src.file, ...p, sid: null })) : [];
        pieces.push(...tone);
        const got = tone.reduce((acc, p) => acc + p.end - p.start, 0);
        if (tailSec - got > 0.005) pieces.push({ silence: tailSec - got, sid: null });
      }
    });
    if (!items.length) { warnings.push(`scene ${idx} has no usable sentences — 0.5s silence`); pieces.push({ silence: 0.5, sid: null }); }

    // merge contiguous pieces of the same file
    const merged = [];
    for (const p of pieces) {
      if (p.end !== undefined && p.end - p.start < 1e-4) continue;
      const last = merged[merged.length - 1];
      if (last && p.file && last.file === p.file && Math.abs(last.end - p.start) < 1e-4) { last.end = p.end; last.sids = [...new Set([...last.sids, p.sid].filter(Boolean))]; continue; }
      if (last && p.silence && last.silence) { last.silence += p.silence; continue; }
      merged.push({ ...p, sids: [p.sid].filter(Boolean) });
    }
    const estSec = merged.reduce((a, p) => a + (p.silence || (p.end - p.start)), 0);
    return { idx, items, pieces: merged, estSec };
  });
  return { scenes, warnings, estSec: scenes.reduce((a, s) => a + s.estSec, 0) };
}

/**
 * Render one planned scene to PCM + words. fileMap maps a source (.hq.wav) to the
 * file actually read — its denoised .clean.wav when denoise is on; pieces keep the
 * source path as identity. gate (cfg.denoise.gate or null) pulls transients
 * outside the kept words (barks in pauses / sentence gaps) down to room tone.
 */
function render(scene, cfg, pcmCache, fileMap = new Map(), gate = null) {
  const load = f => { const g = fileMap.get(f) || f; if (!pcmCache.has(g)) pcmCache.set(g, audio.readWav(g)); return pcmCache.get(g); };
  const rates = new Set(scene.pieces.filter(p => p.file).map(p => load(p.file).sampleRate));
  const sr = rates.size ? [...rates][0] : 48000;
  if (rates.size > 1) throw new Error(`scene ${scene.idx}: mixed sample rates ${[...rates].join(',')}`);
  const fade = Math.round(sr * cfg.cut.fadeMs / 1000);
  const lens = scene.pieces.map(p => (p.silence ? Math.round(p.silence * sr)
    : Math.round(p.end * sr) - Math.round(p.start * sr)));
  const out = new Int16Array(lens.reduce((a, n) => a + n, 0));
  let off = 0;
  const placed = scene.pieces.map((p, i) => {
    const at = off;
    if (p.file) audio.copyWithFades(load(p.file), p.start, p.end, out, off, fade);
    off += lens[i];
    return { ...p, outStart: at / sr, outEnd: (at + lens[i]) / sr };
  });

  // words: shift each source word through the piece list of its own sentence
  const words = [];
  for (const { s, src } of scene.items) {
    const mine = placed.filter(p => p.file === src.file && p.sids.includes(s.id));
    for (const w of src.words) {
      const mid = (w.start + w.end) / 2;
      const p = mine.find(q => mid >= q.start && mid <= q.end);
      if (!p) continue;
      const map = t => p.outStart + (Math.min(Math.max(t, p.start), p.end) - p.start);
      words.push({ word: w.word, start: map(w.start), end: map(w.end) });
    }
  }
  words.sort((a, b) => a.start - b.start);
  let prevEnd = 0;
  for (const w of words) {
    w.start = r3(Math.max(w.start, prevEnd));
    w.end = r3(Math.max(w.end, w.start));
    prevEnd = w.end;
  }
  const gated = gate ? denoise.gateOutsideWords(out, sr, words, gate) : null;
  return { sampleRate: sr, samples: out, words, gated };
}

function finalize(videoDir, opts = {}) {
  const cfg = loadConfig(opts.config);
  videoDir = path.resolve(videoDir);
  const take = readTake(videoDir);
  const { scenes: planned, warnings } = plan(videoDir, take, cfg);

  // denoise every source the scenes read (take + re-record clips); originals stay untouched
  const useClean = opts.denoise !== undefined ? !!opts.denoise : denoise.enabledFor(videoDir, cfg);
  const fileMap = new Map(), engines = {};
  if (useClean) {
    const srcs = [...new Set(planned.flatMap(sc => sc.pieces.filter(p => p.file).map(p => p.file)))];
    for (const f of srcs) {
      try {
        const r = denoise.ensureClean(f, { config: cfg, quiet: opts.quiet });
        fileMap.set(f, r.file);
        engines[path.relative(videoDir, f)] = r.engine;
        if (r.warning) warnings.push(`denoise: ${r.warning}`);
      } catch (e) { warnings.push(`denoise failed for ${path.basename(f)} (${e.message.split('\n')[0]}) — original audio used`); }
    }
  }
  const gate = useClean && cfg.denoise.gate && cfg.denoise.gate.enabled ? cfg.denoise.gate : null;
  let gatedFrames = 0;
  const voDir = path.join(videoDir, 'voiceover');
  const tmpDir = path.join(voDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const pcmCache = new Map();
  const scenes = [];
  try {
    for (const sc of planned) {
      const { sampleRate, samples, words, gated } = render(sc, cfg, pcmCache, fileMap, gate);
      if (gated) gatedFrames += gated.gatedFrames;
      const wav = path.join(tmpDir, `s${sc.idx}.wav`);
      audio.writeWav(wav, { sampleRate, samples });
      const rel = `voiceover/s${sc.idx}.mp3`;
      audio.wavToMp3(wav, path.join(videoDir, rel), cfg.cut.mp3Bitrate);
      const dur = audio.duration(path.join(videoDir, rel));
      scenes.push({ idx: sc.idx, dur: Number(dur.toFixed(3)), file: rel, words: words.filter(w => w.start < dur) });
    }
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }

  // drop stale scene files from a previous finalize with more scenes
  const keep = new Set(scenes.map(s => path.basename(s.file)));
  for (const f of fs.readdirSync(voDir)) if (/^s\d+\.mp3$/.test(f) && !keep.has(f)) fs.rmSync(path.join(voDir, f));

  const voiceover = path.join(videoDir, 'voiceover.mp3');
  audio.concatMp3s(scenes.map(s => path.join(videoDir, s.file)), voiceover, cfg.cut.mp3Bitrate);
  fs.writeFileSync(path.join(videoDir, 'scenes.json'), JSON.stringify(scenes, null, 2));
  const totalSec = r3(audio.duration(voiceover));

  take.status = 'cut';
  take.cut = { at: new Date().toISOString(), totalSec, scenes: scenes.length, warnings,
    denoise: useClean ? { engines, gatedFrames, gate: !!gate } : { off: true } };
  fs.writeFileSync(path.join(videoDir, 'take.json'), JSON.stringify(take, null, 2));
  return { scenes, totalSec, warnings };
}

module.exports = { finalize, plan, render };
