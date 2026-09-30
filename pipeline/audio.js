'use strict';
/**
 * pipeline/audio.js — ffmpeg/ffprobe helpers + a tiny PCM WAV reader/writer.
 *
 * Every external call uses spawnSync with an argv array (no shell strings).
 *
 *  toWav16k(in, out)            16 kHz mono pcm_s16le (whisper input)
 *  toWavHq(in, out)             48 kHz mono pcm_s16le (final cut source)
 *  ensureWavs(base)             make <base>.wav + <base>.hq.wav from whatever exists
 *                               (<base>.webm/.mp3/.m4a/.ogg/.hq.wav/.wav)
 *  duration(file)               seconds via ffprobe
 *  volumeStats(file, s?, e?)    { meanVolumeDb, maxVolumeDb, clipping } via volumedetect
 *  silences(file, opts)         [{start,end}] via silencedetect
 *  sliceWav(in, out, s, e)      sample-accurate atrim
 *  concatWavs(files, out)       concat demuxer → pcm_s16le
 *  removeRanges(in, out, cuts)  keep-segments + concat, done on PCM in-process
 *                               (sample-accurate, 5 ms micro-fades at every join,
 *                               no giant filtergraph for takes with 100+ cuts)
 *  wavToMp3(in, out, bitrate)   libmp3lame CBR
 *  readWav(file) / writeWav(file, {sampleRate, samples})   mono s16 PCM
 *  pcmStats(pcm, s, e)          volumedetect-equivalent mean/max dBFS computed in-process
 *  frameDb(pcm) / energyVad(pcm, opts)   frame RMS + relative-threshold pause/speech VAD
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const env = require('../core/env');

// Resolved on each call (cached inside core/env.js): $FFMPEG_PATH / $FFPROBE_PATH, PATH, then the
// Homebrew / /usr/local fallback dirs; the bare name when nothing is found, so the spawn error says so.
const FFMPEG = () => env.bin('ffmpeg');
const FFPROBE = () => env.bin('ffprobe');

function run(bin, args, { allowFail = false } = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`${bin} could not start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    const tail = (r.stderr || '').trim().split('\n').slice(-8).join('\n');
    throw new Error(`${bin} ${args.join(' ')} failed (exit ${r.status}):\n${tail}`);
  }
  return r;
}

const ffmpeg = (args, opts) => run(FFMPEG(), ['-y', '-hide_banner', '-nostdin', ...args], opts);

function mkdirFor(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }

function toWav(input, out, rate) {
  mkdirFor(out);
  ffmpeg(['-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', out]);
  return out;
}
const toWav16k = (input, out) => toWav(input, out, 16000);
const toWavHq = (input, out) => toWav(input, out, 48000);

/** Given an absolute base path (no extension) make sure .wav and .hq.wav exist. */
function ensureWavs(base) {
  const wav = `${base}.wav`;
  const hq = `${base}.hq.wav`;
  const sources = ['.hq.wav', '.webm', '.wav', '.mp3', '.m4a', '.ogg', '.opus', '.flac']
    .map(ext => base + ext).filter(f => fs.existsSync(f));
  if (!sources.length) throw new Error(`no audio found for ${base} (.webm/.wav/.mp3…)`);
  // Prefer the richest source for hq: original recording first, then hq wav.
  const orig = sources.find(f => !f.endsWith('.hq.wav') && f !== wav) || sources[0];
  if (!fs.existsSync(hq)) toWavHq(orig, hq);
  if (!fs.existsSync(wav)) toWav16k(fs.existsSync(hq) ? hq : orig, wav);
  return { wav, hq };
}

function duration(file) {
  const r = run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(String(r.stdout).trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

function sampleRate(file) {
  const r = run(FFPROBE(), ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate',
    '-of', 'default=nw=1:nk=1', file]);
  return parseInt(String(r.stdout).trim(), 10) || null;
}

/** mean/max volume (dBFS) of [start,end] (whole file if omitted). clipping = max > clipDb. */
function volumeStats(file, start, end, { clipDb = -0.5 } = {}) {
  const args = [];
  if (Number.isFinite(start) && start > 0) args.push('-ss', start.toFixed(3));
  if (Number.isFinite(end)) args.push('-t', Math.max(0.01, end - (start || 0)).toFixed(3));
  args.push('-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-');
  const r = ffmpeg(['-nostats', ...args]);
  const mean = r.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  const max = r.stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  const num = m => (!m ? null : m[1] === '-inf' ? -91 : parseFloat(m[1]));
  const meanVolumeDb = num(mean);
  const maxVolumeDb = num(max);
  return { meanVolumeDb, maxVolumeDb, clipping: maxVolumeDb !== null && maxVolumeDb > clipDb };
}

/** Silence intervals via silencedetect. */
function silences(file, { noiseDb = -40, minSec = 0.3 } = {}) {
  const r = ffmpeg(['-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-vn', '-f', 'null', '-']);
  const out = [];
  let cur = null;
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { cur = { start: Math.max(0, parseFloat(s[1])), end: null }; continue; }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && cur) { cur.end = parseFloat(e[1]); out.push(cur); cur = null; }
  }
  if (cur) { cur.end = duration(file); out.push(cur); }
  return out;
}

