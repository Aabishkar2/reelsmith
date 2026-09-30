'use strict';
/**
 * pipeline/test/denoise.test.js — denoise cache/staleness, engine fallback, the
 * bark gate and finalize reading the clean files (docs/spec.md §7c). The
 * DeepFilterNet engine is stubbed; the fallback runs real ffmpeg. No whisper.
 *   node pipeline/test/denoise.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const audio = require('../audio');
const dn = require('../denoise');
const { loadConfig } = require('../config');

const cfg = loadConfig();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); }
}
const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const tmpDir = label => fs.mkdtempSync(path.join(os.tmpdir(), `vg2-dn-${label}-`));

/** 48 kHz tone "speech" + light noise. */
function toneWav(file, sec = 2, amp = 6000) {
  const sr = 48000, x = new Int16Array(sr * sec);
  for (let i = 0; i < x.length; i++) x[i] = Math.round(amp * Math.sin(2 * Math.PI * 220 * i / sr) + 300 * Math.sin(i * 1.7));
  audio.writeWav(file, { sampleRate: sr, samples: x });
}
/** Stub DFN: output = input × gain (so tests can tell clean from original). */
function gainEngine(gain, calls) {
  return (src, out) => {
    calls.push(src);
    const p = audio.readWav(src);
    audio.writeWav(out, { sampleRate: p.sampleRate, samples: p.samples.map(v => Math.round(v * gain)) });
  };
}

