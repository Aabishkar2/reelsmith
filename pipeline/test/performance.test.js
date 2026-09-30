'use strict';
/**
 * pipeline/test/performance.test.js — pipeline/performance.js (`tts --mode=performance`) with a
 * stubbed tts provider (ffmpeg-generated 24 kHz PCM: five tone "sentences" with pauses between)
 * and a stubbed stt provider (fixed words). No network, no API key, no whisper.
 *   node pipeline/test/performance.test.js
 * Needs ffmpeg/ffprobe (core/env.js finds them).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const env = require('../../core/env');
env.ensureOnPath();
for (const k of ['TTS_PROVIDER', 'TTS_MODEL', 'TTS_VOICE', 'TTS_SPEED', 'TTS_MODE']) delete process.env[k];

const audio = require('../audio');
const perf = require('../performance');
const tts = require('../tts');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 5).join('\n    ')}`); }
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b} (±${eps})`);

// ── fixtures ─────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-perf-'));
const PROJECT = path.join(TMP, 'project');                 // a tiny project root (own reelsmith.config.json)
fs.mkdirSync(path.join(PROJECT, 'videos'), { recursive: true });
fs.writeFileSync(path.join(PROJECT, 'reelsmith.config.json'), JSON.stringify({ version: 1 }));

// 1× timeline (s): s1.1 0.3–1.5 · s1.2 1.8–3.0 · [scene pause] · s2.1 3.8–5.0 · [scene pause] · s3.1 5.8–7.0 · s3.2 7.3–8.5 · end 9.0
const SEGS = [[0.3, 1.5], [1.8, 3.0], [3.8, 5.0], [5.8, 7.0], [7.3, 8.5]];
const TOTAL_1X = 9.0;
const PCM_FILE = path.join(TMP, 'voice.pcm');
audio.ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i',
  `aevalsrc=0.4*sin(2*PI*440*t)*(${SEGS.map(([a, b]) => `between(t\\,${a}\\,${b})`).join('+')}):s=24000:d=${TOTAL_1X}`,
  '-f', 's16le', '-ac', '1', '-ar', '24000', PCM_FILE]);
const PCM = fs.readFileSync(PCM_FILE);

const SCRIPT = `---
title: Perf test
topic: devtools
date: 2026-09-30
tts_voice: Kore
tts_mode: performance
tts_performance: perf.md
---

## Script

### Scene 1
Alpha bravo charlie.
Delta echo always-on.

### Scene 2
> say it slowly
Foxtrot golf hotel.

### Scene 3
India juliet kilo.
Lima mike November.

## Voice direction
Calm and clear.

## Scene Hints
- Scene 1: whatever
`;
const DIRECTION = `# Direction (test)

This paragraph mentions PERFORMANCE mid-sentence but is not part of the block.

PERFORMANCE

Style: steady.
`;
const EXPECTED_PROMPT = '# Perf test\n\nPERFORMANCE\n\nStyle: steady.\n\nCONTEXT\n\nCalm and clear.\n\nTRANSCRIPT\n' +
  'Alpha bravo charlie. Delta echo always-on.\n\nFoxtrot golf hotel.\n\nIndia juliet kilo. Lima mike November.\n';

/** Whisper-like words spread over a segment. */
function spread(texts, [a, b]) {
  const d = (b - a) / texts.length;
  return texts.map((w, i) => ({ word: w, start: +(a + i * d).toFixed(3), end: +(a + (i + 1) * d - (i === texts.length - 1 ? 0 : 0.04)).toFixed(3), conf: 0.9 }));
}
// whisper-isms: "-on." split off (glue), "IndiaJuliet" (merge 2:1), "Novembre." (fuzzy misspelling)
const HEARD = [
  ...spread(['Alpha', 'bravo', 'charlie.'], SEGS[0]),
  ...spread(['Delta', 'echo', 'always', '-on.'], SEGS[1]),
  ...spread(['Foxtrot', 'golf', 'hotel.'], SEGS[2]),
  ...spread(['IndiaJuliet', 'kilo.'], SEGS[3]),
  ...spread(['Lima', 'mike', 'Novembre.'], SEGS[4]),
];

