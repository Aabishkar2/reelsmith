'use strict';
/**
 * pipeline/test/align.test.js — pure-JS tests (no audio, no network).
 * Builds synthetic whisper word arrays and runs align + analyzeWords on them.
 *   ~/.nvm/versions/node/v22.17.0/bin/node pipeline/test/align.test.js
 */
const assert = require('assert');
const A = require('../align');
const { analyzeWords } = require('../analyze');
const { loadConfig } = require('../config');

const cfg = loadConfig();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

/** "hello world [pause 2.5] again" → whisper-like words (0.28s/word, 0.06s gaps). */
function words(text) {
  const out = [];
  let t = 0.5;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const p = tok.match(/^\[pause:(\d+(?:\.\d+)?)\]$/);
    if (p) { t += parseFloat(p[1]); continue; }
    out.push({ word: tok, start: +t.toFixed(3), end: +(t + 0.28).toFixed(3), conf: null });
    t += 0.34;
  }
  return out;
}
const SENTS = [
  { id: 's1.1', scene: 1, line: 1, text: 'S3 is the oldest and most widely used AWS service.' },
  { id: 's1.2', scene: 1, line: 2, text: 'It stores objects like files, logs, and backups.' },
  { id: 's2.1', scene: 2, line: 1, text: 'But a cold start can add 900ms before your function even begins.' },
  { id: 's2.2', scene: 2, line: 2, text: 'That delay happens every time a new container spins up.' },
  { id: 's3.1', scene: 3, line: 1, text: 'It costs about $0.30 per hour for each warm instance.' },
];
const CLEAN = 'S3 is the oldest and most widely used AWS service. It stores objects like files, logs, and backups. ' +
  'But a cold start can add 900 milliseconds before your function even begins. That delay happens every time a new container spins up. ' +
  'It costs about 30 cents per hour for each warm instance.';

async function run(text, sentences = SENTS) {
  const w = words(text);
  const dur = w.length ? w[w.length - 1].end + 0.5 : 1;
  return analyzeWords({ sentences, words: w, audioFile: null, durationSec: dur, cfg, useJev: false });
}
const byId = (r, id) => r.sentences.find(s => s.id === id);
const flagsOf = (r, type) => r.sentences.flatMap(s => s.flags.filter(f => f.type === type).map(f => ({ ...f, sid: s.id })));