(async () => {
  const orig = { ...dn.engines };
  console.log('cache + staleness');
  await test('clean file is cached; regenerated only when the source is newer or settings change; source untouched', () => {
    const dir = tmpDir('cache');
    const src = path.join(dir, 'take-01.hq.wav');
    toneWav(src);
    const before = sha(src);
    const calls = [];
    dn.engines.deepfilternet = gainEngine(0.5, calls);
    try {
      const r1 = dn.ensureClean(src, { config: cfg, quiet: true });
      assert.strictEqual(r1.file, path.join(dir, 'take-01.clean.wav'));
      assert.ok(!r1.cached && r1.engine === 'deepfilternet' && !r1.warning);
      const r2 = dn.ensureClean(src, { config: cfg, quiet: true });
      assert.ok(r2.cached, 'second call reuses the cache');
      assert.strictEqual(calls.length, 1);
      const later = new Date(Date.now() + 10000);
      fs.utimesSync(src, later, later);                               // source re-recorded / converted again
      assert.ok(!dn.ensureClean(src, { config: cfg, quiet: true }).cached);
      assert.strictEqual(calls.length, 2);
      const cfg2 = loadConfig({ denoise: { attenLimitDb: 20 } });     // tuning the attenuation invalidates too
      assert.ok(!dn.ensureClean(src, { config: cfg2, quiet: true }).cached);
      assert.ok(dn.ensureClean(src, { config: cfg2, quiet: true }).cached);
      assert.strictEqual(calls.length, 3);
      assert.strictEqual(sha(src), before, 'source must never be modified');
      const p = audio.readWav(path.join(dir, 'take-01.clean.wav'));
      assert.strictEqual(p.sampleRate, 48000);
    } finally { Object.assign(dn.engines, orig); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('fallback');
  await test('DeepFilterNet missing/erroring → ffmpeg afftdn fallback with a warning, never throws', () => {
    const dir = tmpDir('fb');
    const src = path.join(dir, 'rr-s2.1-1.hq.wav');
    toneWav(src);
    let afftdnCalls = 0;
    dn.engines.deepfilternet = () => { throw new Error("No module named 'df'"); };
    const realAfftdn = orig.afftdn;
    dn.engines.afftdn = (...a) => { afftdnCalls++; return realAfftdn(...a); };
    try {
      const r = dn.ensureClean(src, { config: cfg, quiet: true });
      assert.strictEqual(r.engine, 'afftdn');
      assert.ok(/DeepFilterNet unavailable .*No module named 'df'.*afftdn fallback/.test(r.warning), r.warning);
      assert.strictEqual(afftdnCalls, 1);
      const p = audio.readWav(r.file), s = audio.readWav(src);
      assert.strictEqual(p.sampleRate, 48000);
      assert.ok(Math.abs(p.samples.length - s.samples.length) <= 48 * 50, 'same length');
      const again = dn.ensureClean(src, { config: cfg, quiet: true });
      assert.ok(again.cached && again.warning, 'cached fallback keeps its warning');
    } finally { Object.assign(dn.engines, orig); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await test('an engine that returns a wrong-length file is rejected → fallback', () => {
    const dir = tmpDir('len');
    const src = path.join(dir, 'take-01.hq.wav');
    toneWav(src);
    dn.engines.deepfilternet = (s, out) => audio.writeWav(out, { sampleRate: 48000, samples: new Int16Array(4800) });
    try {
      const r = dn.ensureClean(src, { config: cfg, quiet: true });
      assert.strictEqual(r.engine, 'afftdn');
      assert.ok(/output is 0\.100s/.test(r.warning), r.warning);
    } finally { Object.assign(dn.engines, orig); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('per-video switch + gate');
  await test('settings.json switch: default from config, persisted per video', () => {
    const dir = tmpDir('set');
    try {
      assert.strictEqual(dn.enabledFor(dir, cfg), true);
      dn.setEnabled(dir, false);
      assert.strictEqual(dn.enabledFor(dir, cfg), false);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { denoise: false });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await test('gate: a bark between words is pulled down to room tone; words are untouched', () => {
    const sr = 48000, x = new Int16Array(sr * 3);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      const word = (t > 0.3 && t < 0.9) || (t > 2.0 && t < 2.6), bark = t > 1.3 && t < 1.5;
      x[i] = Math.round((word ? 6000 : bark ? 20000 : 0) * Math.sin(2 * Math.PI * 300 * t) + 30 * Math.sin(i * 2.3));
    }
    const y = x.slice();
    const r = dn.gateOutsideWords(y, sr, [{ start: 0.3, end: 0.9 }, { start: 2.0, end: 2.6 }], cfg.denoise.gate);
    const rms = (a, s, e) => { let q = 0; const i0 = Math.round(s * sr), i1 = Math.round(e * sr); for (let i = i0; i < i1; i++) q += a[i] * a[i]; return 10 * Math.log10(q / (i1 - i0) / (32768 * 32768)); };
    assert.ok(r.gatedFrames > 10, JSON.stringify(r));
    assert.ok(rms(x, 1.3, 1.5) - rms(y, 1.3, 1.5) > 30, `bark drop ${rms(x, 1.3, 1.5) - rms(y, 1.3, 1.5)} dB`);
    assert.ok(Math.abs(rms(x, 0.35, 0.85) - rms(y, 0.35, 0.85)) < 0.01, 'word 1 unchanged');
    assert.ok(Math.abs(rms(x, 2.05, 2.55) - rms(y, 2.05, 2.55)) < 0.01, 'word 2 unchanged');
  });

  console.log('finalize');
  await test('finalize renders from the clean files (take + re-record) and records engines; off → original', async () => {
    const { analyze } = require('../analyze');
    const { finalize } = require('../cut');
    const dir = tmpDir('fin');
    fs.mkdirSync(path.join(dir, 'takes'));
    fs.writeFileSync(path.join(dir, 'script.md'), '---\ntitle: t\ntopic: aws\n---\n\n## Script\n\n### Scene 1\nThat delay happens every time a new container spins up.\n');
    const words = []; let t = 0.5;
    for (const w of 'That delay happens every time a new container spins up.'.split(' ')) { words.push({ word: w, start: +t.toFixed(3), end: +(t + 0.28).toFixed(3), conf: 0.95 }); t += 0.34; }
    const sr = 48000, x = new Int16Array(Math.ceil((t + 1) * sr));
    for (const w of words) for (let i = Math.floor(w.start * sr); i < Math.ceil(w.end * sr); i++) x[i] = Math.round(8000 * Math.sin(2 * Math.PI * 220 * i / sr));
    audio.writeWav(path.join(dir, 'takes/take-01.hq.wav'), { sampleRate: sr, samples: x });
    const calls = [];
    dn.engines.deepfilternet = gainEngine(0.25, calls);         // −12 dB: easy to see in the voiceover
    try {
      await analyze(dir, { take: 'takes/take-01', words, useJev: false });
      const on = finalize(dir, { quiet: true });
      const vOn = audio.volumeStats(path.join(dir, 'voiceover.mp3')).meanVolumeDb;
      assert.deepStrictEqual(calls.map(f => path.basename(f)), ['take-01.hq.wav']);
      assert.ok(fs.existsSync(path.join(dir, 'takes/take-01.clean.wav')));
      const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
      assert.deepStrictEqual(take.cut.denoise.engines, { 'takes/take-01.hq.wav': 'deepfilternet' });
      assert.ok(!on.warnings.some(w => /denoise/.test(w)), JSON.stringify(on.warnings));
      dn.setEnabled(dir, false);
      finalize(dir, { quiet: true });
      const vOff = audio.volumeStats(path.join(dir, 'voiceover.mp3')).meanVolumeDb;
      assert.ok(vOff - vOn > 10, `on ${vOn} dB vs off ${vOff} dB`);
      assert.strictEqual(calls.length, 1, 'denoise off → engine not run');
      assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8')).cut.denoise.off);
    } finally { Object.assign(dn.engines, orig); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
