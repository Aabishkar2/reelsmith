'use strict';
/**
 * pipeline/test/attempts.test.js — best-attempt selection (docs/spec.md §7a) and
 * silent-take guards. Synthetic whisper words; the analyze()/rerecord() tests
 * write tiny generated WAVs into os.tmpdir() (ffmpeg needed, no whisper, no network).
 *   node pipeline/test/attempts.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeWords } = require('../analyze');
const { loadConfig } = require('../config');
const ATT = require('../attempts');

const cfg = loadConfig();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); }
}

/** "hello world [pause:2.5] again" → whisper-like words (0.28s/word, 0.06s gaps, conf 0.95). */
function words(text, conf = 0.95) {
  const out = [];
  let t = 0.5;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const p = tok.match(/^\[pause:(\d+(?:\.\d+)?)\]$/);
    if (p) { t += parseFloat(p[1]); continue; }
    out.push({ word: tok, start: +t.toFixed(3), end: +(t + 0.28).toFixed(3), conf });
    t += 0.34;
  }
  return out;
}
const SENTS = [
  { id: 's1.1', scene: 1, line: 1, text: 'S3 is the oldest and most widely used AWS service.' },
  { id: 's1.2', scene: 1, line: 2, text: 'It stores objects like files, logs, and backups.' },
  { id: 's2.1', scene: 2, line: 1, text: 'That delay happens every time a new container spins up.' },
];
const L1 = 'S3 is the oldest and most widely used AWS service.';
const L2 = 'It stores objects like files, logs, and backups.';
const L3 = 'That delay happens every time a new container spins up.';

async function run(text, extra = {}) {
  const w = words(text);
  return analyzeWords({ sentences: SENTS, words: w, audioFile: null, durationSec: w[w.length - 1].end + 0.5, cfg, useJev: false, ...extra });
}
const byId = (r, id) => r.sentences.find(s => s.id === id);
const starts = (r, re) => r.words.filter(w => re.test(w.word));