function sliceWav(input, out, start, end) {
  mkdirFor(out);
  const filt = `atrim=start=${Math.max(0, start).toFixed(4)}` + (Number.isFinite(end) ? `:end=${end.toFixed(4)}` : '') +
    ',asetpts=PTS-STARTPTS';
  ffmpeg(['-loglevel', 'error', '-i', input, '-af', filt, '-c:a', 'pcm_s16le', out]);
  return out;
}

function concatWavs(files, out) {
  mkdirFor(out);
  const list = `${out}.concat-${process.pid}.txt`;
  fs.writeFileSync(list, files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  try {
    ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', out]);
  } finally { fs.rmSync(list, { force: true }); }
  return out;
}

function wavToMp3(input, out, bitrate = '128k') {
  mkdirFor(out);
  ffmpeg(['-loglevel', 'error', '-i', input, '-c:a', 'libmp3lame', '-b:a', bitrate, out]);
  return out;
}

/** Concatenate mp3s (v1 approach: concat demuxer, re-encode). */
function concatMp3s(files, out, bitrate = '128k') {
  mkdirFor(out);
  const list = `${out}.concat-${process.pid}.txt`;
  fs.writeFileSync(list, files.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  try {
    ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', bitrate, out]);
  } finally { fs.rmSync(list, { force: true }); }
  return out;
}

// ── PCM WAV (mono s16le) ─────────────────────────────────────────────────────

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file}: not a RIFF/WAVE file`);
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (body + size > buf.length) size = buf.length - body;      // streamed/odd headers
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') { data = { off: body, size }; break; }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt/data chunk`);
  if (![1, 0xfffe].includes(fmt.format) || fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error(`${file}: expected mono 16-bit PCM (got fmt=${fmt.format} ch=${fmt.channels} bits=${fmt.bits})`);
  }
  const n = Math.floor(data.size / 2);
  const ab = buf.buffer.slice(buf.byteOffset + data.off, buf.byteOffset + data.off + n * 2);
  return { sampleRate: fmt.sampleRate, samples: new Int16Array(ab) };
}

function writeWav(file, { sampleRate, samples }) {
  mkdirFor(file);
  const dataBytes = samples.length * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(dataBytes, 40);
  const body = Buffer.from(samples.buffer, samples.byteOffset, dataBytes);
  fs.writeFileSync(file, Buffer.concat([h, body]));
  return file;
}

/** Same definitions as volumedetect: mean = RMS power in dBFS, max = peak dBFS. */
function pcmStats(pcm, start = 0, end = Infinity, { clipDb = -0.5 } = {}) {
  const a = Math.max(0, Math.floor(start * pcm.sampleRate));
  const b = Math.min(pcm.samples.length, Math.ceil(Math.min(end, pcm.samples.length / pcm.sampleRate) * pcm.sampleRate));
  let sum = 0, peak = 0;
  for (let i = a; i < b; i++) { const v = pcm.samples[i]; sum += v * v; const av = v < 0 ? -v : v; if (av > peak) peak = av; }
  const n = Math.max(1, b - a);
  const db = x => (x > 0 ? Math.round(10 * Math.log10(x) * 10) / 10 : -91);
  const meanVolumeDb = db(sum / n / (32768 * 32768));
  const maxVolumeDb = db((peak * peak) / (32768 * 32768));
  return { meanVolumeDb, maxVolumeDb, clipping: maxVolumeDb > clipDb };
}

/** Frame RMS in dBFS: { db: Float32Array, hopSec }. */
function frameDb(pcm, { frameSec = 0.02, hopSec = 0.01 } = {}) {
  const n = Math.max(1, Math.round(frameSec * pcm.sampleRate)), h = Math.max(1, Math.round(hopSec * pcm.sampleRate));
  const x = pcm.samples, count = Math.max(1, Math.floor((x.length - n) / h) + 1);
  const db = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * h, e = Math.min(x.length, f * h + n); i < e; i++) sum += x[i] * x[i];
    const ms = sum / n / (32768 * 32768);
    db[f] = ms > 0 ? 10 * Math.log10(ms) : -91;
  }
  return { db, hopSec: h / pcm.sampleRate, frameSec: n / pcm.sampleRate };
}

function percentile(arr, p) {
  const v = Float32Array.from(arr).sort();
  return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))))] : -91;
}