function makeVideo(name, script = SCRIPT) {
  const dir = path.join(PROJECT, 'videos', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  fs.writeFileSync(path.join(dir, 'perf.md'), DIRECTION);
  return dir;
}
function stubTts() {
  const p = {
    name: 'tts-stub', kind: 'tts', version: '1.0.0', calls: [],
    async synthesize() { throw new Error('sentence mode not expected here'); },
    async synthesizePerformance(args) { p.calls.push(args); return { audio: PCM, format: 'pcm', sampleRate: 24000, contentType: 'audio/pcm' }; },
  };
  return p;
}
function stubStt(words = HEARD) {
  const p = { name: 'stt-stub', kind: 'stt', version: '1.0.0', calls: [], async transcribe(args) { p.calls.push(args); return words.map(w => ({ ...w })); } };
  return p;
}
const logs = [];
const base = { quiet: true, log: (...a) => logs.push(a.join(' ')) };

(async () => {
  console.log('performance.js (stubbed tts + stt)');
  const dir = makeVideo('v1');
  const T = stubTts(), W = stubStt();
  const F = perf.cacheFiles(dir);
  let r1;

  await test('first run: one synthesizePerformance call with the exact prompt (PERFORMANCE from its line, cues excluded)', async () => {
    r1 = await perf.synthesize(dir, { ...base, ttsProvider: T, sttProvider: W });
    assert.strictEqual(T.calls.length, 1);
    assert.strictEqual(T.calls[0].prompt, EXPECTED_PROMPT);
    assert.strictEqual(T.calls[0].voice, 'Kore', 'voice from tts_voice frontmatter');
    assert.strictEqual(T.calls[0].model, 'google/gemini-3.8-flash-tts', 'model from core defaults');
    assert.strictEqual(fs.readFileSync(F.prompt, 'utf8'), EXPECTED_PROMPT);
    assert.strictEqual(r1.apiCalls, 1);
    assert.strictEqual(r1.cached, false);
  });

  await test('caches raw PCM + 24 kHz mono performance.wav + performance.meta.json (hash = sha1(model|voice|prompt))', async () => {
    assert.ok(fs.existsSync(path.join(F.src, 'performance.pcm')));
    assert.strictEqual(audio.sampleRate(F.wav), 24000);
    near(audio.duration(F.wav), TOTAL_1X, 0.01, 'performance.wav length');
    const m = readJson(F.meta);
    assert.strictEqual(m.hash, perf.sha1(`google/gemini-3.8-flash-tts|Kore|${EXPECTED_PROMPT}`));
    assert.deepStrictEqual([m.provider, m.mode, m.format, m.sampleRate, m.voice], ['stub', 'performance', 'pcm', 24000, 'Kore']);
    assert.ok(!fs.existsSync(F.words), 'performance.json is left to whisper');
  });

  await test('stt runs on the 1× wav, whole mode, no prompt', async () => {
    assert.strictEqual(W.calls.length, 1);
    assert.strictEqual(W.calls[0].wavPath, F.wav);
    assert.strictEqual(W.calls[0].mode, 'whole');
    assert.strictEqual(W.calls[0].prompt, '');
  });

  await test('scenes.json: 3 scenes, cut in the middle of each scene pause (1× time / speed)', async () => {
    const scenes = readJson(path.join(dir, 'scenes.json'));
    assert.strictEqual(scenes.length, 3);
    for (const s of scenes) {
      assert.deepStrictEqual(Object.keys(s), ['idx', 'dur', 'file', 'words']);
      assert.strictEqual(s.file, `voiceover/s${s.idx}.mp3`);
      assert.ok(fs.existsSync(path.join(dir, s.file)), s.file);
    }
    near(scenes[0].dur, 3.4 / 1.15, 0.002, 'scene 1 ends mid-pause (3.0+3.8)/2');
    near(scenes[0].dur + scenes[1].dur, 5.4 / 1.15, 0.002, 'scene 2 ends mid-pause (5.0+5.8)/2');
    near(r1.cuts[0], 3.4 / 1.15, 0.002, 'result.cuts');
  });

  await test('Σdur ≈ voiceover.mp3 ≈ 1× length / speed (no gaps or tails inserted)', async () => {
    const scenes = readJson(path.join(dir, 'scenes.json'));
    const sum = scenes.reduce((a, s) => a + s.dur, 0);
    near(sum, TOTAL_1X / 1.15, 0.02, 'Σdur vs 9.0/1.15');
    near(sum, audio.duration(path.join(dir, 'voiceover.mp3')), 0.1, 'Σdur vs voiceover.mp3');
    near(r1.totalSec, sum, 0.002, 'result.totalSec');
  });

  await test('words: scene-relative, clamped, monotonic; fragments glued; script spelling for a misspelled or merged word', async () => {
    const scenes = readJson(path.join(dir, 'scenes.json'));
    for (const s of scenes) {
      assert.ok(s.words.length > 0);
      assert.ok(s.words.every((w, i) => w.start >= 0 && w.end >= w.start && w.end <= s.dur && (i === 0 || w.start >= s.words[i - 1].start)),
        `scene ${s.idx} not clamped/monotonic: ${JSON.stringify(s.words)}`);
    }
    assert.deepStrictEqual(scenes[0].words.map(w => w.word), ['Alpha', 'bravo', 'charlie.', 'Delta', 'echo', 'always-on.']);
    assert.deepStrictEqual(scenes[1].words.map(w => w.word), ['Foxtrot', 'golf', 'hotel.']);
    assert.deepStrictEqual(scenes[2].words.map(w => w.word), ['India', 'juliet', 'kilo.', 'Lima', 'mike', 'November.']);
    near(scenes[1].words[0].start, 3.8 / 1.15 - scenes[0].dur, 0.002, 'scene 2 first word, sped + relative');
  });

  await test('voiceover/tts/meta.json records the performance run', async () => {
    const m = readJson(path.join(dir, 'voiceover', 'tts', 'meta.json'));
    assert.deepStrictEqual([m.provider, m.model, m.voice, m.speed, m.mode, m.timings, m.sentences, m.matched],
      ['stub', 'google/gemini-3.8-flash-tts', 'Kore', 1.15, 'performance', 'whisper', 5, 5]);
    assert.deepStrictEqual(m.unmatched, []);
    assert.ok(m.totalSec > 7 && m.at);
  });

  await test('second run is cached: provider not called, log says "cached"', async () => {
    logs.length = 0;
    const r = await perf.synthesize(dir, { ...base, ttsProvider: T, sttProvider: W });
    assert.strictEqual(T.calls.length, 1);
    assert.strictEqual(r.apiCalls, 0);
    assert.strictEqual(r.cached, true);
    assert.ok(logs.some(l => /cached/.test(l)), logs.join('\n'));
  });

  await test('speed change re-times from the cached audio (no API call)', async () => {
    const r = await perf.synthesize(dir, { ...base, speed: 1, ttsProvider: T, sttProvider: W });
    assert.strictEqual(T.calls.length, 1);
    near(r.totalSec, TOTAL_1X, 0.02, 'speed 1 total');
    assert.ok(fs.existsSync(path.join(F.src, 'performance-x1.wav')));
    const scenes = readJson(path.join(dir, 'scenes.json'));
    near(scenes[0].dur, 3.4, 0.002, 'speed 1 cut');
  });

  await test('--offline + a changed prompt: refuses to call the API and says which part changed', async () => {
    const md = path.join(dir, 'script.md');
    fs.writeFileSync(md, SCRIPT.replace('Calm and clear.', 'Warm and slow.'));
    try {
      await assert.rejects(perf.synthesize(dir, { ...base, offline: true, ttsProvider: T, sttProvider: W }),
        e => /not cached/.test(e.message) && /CONTEXT/.test(e.message) && /--offline/.test(e.message));
      assert.strictEqual(T.calls.length, 1);
    } finally { fs.writeFileSync(md, SCRIPT); }
  });

  await test('< 80 % of sentences found → error listing the missing sentence ids', async () => {
    const few = stubStt(HEARD.filter(w => w.start < 5.0));            // scene 3 (s3.1, s3.2) never heard
    await assert.rejects(perf.synthesize(dir, { ...base, ttsProvider: T, sttProvider: few }),
      e => /only 3\/5 script sentences/.test(e.message) && /s3\.1/.test(e.message) && /s3\.2/.test(e.message) && !/s1\.1/.test(e.message));
    assert.strictEqual(T.calls.length, 1);
  });

  await test('a scene whose only sentence is unheard is placed on the longest pauses around it (4/5 found)', async () => {
    const garbled = HEARD.map(w => (w.start >= 3.8 && w.start < 5.0 ? { ...w, word: ['zzq', 'xxv', 'qqk'][Math.round((w.start - 3.8) / 0.4) % 3] } : w));
    const r = await perf.synthesize(dir, { ...base, ttsProvider: T, sttProvider: stubStt(garbled) });
    assert.strictEqual(r.matched, 4);
    assert.deepStrictEqual(r.unmatched.map(s => s.id), ['s2.1']);
    const scenes = readJson(path.join(dir, 'scenes.json'));
    near(scenes[0].dur, 3.4 / 1.15, 0.002, 'cut 1');
    near(scenes[0].dur + scenes[1].dur, 5.4 / 1.15, 0.002, 'cut 2');
    assert.strictEqual(scenes[1].words.length, 3);
  });

  // A prompt that made cached audio with different PERFORMANCE text (the first one-off builder took the
  // block from the first "PERFORMANCE" substring, so the explanatory paragraph went in too).
  const OLD_DIRECTION_PROMPT = EXPECTED_PROMPT.replace('PERFORMANCE\n\nStyle: steady.',
    'PERFORMANCE mid-sentence but is not part of the block.\n\nPERFORMANCE\n\nStyle: steady.');
  const seedCache = (name, storedPrompt, script = SCRIPT) => {
    const d = makeVideo(name, script);
    const L = perf.cacheFiles(d);
    fs.mkdirSync(L.src, { recursive: true });
    fs.copyFileSync(F.wav, L.wav);
    fs.writeFileSync(L.prompt, storedPrompt);
    fs.writeFileSync(L.meta, JSON.stringify({ provider: 'stub', model: 'google/gemini-3.8-flash-tts', voice: 'Kore', mode: 'performance',
      hash: perf.sha1(`google/gemini-3.8-flash-tts|Kore|${storedPrompt}`), format: 'pcm', sampleRate: 24000, seconds: 9 }));
    return { d, L };
  };

  await test('only the direction text changed since the voice was made: cached via performance-prompt.md, logged, file kept', async () => {
    const { d, L } = seedCache('dirchange', OLD_DIRECTION_PROMPT);
    assert.ok(perf.onlyDirectionDiffers(OLD_DIRECTION_PROMPT, EXPECTED_PROMPT));
    const t = stubTts();
    logs.length = 0;
    const r = await perf.synthesize(d, { ...base, offline: true, ttsProvider: t, sttProvider: stubStt() });
    assert.strictEqual(t.calls.length, 0);
    assert.strictEqual(r.cached, true);
    assert.strictEqual(r.directionChanged, true);
    assert.ok(logs.some(l => l.includes('cached (direction text changed since this voice was made; --force re-voices)')), logs.join('\n'));
    assert.strictEqual(fs.readFileSync(L.prompt, 'utf8'), OLD_DIRECTION_PROMPT, 'performance-prompt.md = the prompt that made the audio');
    const again = await perf.synthesize(d, { ...base, offline: true, ttsProvider: t, sttProvider: stubStt() });
    assert.strictEqual(again.cached, true, 'still cached on the next run');
    assert.strictEqual(t.calls.length, 0);
  });

  await test('stored prompt hash but the TRANSCRIPT or CONTEXT changed: not cached (--offline refuses and names the part)', async () => {
    const lines = seedCache('transcript', OLD_DIRECTION_PROMPT, SCRIPT.replace('Foxtrot golf hotel.', 'Foxtrot golf hotels.'));
    await assert.rejects(perf.synthesize(lines.d, { ...base, offline: true, ttsProvider: stubTts(), sttProvider: stubStt() }),
      e => /not cached/.test(e.message) && /TRANSCRIPT/.test(e.message));
    const ctx = seedCache('context', OLD_DIRECTION_PROMPT, SCRIPT.replace('Calm and clear.', 'Loud and fast.'));
    await assert.rejects(perf.synthesize(ctx.d, { ...base, offline: true, ttsProvider: stubTts(), sttProvider: stubStt() }),
      e => /not cached/.test(e.message) && /CONTEXT/.test(e.message));
    const tampered = seedCache('tampered', OLD_DIRECTION_PROMPT);
    fs.writeFileSync(tampered.L.prompt, OLD_DIRECTION_PROMPT.replace('Style: steady.', 'Style: edited.'));   // hash no longer matches
    await assert.rejects(perf.synthesize(tampered.d, { ...base, offline: true, ttsProvider: stubTts(), sttProvider: stubStt() }), /not cached/);
  });

  await test('promptParts: title / direction / context / transcript; a missing CONTEXT is empty', () => {
    const a = perf.promptParts(EXPECTED_PROMPT);
    assert.deepStrictEqual(a, { title: '# Perf test', direction: 'PERFORMANCE\n\nStyle: steady.', context: 'Calm and clear.',
      transcript: 'Alpha bravo charlie. Delta echo always-on.\n\nFoxtrot golf hotel.\n\nIndia juliet kilo. Lima mike November.' });
    const b = perf.promptParts('# T\n\nPERFORMANCE\n\nx\n\nTRANSCRIPT\na b\n');
    assert.strictEqual(b.context, '');
    assert.strictEqual(b.transcript, 'a b');
    assert.ok(!perf.onlyDirectionDiffers(EXPECTED_PROMPT, EXPECTED_PROMPT.replace('# Perf test', '# Other')), 'a title change is not "direction only"');
  });

  await test('a meta file in whisper\'s performance.json (old layout) moves to performance.meta.json', async () => {
    const m = fs.readFileSync(F.meta, 'utf8');
    fs.rmSync(F.meta);
    fs.writeFileSync(F.words, m);
    const r = await perf.synthesize(dir, { ...base, ttsProvider: T, sttProvider: W });
    assert.strictEqual(r.cached, true);
    assert.strictEqual(fs.readFileSync(F.meta, 'utf8'), m);
    assert.ok(!fs.existsSync(F.words));
    assert.strictEqual(T.calls.length, 1);
  });

  await test('--force re-generates; a provider without synthesizePerformance is a clear error', async () => {
    await perf.synthesize(dir, { ...base, force: true, ttsProvider: T, sttProvider: W });
    assert.strictEqual(T.calls.length, 2);
    const noPerf = { name: 'tts-plain', kind: 'tts', version: '1', async synthesize() {} };
    await assert.rejects(perf.synthesize(makeVideo('noperf'), { ...base, ttsProvider: noPerf, sttProvider: W }),
      e => /no synthesizePerformance/.test(e.message) && /--mode=sentence/.test(e.message));
  });

  await test('mode routing: tts_mode frontmatter > config; flag wins; unknown mode rejected', async () => {
    assert.strictEqual(tts.resolveMode(dir), 'performance');
    assert.strictEqual(tts.resolveMode(dir, { mode: 'sentence' }), 'sentence');
    const d = makeVideo('plain', SCRIPT.replace('tts_mode: performance\n', ''));
    assert.strictEqual(tts.resolveMode(d), 'sentence');
    assert.throws(() => tts.resolveMode(d, { mode: 'karaoke' }), /unknown tts mode/);
  });

  console.log('\nhelpers');
  await test('buildPrompt omits an empty CONTEXT; performanceBlock without the marker line uses the whole file', () => {
    assert.strictEqual(perf.buildPrompt({ title: 'T', performance: 'PERFORMANCE\n\nx', context: '', transcript: 'a b' }), '# T\n\nPERFORMANCE\n\nx\n\nTRANSCRIPT\na b\n');
    assert.strictEqual(perf.performanceBlock('Just be calm.\n'), 'PERFORMANCE\n\nJust be calm.');
    assert.strictEqual(perf.performanceBlock('intro PERFORMANCE here\n\nPERFORMANCE\n\nStyle: x\n'), 'PERFORMANCE\n\nStyle: x');
  });

  await test('glueFragments: "-on", ".11", ".md" glue; ".env" after a function word does not', () => {
    const w = (word, start) => ({ word, start, end: start + 0.1 });
    const out = perf.glueFragments([w('always', 0), w('-on', 0.1), w('python', 0.3), w('3', 0.4), w('.11', 0.5), w('script', 0.7), w('.md', 0.8), w('in', 1), w('.env', 1.1)]);
    assert.deepStrictEqual(out.map(x => x.word), ['always-on', 'python', '3.11', 'script.md', 'in', '.env']);
    assert.strictEqual(out[0].end, 0.2);
  });

  await test('sceneCuts: middle of the longest pause between located scenes; assignWords: straddling word → larger overlap', () => {
    const words = [[0, 1], [1.1, 2], [2.8, 3], [3.1, 4]].map(([start, end], i) => ({ word: `w${i}`, start, end }));
    const scenes = [{ idx: 1 }, { idx: 2 }];
    assert.deepStrictEqual(perf.sceneCuts(words, [{ first: 0, last: 0 }, { first: 3, last: 3 }], scenes), [2.4]);
    const bounds = [{ off: 0, dur: 2 }, { off: 2, dur: 2 }];
    const out = perf.assignWords([{ word: 'a', start: 1.5, end: 2.2 }, { word: 'b', start: 1.9, end: 2.9 }, { word: 'c', start: 3.5, end: 9 }], bounds);
    assert.deepStrictEqual(out.map(ws => ws.map(x => x.word)), [['a'], ['b', 'c']]);
    assert.deepStrictEqual(out[1][0], { word: 'b', start: 0, end: 0.9 });
    assert.strictEqual(out[1][1].end, 2, 'clamped to the scene');
  });

  console.log('\nCLI (project with stub plugins in reelsmith.config.json)');
  await test('`cli.js tts <video> --mode=performance` resolves providers from the project config; --offline reuses the cache', async () => {
    const root = path.join(TMP, 'cliproj');
    fs.mkdirSync(path.join(root, 'stubs'), { recursive: true });
    fs.copyFileSync(PCM_FILE, path.join(root, 'stubs', 'voice.pcm'));
    fs.writeFileSync(path.join(root, 'stubs', 'words.json'), JSON.stringify(HEARD));
    fs.writeFileSync(path.join(root, 'stubs', 'tts.js'), `module.exports = { name: 'tts-stub', kind: 'tts', version: '1.0.0',
  async synthesize() { throw new Error('no'); },
  async synthesizePerformance() { require('fs').appendFileSync(__dirname + '/calls.log', 'x'); return { audio: require('fs').readFileSync(__dirname + '/voice.pcm'), format: 'pcm', sampleRate: 24000 }; } };\n`);
    fs.writeFileSync(path.join(root, 'stubs', 'stt.js'), `module.exports = { name: 'stt-stub', kind: 'stt', version: '1.0.0',
  async transcribe() { return JSON.parse(require('fs').readFileSync(__dirname + '/words.json', 'utf8')); } };\n`);
    fs.writeFileSync(path.join(root, 'reelsmith.config.json'), JSON.stringify({ version: 1, plugins: ['./stubs/tts.js', './stubs/stt.js'],
      tts: { provider: 'stub', mode: 'sentence' }, stt: { provider: 'stub' } }));
    const vdir = path.join(root, 'videos', 'demo');
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, 'script.md'), SCRIPT.replace('tts_mode: performance\n', ''));
    fs.writeFileSync(path.join(vdir, 'perf.md'), DIRECTION);
    const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'cli.js'), 'tts', vdir, ...args],
      { encoding: 'utf8', cwd: root, env: { ...process.env, OPENROUTER_API_KEY: '' } });
    const a = cli('--mode=performance', '--json');
    assert.strictEqual(a.status, 0, a.stderr);
    const ra = JSON.parse(a.stdout);
    assert.deepStrictEqual([ra.mode, ra.provider, ra.scenes.length, ra.apiCalls], ['performance', 'stub', 3, 1]);
    const b = cli('--offline');                             // no --mode: the video's last mode (meta.json) is reused
    assert.strictEqual(b.status, 0, b.stderr);
    assert.ok(/performance mode: stub .*audio cached, 0 API calls/.test(b.stdout), b.stdout);
    assert.ok(/3 scenes/.test(b.stdout), b.stdout);
    assert.strictEqual(fs.readFileSync(path.join(root, 'stubs', 'calls.log'), 'utf8'), 'x', 'one API call in total');
    const c = cli('--mode=karaoke');
    assert.strictEqual(c.status, 2, c.stderr);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