(async () => {
  console.log('normalize');
  await test('numbers, money, units, keep S3/EC2/IAM', () => {
    assert.deepStrictEqual(A.normalize('900ms'), ['nine', 'hundred', 'milliseconds']);
    assert.deepStrictEqual(A.normalize('$0.30'), ['thirty', 'cents']);
    assert.deepStrictEqual(A.normalize('3'), ['three']);
    assert.deepStrictEqual(A.normalize('S3,'), ['s3']);
    assert.deepStrictEqual(A.normalize('EC2'), ['ec2']);
    assert.deepStrictEqual(A.normalize('IAM'), ['iam']);
    assert.deepStrictEqual(A.normalize('cold-start'), ['cold', 'start']);
    assert.deepStrictEqual(A.normalize("don't"), ["don't"]);
  });
  await test('digits and number words converge', () => {
    const a = A.tokenize('1500 requests').map(t => t.t), b = A.tokenize('one thousand five hundred requests').map(t => t.t);
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(A.tokenize('900 ms').map(t => t.t), ['nine', 'hundred', 'milliseconds']);
  });

  console.log('align + analyze');
  await test('exact match → all ok, no cuts inside sentences', async () => {
    const r = await run(CLEAN);
    for (const s of r.sentences) assert.ok(['ok', 'warn'].includes(s.status), `${s.id} ${s.status} ${JSON.stringify(s.flags)}`);
    for (const s of r.sentences) assert.strictEqual(s.wer, 0, `${s.id} wer ${s.wer}`);
    assert.strictEqual(flagsOf(r, 'filler').length, 0);
    assert.ok(!r.cuts.some(c => /filler|stutter|restart/.test(c.reason)));
  });
  await test('filler insertion → filler flag + cut, WER stays 0', async () => {
    const r = await run(CLEAN.replace('It stores objects', 'It stores, um, objects').replace('That delay', 'Uh, that delay'));
    const f = flagsOf(r, 'filler');
    assert.strictEqual(f.length, 2, JSON.stringify(f));
    assert.strictEqual(byId(r, 's1.2').wer, 0);
    assert.strictEqual(byId(r, 's1.2').status, 'warn');
    assert.ok(r.cuts.some(c => /filler:um/.test(c.reason)), JSON.stringify(r.cuts));
  });
  await test('"like" in script is not a filler; inserted "like" is', async () => {
    const r = await run(CLEAN.replace('That delay happens', 'That delay like happens'));
    const f = flagsOf(r, 'filler');
    assert.deepStrictEqual(f.map(x => x.sid), ['s2.2']);
  });
  await test('≥3 fillers in one sentence → bad', async () => {
    const r = await run(CLEAN.replace('That delay happens every time', 'That um delay uh happens er every time'));
    assert.strictEqual(byId(r, 's2.2').status, 'bad');
  });
  await test('stutter "the the" → stutter flag, first occurrence cut', async () => {
    const r = await run(CLEAN.replace('S3 is the oldest', 'S3 is the the oldest'));
    const st = flagsOf(r, 'stutter');
    assert.strictEqual(st.length, 1, JSON.stringify(st));
    const w = r.words.filter(x => /^the$/i.test(x.word));
    assert.strictEqual(w[0].role, 'stutter');
    assert.strictEqual(w[1].role, 'anchor');
    assert.strictEqual(byId(r, 's1.1').wer, 0);
  });
  await test('number substitution 900 → 600 → dropped-key (bad)', async () => {
    const r = await run(CLEAN.replace('900 milliseconds', '600 milliseconds'));
    const s = byId(r, 's2.1');
    assert.strictEqual(s.status, 'bad');
    assert.ok(s.flags.some(f => f.type === 'dropped-key' && /900ms/.test(f.detail)), JSON.stringify(s.flags));
  });
  await test('money heard as "$0.30" or "30 cents" both match', async () => {
    const r = await run(CLEAN.replace('30 cents', '$0.30'));
    assert.strictEqual(byId(r, 's3.1').wer, 0);
  });
  await test('missing sentence → missing, neighbours intact', async () => {
    const r = await run(CLEAN.replace('That delay happens every time a new container spins up. ', ''));
    assert.strictEqual(byId(r, 's2.2').status, 'missing');
    assert.strictEqual(byId(r, 's2.2').range, null);
    for (const id of ['s1.1', 's1.2', 's2.1', 's3.1']) assert.ok(['ok', 'warn'].includes(byId(r, id).status), id);
  });
  await test('restart "S3 is the— S3 is the oldest…" → later attempt kept, earlier cut', async () => {
    const r = await run(CLEAN.replace('S3 is the oldest', 'S3 is the— S3 is the oldest'));
    const s = byId(r, 's1.1');
    assert.ok(['ok', 'warn'].includes(s.status), JSON.stringify(s.flags));
    assert.strictEqual(s.wer, 0);
    const first = r.words.filter(w => /^S3/.test(w.word));
    assert.strictEqual(first[0].role, 'restart');
    assert.strictEqual(first[1].role, 'anchor');
    assert.strictEqual(s.range.start, first[1].start);
    assert.ok(s.flags.some(f => f.type === 'stutter' && /restart/.test(f.detail)), JSON.stringify(s.flags));
    assert.ok(r.cuts.some(c => c.start <= first[0].start && c.end >= first[0].end), JSON.stringify(r.cuts));
  });
  await test('mid-sentence restart stitched by DP → re-anchored to the later attempt', async () => {
    // first attempt exact, second attempt has a fuzzy word: DP alone would stitch the two
    const r = await run(CLEAN.replace('S3 is the oldest and most', 'S3 is the oldest and— S3 is the oldests and most'));
    const s = byId(r, 's1.1');
    const s3 = r.words.filter(w => /^S3/.test(w.word));
    assert.strictEqual(s.range.start, s3[1].start, JSON.stringify(s));
    assert.ok(s.flags.some(f => /restart/.test(f.detail)), JSON.stringify(s.flags));
  });
  await test('long pause inside sentence and between sentences → pause flags + trim cuts', async () => {
    const r = await run(CLEAN.replace('most widely', 'most [pause:1.6] widely').replace('backups. But', 'backups. [pause:2.5] But'));
    const p = flagsOf(r, 'pause');
    assert.ok(p.some(f => f.sid === 's1.1' && f.where === 'inside'), JSON.stringify(p));
    assert.ok(p.some(f => f.sid === 's2.1' && f.where === 'before'), JSON.stringify(p));
    assert.ok(r.cuts.some(c => c.reason.includes('pause')));
  });
  await test('substitution paraphrase → mismatch when WER > 0.15', async () => {
    const r = await run(CLEAN.replace('That delay happens every time a new container spins up.', 'This lag occurs whenever some fresh box boots up.'));
    const s = byId(r, 's2.2');
    assert.ok(['bad', 'missing'].includes(s.status), s.status);
  });
  await test('out-of-order sentence → order flag', async () => {
    const t = CLEAN.replace('It stores objects like files, logs, and backups. ', '') + ' It stores objects like files, logs, and backups.';
    const r = await run(t);
    const s = byId(r, 's1.2');
    assert.strictEqual(s.status, 'bad', JSON.stringify(s));
    assert.ok(s.flags.some(f => f.type === 'order'));
  });
  await test('punctuation-only whisper word inside a sentence is never cut', async () => {
    const r = await run(CLEAN.replace('most widely', 'most - widely'));
    const dash = r.words.find(w => w.word === '-');
    assert.strictEqual(dash.role, 'punct');
    assert.ok(!r.cuts.some(c => c.start < dash.end && c.end > dash.start), JSON.stringify(r.cuts));
  });

  console.log('loudness');
  await test('quiet sentence → loudness bad; clipping → loudness bad', async () => {
    const os = require('os'), fs = require('fs'), path = require('path');
    const audio = require('../audio');
    const w = words(CLEAN);
    const dur = w[w.length - 1].end + 0.5, sr = 16000;
    const samples = new Int16Array(Math.ceil(dur * sr));
    const q = w.filter(x => ['It', 'stores', 'objects', 'like', 'files,', 'logs,', 'and', 'backups.'].includes(x.word) && x.start > 3 && x.start < 8);
    const quiet = [q[0].start, q[q.length - 1].end];
    const loud = [w.find(x => x.word === 'That').start, w.find(x => x.word === 'up.').end];
    for (let i = 0; i < samples.length; i++) {
      const t = i / sr;
      const amp = t >= quiet[0] && t <= quiet[1] ? 150 : t >= loud[0] && t <= loud[1] ? 32767 : 4000;
      samples[i] = Math.round(amp * Math.sin(2 * Math.PI * 220 * t));
    }
    const file = path.join(os.tmpdir(), `vg2-loud-${process.pid}.wav`);
    audio.writeWav(file, { sampleRate: sr, samples });
    try {
      const r = await analyzeWords({ sentences: SENTS, words: w, audioFile: file, durationSec: dur, cfg, useJev: false });
      assert.ok(byId(r, 's1.2').flags.some(f => f.type === 'loudness' && /quiet/.test(f.detail)), JSON.stringify(byId(r, 's1.2').flags));
      assert.ok(byId(r, 's2.2').flags.some(f => f.type === 'loudness' && /clipping/.test(f.detail)), JSON.stringify(byId(r, 's2.2').flags));
      assert.strictEqual(byId(r, 's1.1').flags.filter(f => f.type === 'loudness').length, 0);
    } finally { fs.rmSync(file, { force: true }); }
  });

  console.log('jev wiring (stubbed — no network)');
  const jev = require('../jev');
  const orig = { classifyInsertions: jev.classifyInsertions, reviewSentence: jev.reviewSentence };
  await test('Jev "not a filler" keeps an inserted "so" as an extra word', async () => {
    jev.classifyInsertions = async batch => batch.map(() => ({ isFiller: false, prob: 0.1 }));
    try {
      const w = words(CLEAN.replace('That delay happens', 'That delay so happens'));
      const r = await analyzeWords({ sentences: SENTS, words: w, audioFile: null, durationSec: 30, cfg, useJev: true });
      assert.strictEqual(flagsOf(r, 'filler').length, 0);
      assert.strictEqual(r.words.find(x => x.word === 'so').role, 'extra');
      assert.ok(r.jev && /classified 1/.test(r.jev.notes), JSON.stringify(r.jev));
    } finally { Object.assign(jev, orig); }
  });
  await test('Jev failure → rules decide ("so" is a filler) and jev = null', async () => {
    jev.classifyInsertions = async () => null;
    try {
      const w = words(CLEAN.replace('That delay happens', 'That delay so happens'));
      const r = await analyzeWords({ sentences: SENTS, words: w, audioFile: null, durationSec: 30, cfg, useJev: true });
      assert.strictEqual(flagsOf(r, 'filler').length, 1);
      assert.strictEqual(r.jev, null);
    } finally { Object.assign(jev, orig); }
  });
  await test('Jev "rerecord" escalates a borderline warn sentence to bad', async () => {
    jev.reviewSentence = async () => ({ verdict: 'rerecord', reason: 'Jev P(rerecord)=0.91', prob: 0.91 });
    try {
      // one substituted word in a 10-token sentence → WER 0.10 (borderline band)
      const w = words(CLEAN.replace('That delay happens every time', 'That lag happens every time'));
      const r = await analyzeWords({ sentences: SENTS, words: w, audioFile: null, durationSec: 30, cfg, useJev: true });
      const s = byId(r, 's2.2');
      assert.strictEqual(s.status, 'bad', JSON.stringify(s));
      assert.ok(s.flags.some(f => f.type === 'mismatch' && /Jev/.test(f.detail)));
    } finally { Object.assign(jev, orig); }
  });

  await test('600×700 tokens aligns fast (< 2s)', () => {
    const base = CLEAN.split(' ');
    const S = A.tokenize(Array.from({ length: 12 }, () => CLEAN).join(' '));
    const T = A.tokenize(Array.from({ length: 12 }, (_, i) => base.map((w, j) => (j % 13 === i % 13 ? `um ${w}` : w)).join(' ')).join(' '));
    const t0 = Date.now();
    A.align(S, T);
    const ms = Date.now() - t0;
    assert.ok(S.length > 550 && T.length > 600, `${S.length}x${T.length}`);
    assert.ok(ms < 2000, `${ms}ms`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
