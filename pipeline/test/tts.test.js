'use strict';
/**
 * pipeline/test/tts.test.js — pipeline/tts.js with a stubbed fetch (no network,
 * no API key needed, no whisper: timings are 'estimate' or a stubbed transcribe).
 *   ~/.nvm/versions/node/v22.17.0/bin/node pipeline/test/tts.test.js
 * Needs ffmpeg/ffprobe (adds /opt/homebrew/bin to PATH when present).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (fs.existsSync('/opt/homebrew/bin') && !process.env.PATH.split(':').includes('/opt/homebrew/bin')) {
  process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;
}
const { loadEnv } = require('../config');
loadEnv();                                   // load .env now, then neutralise anything it set
for (const k of ['TTS_MODEL', 'TTS_VOICE', 'TTS_SPEED']) delete process.env[k];
process.env.OPENROUTER_API_KEY = 'test-key';

const audio = require('../audio');
const tts = require('../tts');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n    ')}`); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vg2-tts-'));
// 0.25 s silence + 1.2 s tone + 0.25 s silence: the trim must remove the padding.
const FIXTURE = path.join(TMP, 'clip.wav');
audio.ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2:sample_rate=24000',
  '-af', 'adelay=250,apad=pad_dur=0.25', '-ac', '1', '-c:a', 'pcm_s16le', FIXTURE]);
const CLIP = fs.readFileSync(FIXTURE);

function stubFetch({ status = 200, body = CLIP, type = 'audio/wav' } = {}) {
  const f = async (url, init) => {
    f.calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(status === 200 ? body : JSON.stringify({ error: { message: 'User not found.' } }),
      { status, headers: { 'content-type': status === 200 ? type : 'application/json' } });
  };
  f.calls = [];
  return f;
}

const SCRIPT = `---
title: tts test
topic: life
date: 2026-09-29
---

## Script

### Scene 1
First line of scene one.
Second line, a bit longer than the first.

### Scene 2
> [pause]
Only line of scene two.

## Scene Hints
- Scene 1: whatever
`;
function makeVideo(name, script = SCRIPT) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.md'), script);
  return dir;
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const base = { model: 'google/gemini-3.8-flash-tts', timings: 'estimate', quiet: true, retryDelayMs: 1 };

(async () => {
  console.log('tts.js (stubbed fetch)');
  const dir = makeVideo('v1');
  const fetch = stubFetch();
  let r1, d1;

  await test('first run: one API call per sentence, OpenRouter request shape', async () => {
    r1 = await tts.synthesize(dir, { ...base, voice: 'Kore', speed: 1, fetch });
    assert.strictEqual(fetch.calls.length, 3);
    assert.strictEqual(fetch.calls[0].url, 'https://openrouter.ai/api/v1/audio/speech');
    assert.deepStrictEqual(Object.keys(fetch.calls[0].body).sort(), ['input', 'model', 'response_format', 'voice']);
    assert.strictEqual(fetch.calls[0].body.model, 'google/gemini-3.8-flash-tts');
    assert.strictEqual(fetch.calls[0].body.voice, 'Kore');
    assert.strictEqual(fetch.calls[0].body.input, 'First line of scene one.');
    assert.strictEqual(fetch.calls[0].auth, 'Bearer test-key');
    assert.strictEqual(r1.apiCalls, 3);
    assert.strictEqual(r1.timings, 'estimate');
  });

  await test('writes the runtime contract: voiceover/sN.mp3, voiceover.mp3, scenes.json', async () => {
    const scenes = readJson(path.join(dir, 'scenes.json'));
    assert.strictEqual(scenes.length, 2);
    for (const s of scenes) {
      assert.deepStrictEqual(Object.keys(s), ['idx', 'dur', 'file', 'words']);
      assert.strictEqual(s.file, `voiceover/s${s.idx}.mp3`);
      assert.ok(fs.existsSync(path.join(dir, s.file)), s.file);
      assert.ok(s.words.length > 0 && s.words[0].start === 0, 'words 0-based');
      assert.ok(s.words.every((w, i) => w.end >= w.start && (i === 0 || w.start >= s.words[i - 1].start)), 'monotonic');
      assert.ok(s.words[s.words.length - 1].end <= s.dur, 'last word inside the scene');
    }
    assert.strictEqual(scenes[0].words.length, 13);                    // 5 + 8 words
    assert.strictEqual(scenes[1].words.length, 5);                     // the `>` cue line is not spoken
    // trimmed 1.2 s clips: scene 1 = 1.2 + gap 0.35 + 1.2 + tail 0.6
    assert.ok(Math.abs(scenes[0].dur - 3.35) < 0.08, `scene 1 dur ${scenes[0].dur}`);
  });

  await test('Σ scenes.json dur matches voiceover.mp3 length', async () => {
    const scenes = readJson(path.join(dir, 'scenes.json'));
    const sum = scenes.reduce((a, s) => a + s.dur, 0);
    d1 = audio.duration(path.join(dir, 'voiceover.mp3'));
    assert.ok(Math.abs(sum - d1) < 0.1, `Σdur ${sum} vs voiceover.mp3 ${d1}`);
  });

  await test('meta.json records model, voice, speed, timings', async () => {
    const m = readJson(path.join(dir, 'voiceover', 'tts', 'meta.json'));
    assert.strictEqual(m.model, 'google/gemini-3.8-flash-tts');
    assert.strictEqual(m.voice, 'Kore');
    assert.strictEqual(m.speed, 1);
    assert.strictEqual(m.timings, 'estimate');
  });

  await test('second run is fully cached (no API calls) and reuses the recorded voice', async () => {
    const r = await tts.synthesize(dir, { ...base, speed: 1, fetch });     // no voice passed
    assert.strictEqual(fetch.calls.length, 3);
    assert.strictEqual(r.apiCalls, 0);
    assert.strictEqual(r.voice, 'Kore');
  });

  await test('speed 1.15 shortens the voice by ~1/1.15 without re-calling the API', async () => {
    const r = await tts.synthesize(dir, { ...base, speed: 1.15, fetch });
    assert.strictEqual(fetch.calls.length, 3);
    assert.strictEqual(r.speed, 1.15);
    const d2 = audio.duration(path.join(dir, 'voiceover.mp3'));
    const ratio = d2 / d1;
    assert.ok(Math.abs(ratio - 1 / 1.15) < 0.02, `ratio ${ratio.toFixed(4)} vs ${(1 / 1.15).toFixed(4)}`);
    const scenes = readJson(path.join(dir, 'scenes.json'));
    assert.ok(Math.abs(scenes.reduce((a, s) => a + s.dur, 0) - d2) < 0.1);
  });

  await test('default speed comes from config/tts.json (1.15)', async () => {
    assert.strictEqual(tts.loadTtsConfig().speed, 1.15);
    const r = await tts.synthesize(dir, { ...base, fetch });
    assert.strictEqual(r.speed, 1.15);
    assert.strictEqual(fetch.calls.length, 3);
  });

  await test('TTS_SPEED env overrides config; --speed overrides env', async () => {
    process.env.TTS_SPEED = '1.1';
    try {
      assert.strictEqual((await tts.synthesize(dir, { ...base, fetch })).speed, 1.1);
      assert.strictEqual((await tts.synthesize(dir, { ...base, speed: '1.2', fetch })).speed, 1.2);
    } finally { delete process.env.TTS_SPEED; }
    assert.strictEqual(fetch.calls.length, 3);
  });

  await test('a different voice is a different cache key (re-calls the API)', async () => {
    const r = await tts.synthesize(dir, { ...base, voice: 'Puck', speed: 1, fetch });
    assert.strictEqual(r.apiCalls, 3);
    assert.strictEqual(fetch.calls.length, 6);
    assert.strictEqual(readJson(path.join(dir, 'voiceover', 'tts', 'meta.json')).voice, 'Puck');
  });

  await test('no voice anywhere → clear error naming --voice, tts_voice and TTS_VOICE', async () => {
    const d = makeVideo('novoice');
    const f = stubFetch();
    await assert.rejects(tts.synthesize(d, { ...base, fetch: f }), e => /no TTS voice set/.test(e.message) &&
      /--voice=/.test(e.message) && /tts_voice:/.test(e.message) && /TTS_VOICE/.test(e.message));
    assert.strictEqual(f.calls.length, 0);
  });

  await test('voice from script.md frontmatter (tts_voice)', async () => {
    const d = makeVideo('fmvoice', SCRIPT.replace('topic: life', 'topic: life\ntts_voice: Charon'));
    const f = stubFetch();
    const r = await tts.synthesize(d, { ...base, speed: 1, fetch: f });
    assert.strictEqual(r.voice, 'Charon');
    assert.strictEqual(f.calls[0].body.voice, 'Charon');
  });

  await test('401 → "OPENROUTER_API_KEY rejected — put a working key in .env", no retries', async () => {
    const d = makeVideo('unauth');
    const f = stubFetch({ status: 401 });
    await assert.rejects(tts.synthesize(d, { ...base, voice: 'Kore', fetch: f }),
      e => /OPENROUTER_API_KEY rejected \(HTTP 401\) — put a working key in \.env/.test(e.message));
    assert.strictEqual(f.calls.length, 1);
  });

  await test('403 gets the same message', async () => {
    const d = makeVideo('forbidden');
    await assert.rejects(tts.synthesize(d, { ...base, voice: 'Kore', fetch: stubFetch({ status: 403 }) }),
      e => /OPENROUTER_API_KEY rejected \(HTTP 403\)/.test(e.message));
  });

  await test('raw PCM responses (audio/L16;rate=24000) are decoded', async () => {
    const d = makeVideo('pcm', SCRIPT.replace(/### Scene 2[\s\S]*?(?=## Scene Hints)/, ''));
    const raw = path.join(TMP, 'clip.pcm');
    audio.ffmpeg(['-loglevel', 'error', '-i', FIXTURE, '-f', 's16le', '-ac', '1', '-ar', '24000', raw]);
    const pcm = fs.readFileSync(raw);
    const r = await tts.synthesize(d, { ...base, voice: 'Kore', speed: 1, fetch: stubFetch({ body: pcm, type: 'audio/L16;codec=pcm;rate=24000' }) });
    assert.ok(Math.abs(r.scenes[0].dur - 3.35) < 0.08, `dur ${r.scenes[0].dur}`);
  });

  await test('whisper timings: whole-voice words → 0-based per-scene lists, snapped into the sentence clips', async () => {
    let heardWav = null;
    // speed 1: scene 1 = clip [0,1.2] gap clip [1.55,2.75] tail → 3.35; scene 2 clip [3.35,4.55]
    const transcribe = (wav) => {
      heardWav = wav;
      return [{ word: 'First', start: 0.02, end: 0.3 }, { word: 'longer', start: 1.45, end: 1.9 },
        { word: 'Only', start: 3.15, end: 3.6 }, { word: 'two.', start: 4.2, end: 4.5 }];
    };
    const r = await tts.synthesize(dir, { ...base, voice: 'Kore', speed: 1, timings: 'whisper', transcribe, fetch });
    assert.strictEqual(r.timings, 'whisper');
    assert.ok(/voice-[0-9a-f]{16}\.wav$/.test(heardWav), heardWav);
    const [s1, s2] = readJson(path.join(dir, 'scenes.json'));
    assert.deepStrictEqual(s1.words.map(w => w.word), ['First', 'longer']);
    assert.deepStrictEqual(s2.words.map(w => w.word), ['Only', 'two.']);
    assert.ok(Math.abs(s1.words[1].start - 1.55) < 0.03, `early start in the gap snapped to the clip: ${s1.words[1].start}`);
    assert.strictEqual(s2.words[0].start, 0, 'word starting in scene 1\'s tail belongs to scene 2 at 0');
    assert.ok(Math.abs(s2.words[1].start - (4.2 - s1.dur)) < 0.002, `scene 2 second word ${s2.words[1].start}`);
    assert.strictEqual(readJson(path.join(dir, 'voiceover', 'tts', 'meta.json')).timings, 'whisper');
  });

  await test('--cta appends a silent word-less scene', async () => {
    const r = await tts.synthesize(dir, { ...base, voice: 'Kore', speed: 1, ctaSec: 3, fetch });
    const last = r.scenes[r.scenes.length - 1];
    assert.strictEqual(last.idx, 3);
    assert.deepStrictEqual(last.words, []);
    assert.ok(Math.abs(last.dur - 3) < 0.05);
  });

  await test('wordTimings spreads words over the clip, longer words get more time', () => {
    const w = tts.wordTimings('a extraordinarily b.', 1, 3);
    assert.strictEqual(w.length, 3);
    assert.strictEqual(w[0].start, 1);
    assert.ok(w[1].end - w[1].start > w[0].end - w[0].start);
    assert.ok(w[2].end <= 4);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