/**
 * Energy VAD: pauses = runs of frames whose RMS is below
 *   thresholdDb = floor + frac · (speech − floor)
 * (floor / speech = floorPct / speechPct percentiles of frame dB) lasting ≥ minSilenceSec,
 * then shrunk (hysteresis) to their quiet core below floor + lowFrac · (speech − floor):
 * soft onsets and fricatives ("s", "f", "c-") next to a pause stay with the speech.
 * A pause whose core is shorter than minCoreSec is dropped. Unlike silencedetect
 * (sample peaks) this still finds pauses under room noise.
 * Returns { pauses:[{start,end}], speech:[{start,end}], thresholdDb, floorDb, speechDb }.
 */
function energyVad(pcm, { floorPct = 10, speechPct = 70, frac = 0.5, lowFrac = 0.2, minSilenceSec = 0.25, minCoreSec = 0.12,
  frameSec = 0.02, hopSec = 0.01 } = {}) {
  const { db, hopSec: hop, frameSec: fs_ } = frameDb(pcm, { frameSec, hopSec });
  const floorDb = percentile(db, floorPct), speechDb = percentile(db, speechPct);
  const thresholdDb = floorDb + frac * (speechDb - floorDb), lowDb = floorDb + lowFrac * (speechDb - floorDb);
  const dur = pcm.samples.length / pcm.sampleRate;
  const at = f => Math.min(dur, f * hop + fs_ / 2);
  const pauses = [];
  for (let f = 0; f < db.length;) {
    if (db[f] >= thresholdDb) { f++; continue; }
    let g = f;
    while (g < db.length && db[g] < thresholdDb) g++;
    const edge = f === 0 || g >= db.length;
    if (edge || at(g) - at(f) >= minSilenceSec) {
      let a = f, b = g;
      if (f > 0) while (a < b && db[a] >= lowDb) a++;
      if (g < db.length) while (b > a && db[b - 1] >= lowDb) b--;
      const start = f === 0 ? 0 : at(a), end = g >= db.length ? dur : at(b);
      if (edge || end - start >= minCoreSec) pauses.push({ start, end });
    }
    f = g;
  }
  const speech = [];
  let t = 0;
  for (const p of pauses) { if (p.start > t) speech.push({ start: t, end: p.start }); t = Math.max(t, p.end); }
  if (t < dur) speech.push({ start: t, end: dur });
  return { pauses, speech, thresholdDb, floorDb, speechDb };
}

/** Merge overlapping/touching [start,end] ranges (sorted output). */
function mergeRanges(ranges, eps = 1e-4) {
  const rs = ranges.filter(r => r && r.end - r.start > eps).map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + eps) {
      last.end = Math.max(last.end, r.end);
      if (r.reason && last.reason && !last.reason.split('+').includes(r.reason)) last.reason += `+${r.reason}`;
    } else out.push(r);
  }
  return out;
}

/** Complement of cuts within [from,to]. */
function keepRanges(cuts, from, to) {
  const keep = [];
  let t = from;
  for (const c of mergeRanges(cuts)) {
    if (c.end <= t || c.start >= to) continue;
    if (c.start > t) keep.push({ start: t, end: Math.min(c.start, to) });
    t = Math.max(t, c.end);
  }
  if (t < to) keep.push({ start: t, end: to });
  return keep;
}

/** Copy [start,end] (seconds) of pcm into dst at dstOff with linear fades; returns samples written. */
function copyWithFades(pcm, start, end, dst, dstOff, fadeSamples) {
  const a = Math.max(0, Math.round(start * pcm.sampleRate));
  const b = Math.min(pcm.samples.length, Math.round(end * pcm.sampleRate));
  const n = Math.max(0, b - a);
  const f = Math.min(fadeSamples, Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    let v = pcm.samples[a + i];
    if (i < f) v = v * (i / f);
    else if (i >= n - f) v = v * ((n - 1 - i) / f);
    dst[dstOff + i] = v;
  }
  return n;
}

function removeRanges(input, out, cutRanges, { fadeMs = 5 } = {}) {
  let pcm;
  try { pcm = readWav(input); } catch (_) {
    const tmp = `${out}.src-${process.pid}.wav`;
    toWavHq(input, tmp);
    try { pcm = readWav(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  }
  const total = pcm.samples.length / pcm.sampleRate;
  const keep = keepRanges(cutRanges, 0, total);
  const dst = new Int16Array(pcm.samples.length);
  const fade = Math.round(pcm.sampleRate * fadeMs / 1000);
  let n = 0;
  for (const k of keep) n += copyWithFades(pcm, k.start, k.end, dst, n, fade);
  writeWav(out, { sampleRate: pcm.sampleRate, samples: dst.subarray(0, n) });
  return { out, keptSec: n / pcm.sampleRate, removedSec: total - n / pcm.sampleRate, keep };
}

module.exports = {
  run, ffmpeg, toWav16k, toWavHq, ensureWavs, duration, sampleRate, volumeStats, silences,
  sliceWav, concatWavs, wavToMp3, concatMp3s, removeRanges,
  readWav, writeWav, pcmStats, mergeRanges, keepRanges, copyWithFades, frameDb, energyVad, percentile,
};