(async () => {
  console.log('attempt selection (analyzeWords)');

  await test('(a) line said twice, first attempt cleaner → first kept, second cut', async () => {
    // second saying has a fuzzy slip ("fires") and two fillers
    const r = await run(`${L1} ${L2} It stores, um, objects like fires, uh, logs, and backups. ${L3}`);
    const s = byId(r, 's1.2');
    assert.strictEqual(s.attempts.length, 2, JSON.stringify(s.attempts));
    const [a1, a2] = s.attempts;
    assert.ok(a1.chosen && !a2.chosen, JSON.stringify(s.attempts.map(a => [a.n, a.score, a.chosen])));
    assert.ok(a1.score > a2.score);
    const its = starts(r, /^It$/);
    assert.strictEqual(s.range.start, its[0].start, 'range starts at the first attempt');
    assert.strictEqual(its[1].role, 'restart');
    assert.strictEqual(its[1].sid, 's1.2');
    const second = r.words.filter(w => w.start >= its[1].start && w.end <= r.words.find(x => x.word === 'That').start);
    for (const w of second) assert.ok(r.cuts.some(c => c.start <= w.start + 1e-6 && c.end >= w.end - 1e-6), `not cut: ${w.word}@${w.start}`);
    assert.ok(r.cuts.some(c => /^attempt:/.test(c.reason)), JSON.stringify(r.cuts));
    assert.strictEqual(s.wer, 0);
    const note = s.flags.find(f => f.type === 'attempts');
    assert.ok(note && note.severity === 'info' && /2 attempts — kept #1/.test(note.detail), JSON.stringify(s.flags));
    assert.ok(!s.flags.some(f => f.type === 'filler'), 'fillers of the dropped attempt are not reported');
    assert.strictEqual(s.status, 'ok', JSON.stringify(s.flags));
  });

  await test('(b) two equal attempts → the latest is kept (pre-attempts behaviour)', async () => {
    const r = await run(`${L1} ${L2} ${L2} ${L3}`);
    const s = byId(r, 's1.2');
    assert.strictEqual(s.attempts.length, 2);
    assert.ok(s.attempts[1].chosen, JSON.stringify(s.attempts.map(a => [a.n, a.score, a.chosen])));
    assert.ok(Math.abs(s.attempts[0].score - s.attempts[1].score) <= cfg.attempts.tieEpsilon);
    const its = starts(r, /^It$/);
    assert.strictEqual(s.range.start, its[1].start);
    assert.strictEqual(its[0].role, 'restart');
    assert.ok(r.cuts.some(c => c.start <= its[0].start && c.end >= its[0].end));
  });

  await test('(a2) second attempt cleaner → second kept (no re-anchor needed)', async () => {
    const r = await run(`${L1} It stores, um, objects like fires, uh, logs, and backups. ${L2} ${L3}`);
    const s = byId(r, 's1.2');
    assert.strictEqual(s.attempts.length, 2);
    assert.ok(s.attempts[1].chosen);
    assert.strictEqual(s.range.start, starts(r, /^It$/)[1].start);
  });

  await test('(a3) three attempts of one line, the middle one clean → middle kept, both others cut', async () => {
    const r = await run(`${L1} It stores objects like fires, logs, and backups. ${L2} It stores, um, objects like, uh, files logs and backups. ${L3}`);
    const s = byId(r, 's1.2');
    assert.strictEqual(s.attempts.length, 3, JSON.stringify(s.attempts.map(a => a.range)));
    assert.deepStrictEqual(s.attempts.map(a => a.chosen), [false, true, false], JSON.stringify(s.attempts.map(a => [a.n, a.score])));
    const its = starts(r, /^It$/);
    assert.strictEqual(s.range.start, its[1].start);
    assert.strictEqual(its[0].role, 'restart'); assert.strictEqual(its[2].role, 'restart');
    assert.ok(/3 attempts — kept #2/.test(s.flags.find(f => f.type === 'attempts').detail));
  });

  await test('(c1) manual pick of a take attempt overrides the score', async () => {
    const text = `${L1} ${L2} It stores, um, objects like fires, uh, logs, and backups. ${L3}`;
    const first = await run(text);
    const worse = byId(first, 's1.2').attempts[1];
    const r = await run(text, { picks: { 's1.2': { source: 'take', n: 2, start: worse.range[0] } } });
    const s = byId(r, 's1.2');
    assert.ok(s.attempts[1].chosen, JSON.stringify(s.attempts));
    assert.strictEqual(s.range.start, worse.range[0]);
    assert.ok(/your pick/.test(s.flags.find(f => f.type === 'attempts').detail));
  });

  await test('(d) partial restart stays a restart (not an attempt)', async () => {
    const r = await run(`S3 is the— ${L1} ${L2} ${L3}`);
    const s = byId(r, 's1.1');
    assert.strictEqual(s.attempts.length, 1);
    assert.ok(s.attempts[0].chosen);
    const s3 = starts(r, /^S3/);
    assert.strictEqual(s3[0].role, 'restart');
    assert.strictEqual(s.range.start, s3[1].start);
    assert.ok(s.flags.some(f => f.type === 'stutter' && /^restart/.test(f.detail)), JSON.stringify(s.flags));
    assert.ok(!s.flags.some(f => f.type === 'attempts'));
  });

  await test('single-attempt sentences carry one chosen attempt, missing ones none', async () => {
    const r = await run(`${L1} ${L3}`);
    assert.strictEqual(byId(r, 's1.1').attempts.length, 1);
    assert.strictEqual(byId(r, 's1.2').attempts.length, 0);
    assert.ok(Number.isFinite(byId(r, 's1.1').attempts[0].score));
  });

  await test('edge compaction: a last token tied to a far duplicate does not swallow the next line', async () => {
    const sents = [{ id: 's1.1', scene: 1, line: 1, text: 'Say you truly believe God is watching over you.' },
      { id: 's1.2', scene: 1, line: 2, text: 'And you feel you are trying to live a good life.' }];
    const w = words('Say you truly believe God is watching over you, and you feel you are trying to live a good life. And you feel you are trying to live a good life.');
    const r = await analyzeWords({ sentences: sents, words: w, audioFile: null, durationSec: 30, cfg, useJev: false });
    const s = byId(r, 's1.1');
    assert.strictEqual(s.wer, 0, JSON.stringify(s.flags));
    assert.strictEqual(s.range.end, w.find(x => x.word === 'you,').end, JSON.stringify(s.range));
    assert.ok(byId(r, 's1.2').attempts.length === 2, JSON.stringify(byId(r, 's1.2').attempts));
  });

  await test('pass C: retake whose 1st word whisper dropped ("Depends…" for "It depends…") is re-anchored', async () => {
    const sents = [{ id: 's1.1', scene: 1, line: 1, text: 'It depends on how clearly you understand yourself and the world around you.' }];
    const w = words('Depends on how clearly you understand yourself and the whole, you know, Depends on how clearly you understand yourself. [pause:0.8] the world around you.');
    const r = await analyzeWords({ sentences: sents, words: w, audioFile: null, durationSec: 30, cfg, useJev: false });
    const s = byId(r, 's1.1');
    const dep = r.words.filter(x => x.word === 'Depends');
    assert.strictEqual(s.range.start, dep[1].start, JSON.stringify({ range: s.range, dep }));
    assert.strictEqual(dep[0].role, 'restart');
  });

  console.log('\nVAD chunking + whisper cache (whisper.js, audio.js)');
  await test('energyVad finds pauses under room noise; hysteresis keeps soft word edges; speechChunks pads + merges', () => {
    const audioM = require('../audio');
    const sr = 16000, x = new Int16Array(sr * 6);
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      const speech = (t > 0.5 && t < 2.0) || (t > 2.45 && t < 4.0) || (t > 4.6 && t < 5.5);
      const soft = t > 2.35 && t <= 2.45;                        // soft onset right before the 2nd run
      x[i] = Math.round((speech ? 5000 * Math.sin(2 * Math.PI * 180 * t) : soft ? 400 * Math.sin(2 * Math.PI * 180 * t) : 0) + 60 * rnd());
    }
    const pcm = { sampleRate: sr, samples: x };
    const v = audioM.energyVad(pcm, { minSilenceSec: 0.25 });
    assert.strictEqual(v.speech.length, 3, JSON.stringify(v.speech));
    assert.ok(v.speech[1].start < 2.43, `soft onset kept with the speech: ${v.speech[1].start}`);
    const file = path.join(os.tmpdir(), `vg2-vad-${process.pid}.wav`);
    audioM.writeWav(file, pcm);
    try {
      const { chunks } = require('../whisper').speechChunks(file, cfg);
      assert.strictEqual(chunks.length, 3, JSON.stringify(chunks));
      assert.ok(chunks[0][0] < 0.5 && chunks[0][1] > 2.0 && chunks[0][1] <= chunks[1][0], JSON.stringify(chunks));
    } finally { fs.rmSync(file, { force: true }); }
  });
  await test('whisper_words.py: neighbouring chunks never share a window; long speech-filled words are caught', () => {
    const py = `
import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..'))})
import numpy as np, whisper_words as ww
chunks = [(i * 3.0, i * 3.0 + 2.2) for i in range(20)]
packs = ww.pack_plan(chunks, 24.0, 1.0)
two = ww.pack_plan([(0, 2), (2.5, 4)], 24.0, 1.0)
db = np.full(2000, -25.0); db[500:540] = -60.0            # 20 s of speech frames, one 0.4 s dip at 5.0 s
words = [{"word": "how", "start": 1.0, "end": 1.2}, {"word": "yourself", "start": 2.0, "end": 2.5},
         {"word": "the", "start": 3.0, "end": 3.1}, {"word": "how", "start": 4.0, "end": 6.6}]
net = {"longWordSec": 1.0, "ratio": 3, "speechFrac": 0.6, "subSilenceSec": 0.12, "subBelowDb": 12}
print(json.dumps({"packs": packs, "two": two, "long": ww.long_words(words, db, net, -42.0),
                  "subs": ww.sub_chunks(db, 3.8, 6.8, net, -42.0)}))`;
    const env = require('../../core/env');                             // the python with whisper's numpy
    const r = require('child_process').spawnSync(env.pythonWithWhisper() || env.python() || 'python3', ['-B', '-c', py], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    const where = new Map(); o.packs.forEach((p, k) => p.forEach(i => where.set(i, k)));
    assert.strictEqual(where.size, 20);
    for (let i = 1; i < 20; i++) assert.notStrictEqual(where.get(i), where.get(i - 1), `chunks ${i - 1},${i} share a window`);
    assert.strictEqual(o.two.length, 2, 'two chunks → two windows');
    assert.deepStrictEqual(o.long, [3], 'only the 2.6 s "how" is suspicious');
    assert.strictEqual(o.subs.length, 2, JSON.stringify(o.subs));
    assert.ok(Math.abs(o.subs[0][1] - 5.2) < 0.1, JSON.stringify(o.subs));
  });
  await test('whisper cache is keyed by mode/model: a whole-file cache is not reused in chunked mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg2-wcache-'));
    const wav = path.join(dir, 'take-01.wav');
    fs.writeFileSync(wav, 'x');
    const cached = [{ word: 'hello', start: 0, end: 0.3, conf: 0.9 }];
    const later = new Date(Date.now() + 5000);
    const child = require('child_process'), orig = child.spawnSync;
    let spawned = 0;
    child.spawnSync = () => { spawned++; return { status: 0, stdout: JSON.stringify([{ word: 'fresh', start: 0, end: 0.2, conf: 1 }]) }; };
    const W = require('../whisper');
    const audioM = require('../audio');
    const origChunks = W.speechChunks;
    try {
      fs.writeFileSync(path.join(dir, 'take-01.json'), JSON.stringify(cached)); fs.utimesSync(path.join(dir, 'take-01.json'), later, later);
      // legacy cache (no .whisper.json) = whole-file: reused in whole mode …
      assert.deepStrictEqual(W.transcribe(wav, { mode: 'whole', quiet: true }).map(w => w.word), ['hello']);
      assert.strictEqual(spawned, 0);
      // … but not in chunked mode (needs audio: stub the chunker via a real tiny wav)
      audioM.writeWav(wav, { sampleRate: 16000, samples: new Int16Array(16000) });
      fs.utimesSync(path.join(dir, 'take-01.json'), later, later);
      const out = W.transcribe(wav, { mode: 'chunked', quiet: true });
      assert.strictEqual(spawned, 1);
      assert.deepStrictEqual(out.map(w => w.word), ['fresh']);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'take-01.whisper.json'), 'utf8')).mode, 'chunked');
      fs.utimesSync(path.join(dir, 'take-01.json'), later, later);
      W.transcribe(wav, { mode: 'chunked', quiet: true });
      assert.strictEqual(spawned, 1, 'chunked cache reused');
    } finally { child.spawnSync = orig; W.speechChunks = origChunks; fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('\nscoring + choice (attempts.js)');
  await test('non-bad beats bad even with a lower score; ties → latest; unscored legacy re-record wins', () => {
    const mk = (score, bad, source = 'take') => ({ source, score, breakdown: { bad }, range: [0, 1] });
    assert.strictEqual(ATT.choose([mk(0.95, true), mk(0.7, false)], null, cfg).idx, 1);
    assert.strictEqual(ATT.choose([mk(0.9, false), mk(0.89, false)], null, cfg).idx, 1);
    assert.strictEqual(ATT.choose([mk(0.95, false), mk(0.8, false)], null, cfg).idx, 0);
    assert.strictEqual(ATT.choose([mk(0.95, false), { source: 'rerecord', score: null, legacy: true }], null, cfg).idx, 1);
    assert.strictEqual(ATT.choose([{ source: 'take', score: null, legacy: true }, mk(0.5, false, 'rerecord')], null, cfg).idx, 1);
  });
  await test('audio: quieter than the take median and clipping lose points; pace: off-median wpm loses', () => {
    const ref = { speechDb: -24, wpm: 150, conf: 0.9 };
    const base = { wer: 0, fillers: 0, repeats: 0, pauses: 0, conf: 0.9, wpm: 150, meanVolumeDb: -24, clipping: false };
    const s0 = ATT.score(base, ref, cfg).score;
    assert.ok(ATT.score({ ...base, meanVolumeDb: -34 }, ref, cfg).score < s0);
    assert.ok(ATT.score({ ...base, clipping: true }, ref, cfg).score < s0);
    assert.ok(ATT.score({ ...base, wpm: 220 }, ref, cfg).score < s0);
    assert.strictEqual(ATT.score({ ...base, meanVolumeDb: -20 }, ref, cfg).score, s0, 'louder than median is not penalized');
  });

  // ── analyze() / rerecord() on generated audio (words injected; whisper stubbed) ──
  const audio = require('../audio');
  const whisper = require('../whisper');
  const { analyze } = require('../analyze');
  const { rerecord } = require('../splice');
  const SCRIPT = `---\ntitle: t\ntopic: aws\n---\n\n## Script\n\n### Scene 1\n${L1}\n${L2}\n\n### Scene 2\n${L3}\n`;
  /** 48 kHz mono wav with a 220 Hz tone under every word (silence elsewhere). */
  function makeWav(file, ws, dur, amp = 6000) {
    const sr = 48000, x = new Int16Array(Math.ceil(dur * sr));
    for (const w of ws) for (let i = Math.floor(w.start * sr); i < Math.min(x.length, Math.ceil(w.end * sr)); i++) x[i] = Math.round(amp * Math.sin(2 * Math.PI * 220 * i / sr));
    audio.writeWav(file, { sampleRate: sr, samples: x });
  }
  function videoDir(label) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vg2-${label}-`));
    fs.mkdirSync(path.join(dir, 'takes'));
    fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
    return dir;
  }
  const readTake = dir => JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  const origTranscribe = whisper.transcribe;
  let whisperCalls = 0;
  whisper.transcribe = () => { whisperCalls++; throw new Error('whisper must not run in this test'); };

  console.log('\nanalyze(): picks, re-records, silent-take guards');
  await test('(c) manual pick overrides the score and survives re-analysis', async () => {
    const dir = videoDir('pick');
    try {
      const w = words(`${L1} ${L2} It stores, um, objects like fires, uh, logs, and backups. ${L3}`);
      makeWav(path.join(dir, 'takes/take-01.hq.wav'), w, w[w.length - 1].end + 1);
      const t1 = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      let s = t1.sentences.find(x => x.id === 's1.2');
      assert.ok(s.attempts[0].chosen, 'score picks the cleaner first attempt');
      assert.ok(t1.attemptRef && Number.isFinite(t1.attemptRef.wpm), JSON.stringify(t1.attemptRef));
      // what POST /pick does: persist the pick, re-run analyze
      const doc = readTake(dir);
      const a2 = doc.sentences.find(x => x.id === 's1.2').attempts[1];
      doc.sentences.find(x => x.id === 's1.2').pick = { source: 'take', n: a2.n, start: a2.range[0] };
      fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(doc));
      for (let round = 0; round < 2; round++) {
        const t = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
        s = t.sentences.find(x => x.id === 's1.2');
        assert.ok(s.pick && s.pick.n === 2, `round ${round}: pick kept`);
        assert.ok(s.attempts[1].chosen && !s.attempts[0].chosen, `round ${round}: ${JSON.stringify(s.attempts.map(a => [a.n, a.score, a.chosen]))}`);
        assert.strictEqual(s.range.start, a2.range[0]);
        assert.ok(/your pick/.test(s.flags.find(f => f.type === 'attempts').detail));
        const first = t.words.filter(x => x.word === 'It')[0];
        assert.strictEqual(first.role, 'restart', 'the higher-scored, un-picked attempt is cut');
        assert.ok(t.cuts.some(c => c.start <= first.start && c.end >= first.end));
      }
      assert.strictEqual(whisperCalls, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('re-record clip becomes a scored attempt; best wins; kept across re-analysis; pick of the take restores it', async () => {
    const dir = videoDir('rr');
    try {
      // take: s1.2 said once with three fillers (bad) → a clean clip must win
      const w = words(`${L1} It stores, um, objects, uh, like files, er, logs, and backups. ${L3}`);
      makeWav(path.join(dir, 'takes/take-01.hq.wav'), w, w[w.length - 1].end + 1);
      await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      const cw = words(L2);
      makeWav(path.join(dir, 'takes/rr-s1.2-1.hq.wav'), cw, cw[cw.length - 1].end + 0.8);
      const r = await rerecord(dir, 's1.2', 'takes/rr-s1.2-1', { words: cw, useJev: false });
      assert.ok(r.ok && r.kept === 'rerecord', JSON.stringify({ ok: r.ok, kept: r.kept, reason: r.reason }));
      let s = readTake(dir).sentences.find(x => x.id === 's1.2');
      assert.strictEqual(s.status, 'rerecorded');
      assert.deepStrictEqual(s.attempts.map(a => a.source), ['take', 'rerecord']);
      assert.ok(s.attempts[1].chosen && Number.isFinite(s.attempts[1].score));
      assert.ok(s.take && s.take.range, 'take analysis kept for restoring');
      // re-analysis keeps the clip as an attempt and still picks it
      let t = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      s = t.sentences.find(x => x.id === 's1.2');
      assert.strictEqual(s.status, 'rerecorded');
      assert.strictEqual(s.attempts.length, 2);
      // manual pick of the take attempt wins over the better clip
      const doc = readTake(dir);
      doc.sentences.find(x => x.id === 's1.2').pick = { source: 'take', n: 1, start: s.attempts[0].range[0] };
      fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(doc));
      t = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      s = t.sentences.find(x => x.id === 's1.2');
      assert.strictEqual(s.source.kind, 'take');
      assert.ok(s.status !== 'rerecorded' && s.attempts[0].chosen, JSON.stringify(s.attempts.map(a => [a.n, a.chosen])));
      assert.strictEqual(whisperCalls, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('legacy take.json (no attempts[]) keeps an accepted re-record on re-analysis', async () => {
    const dir = videoDir('legacy');
    try {
      const w = words(`${L1} ${L2} ${L3}`);
      makeWav(path.join(dir, 'takes/take-01.hq.wav'), w, w[w.length - 1].end + 1);
      const t = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      const s = t.sentences.find(x => x.id === 's2.1');
      delete s.attempts;
      Object.assign(s, { status: 'rerecorded', clipStatus: 'ok', source: { kind: 'rerecord', clip: 'takes/rr-s2.1-1', range: { start: 0.5, end: 3.8 }, cuts: [], words: [] } });
      fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(t));
      const t2 = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      const s2 = t2.sentences.find(x => x.id === 's2.1');
      assert.strictEqual(s2.status, 'rerecorded');
      assert.strictEqual(s2.source.clip, 'takes/rr-s2.1-1');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('(e) silent take → fails fast with a clear error, Whisper never invoked, take.json status silent', async () => {
    const dir = videoDir('silent');
    try {
      audio.writeWav(path.join(dir, 'takes/take-01.hq.wav'), { sampleRate: 48000, samples: new Int16Array(48000 * 20) });
      whisperCalls = 0;
      const t0 = Date.now();
      await assert.rejects(analyze(dir, { take: 'takes/take-01', useJev: false }),
        e => e.code === 'SILENT_TAKE' && /Take is silent — the mic delivered no audio/.test(e.message));
      assert.strictEqual(whisperCalls, 0, 'whisper was invoked');
      assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0}ms`);
      const doc = readTake(dir);
      assert.strictEqual(doc.status, 'silent');
      assert.strictEqual(doc.problem.kind, 'silent');
      assert.ok(doc.audio.maxVolumeDb < cfg.silence.maxDb);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('(e) silent re-record clip → rejected at once, Whisper never invoked', async () => {
    const dir = videoDir('silent-rr');
    try {
      const w = words(`${L1} ${L2} ${L3}`);
      makeWav(path.join(dir, 'takes/take-01.hq.wav'), w, w[w.length - 1].end + 1);
      await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      audio.writeWav(path.join(dir, 'takes/rr-s1.2-1.hq.wav'), { sampleRate: 48000, samples: new Int16Array(48000 * 4) });
      whisperCalls = 0;
      const r = await rerecord(dir, 's1.2', 'takes/rr-s1.2-1', { useJev: false });
      assert.ok(!r.ok && r.silent && /mic delivered no audio/.test(r.reason), JSON.stringify(r.reason));
      assert.strictEqual(whisperCalls, 0);
      const s = readTake(dir).sentences.find(x => x.id === 's1.2');
      assert.notStrictEqual(s.status, 'rerecorded');
      assert.strictEqual(s.rerecords[s.rerecords.length - 1].status, 'silent');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('Whisper "Thank you." ×13 on a near-silent take → status no-speech with a clear problem message', async () => {
    const dir = videoDir('halluc');
    try {
      const w = [];
      for (let i = 0; i < 13; i++) w.push({ word: 'Thank', start: i * 10, end: i * 10 + 0.12, conf: 0.2 }, { word: 'you.', start: i * 10 + 0.12, end: i * 10 + 0.3, conf: 0.99 });
      makeWav(path.join(dir, 'takes/take-01.hq.wav'), [{ start: 5, end: 5.2 }], 131, 200);     // faint click: not silent
      const t = await analyze(dir, { take: 'takes/take-01', words: w, useJev: false });
      assert.strictEqual(t.status, 'no-speech');
      assert.strictEqual(t.problem.kind, 'hallucination');
      assert.ok(/"thank you" ×13/.test(t.problem.message), t.problem.message);
      assert.ok(t.sentences.every(s => s.status === 'missing' && /hallucination/.test(s.flags[0].detail)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  whisper.transcribe = origTranscribe;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
